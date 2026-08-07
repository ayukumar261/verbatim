import { randomBytes } from "node:crypto"

import type { Redis } from "ioredis"

import { Session as SessionModel } from "../models/session.js"
import type { SessionDocument } from "../models/session.js"
import type { Session } from "../types.js"

/** 256 bits of entropy, base64url so it survives a cookie unescaped. */
const TOKEN_BYTES = 32

/** Seconds a `state` survives: the user's window to finish GitHub's consent. */
export const STATE_TTL = 10 * 60

/** Seconds a signed-in browser stays signed in. Fixed, not sliding. */
export const SESSION_TTL = 30 * 24 * 60 * 60

/**
 * Seconds a session stays cached. Short on purpose: revocation deletes the key
 * outright, so this only bounds the damage when that delete fails to land.
 */
export const CACHE_TTL = 5 * 60

const stateKey = (state: string) => `oauth:state:${state}`
const cacheKey = (sid: string) => `session:${sid}`

const token = () => randomBytes(TOKEN_BYTES).toString("base64url")

const toSession = (document: SessionDocument): Session => ({
  sid: document.sid,
  userId: document.userId.toString(),
  createdAt: document.createdAt,
  expiresAt: document.expiresAt,
})

/** JSON has no Date type, so what went into Redis comes back as strings. */
const revive = (cached: string): Session => {
  const parsed = JSON.parse(cached) as Session

  return {
    ...parsed,
    createdAt: new Date(parsed.createdAt),
    expiresAt: new Date(parsed.expiresAt),
  }
}

/**
 * Sessions and OAuth `state`. Mongo owns sessions outright; Redis holds a
 * short-lived copy in front of it, and owns `state` alone, a value that is
 * meaningless ten minutes after it is issued.
 *
 * Takes its Redis client as an argument rather than importing the singleton,
 * so a test can hand it a throwaway container.
 */
export const createSessionStore = (redis: Redis) => {
  /** Caches a session for `CACHE_TTL`, or until it expires, whichever is first. */
  const cache = async (session: Session): Promise<void> => {
    const remaining = Math.floor(
      (session.expiresAt.getTime() - Date.now()) / 1000
    )
    const ttl = Math.min(CACHE_TTL, remaining)

    // A session on its last second is not worth caching, and Redis rejects a
    // non-positive TTL anyway.
    if (ttl <= 0) {
      return
    }

    await redis.set(cacheKey(session.sid), JSON.stringify(session), "EX", ttl)
  }

  /** Remembers a one-time value to hand GitHub, to be recognised on return. */
  const createState = async (): Promise<string> => {
    const state = token()

    // The key is the whole payload; there is nothing worth storing against it.
    await redis.set(stateKey(state), "", "EX", STATE_TTL)

    return state
  }

  /**
   * Whether this `state` is one we issued and have not yet seen back. `GETDEL`
   * so two concurrent callbacks cannot both pass. Single use is the point.
   */
  const consumeState = async (state: string): Promise<boolean> =>
    (await redis.getdel(stateKey(state))) !== null

  /** Signs a user in, returning the opaque id to put in their cookie. */
  const createSession = async (userId: string): Promise<string> => {
    const document = await SessionModel.create({
      sid: token(),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL * 1000),
    })

    const session = toSession(document)
    await cache(session)

    return session.sid
  }

  /**
   * Who this session belongs to, or `null` if it expired or never existed.
   * A miss reads Mongo and refills the cache, so a flushed Redis costs one
   * extra round trip rather than everybody's sign-in.
   */
  const getSession = async (sid: string): Promise<Session | null> => {
    const cached = await redis.get(cacheKey(sid))

    if (cached !== null) {
      return revive(cached)
    }

    // `expiresAt` is filtered here rather than trusted to the TTL index, which
    // sweeps on its own schedule and leaves expired documents readable.
    const document = await SessionModel.findOne({
      sid,
      expiresAt: { $gt: new Date() },
    })

    if (document === null) {
      return null
    }

    const session = toSession(document)
    await cache(session)

    return session
  }

  /** Ends one session. This is logout: other devices stay signed in. */
  const deleteSession = async (sid: string): Promise<void> => {
    // Cache first. The reverse order can leave a revoked session still
    // answering from Redis, which is the one failure worth designing against.
    await redis.del(cacheKey(sid))
    await SessionModel.deleteOne({ sid })
  }

  return {
    createState,
    consumeState,
    createSession,
    getSession,
    deleteSession,
  }
}

export type SessionStore = ReturnType<typeof createSessionStore>
