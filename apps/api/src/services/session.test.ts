import assert from "node:assert/strict"
import { after, before, beforeEach, describe, it } from "node:test"

import type { Redis } from "ioredis"

import { Session as SessionModel } from "../models/session.js"
import { startTestMongo, startTestRedis } from "../test/containers.js"
import type { TestMongo, TestRedis } from "../test/containers.js"
import {
  CACHE_TTL,
  SESSION_TTL,
  STATE_TTL,
  createSessionStore,
} from "./session.js"
import type { SessionStore } from "./session.js"

/** Real ObjectId strings, since `userId` is cast on the way into Mongo. */
const USER_ID = "68b1f0c2a4d3e5f6a7b8c9d0"
const OTHER_USER_ID = "68b1f0c2a4d3e5f6a7b8c9d1"

describe("session store", () => {
  let mongo: TestMongo
  let container: TestRedis
  let redis: Redis
  let sessions: SessionStore

  before(async () => {
    ;[mongo, container] = await Promise.all([
      startTestMongo(),
      startTestRedis(),
    ])
    redis = container.redis
    sessions = createSessionStore(redis)

    // Builds the schema's indexes once, so the TTL and unique indexes exist
    // rather than being created lazily part-way through the suite.
    await SessionModel.init()
  })

  after(async () => {
    await Promise.all([mongo.stop(), container.stop()])
  })

  beforeEach(async () => {
    await Promise.all([redis.flushall(), mongo.clear()])
  })

  describe("state", () => {
    it("issues values that are unguessable and never repeat", async () => {
      const issued = await Promise.all(
        Array.from({ length: 10 }, () => sessions.createState())
      )

      assert.equal(new Set(issued).size, 10)
      // 32 bytes of base64url, so no padding and comfortably over 40 chars.
      issued.forEach((state) => assert.match(state, /^[\w-]{43}$/))
    })

    it("accepts a state once and never again", async () => {
      const state = await sessions.createState()

      assert.equal(await sessions.consumeState(state), true)
      assert.equal(await sessions.consumeState(state), false)
    })

    it("rejects a state it never issued", async () => {
      assert.equal(await sessions.consumeState("forged"), false)
    })

    it("expires an abandoned state", async () => {
      const state = await sessions.createState()

      assert.equal(await redis.ttl(`oauth:state:${state}`), STATE_TTL)
    })

    it("never touches Mongo", async () => {
      const state = await sessions.createState()
      await sessions.consumeState(state)

      assert.equal(await SessionModel.countDocuments(), 0)
    })
  })

  describe("createSession", () => {
    it("writes Mongo as the source of truth", async () => {
      const sid = await sessions.createSession(USER_ID)
      const document = await SessionModel.findOne({ sid })

      assert.equal(document?.userId.toString(), USER_ID)
      assert.ok(document && document.expiresAt > new Date())
    })

    it("caches the session it just wrote", async () => {
      const sid = await sessions.createSession(USER_ID)

      assert.equal(await redis.exists(`session:${sid}`), 1)
      assert.equal(await redis.ttl(`session:${sid}`), CACHE_TTL)
    })

    it("dates the session by SESSION_TTL, not by the cache", async () => {
      const sid = await sessions.createSession(USER_ID)
      const document = await SessionModel.findOne({ sid })

      const lifetime = Number(document?.expiresAt) - Number(document?.createdAt)
      assert.ok(Math.abs(lifetime / 1000 - SESSION_TTL) < 5)
    })
  })

  describe("getSession", () => {
    it("resolves a session to its user", async () => {
      const sid = await sessions.createSession(USER_ID)
      const session = await sessions.getSession(sid)

      assert.equal(session?.userId, USER_ID)
      assert.ok(session?.createdAt instanceof Date)
      assert.ok(session?.expiresAt instanceof Date)
    })

    it("returns null for an unknown session", async () => {
      assert.equal(await sessions.getSession("not-a-session"), null)
    })

    it("survives a flushed cache", async () => {
      const sid = await sessions.createSession(USER_ID)

      await redis.flushall()

      assert.equal((await sessions.getSession(sid))?.userId, USER_ID)
    })

    it("refills the cache after a miss", async () => {
      const sid = await sessions.createSession(USER_ID)
      await redis.flushall()

      await sessions.getSession(sid)

      assert.equal(await redis.exists(`session:${sid}`), 1)
    })

    it("caps the cache at the session's remaining life", async () => {
      const sid = "expiring-soon"
      await SessionModel.create({
        sid,
        userId: USER_ID,
        expiresAt: new Date(Date.now() + 30_000),
      })

      await sessions.getSession(sid)

      const ttl = await redis.ttl(`session:${sid}`)
      assert.ok(ttl > 0 && ttl <= 30, `expected a TTL under 30s, got ${ttl}`)
    })

    it("ignores an expired session the TTL index has not swept yet", async () => {
      const sid = "already-expired"
      await SessionModel.create({
        sid,
        userId: USER_ID,
        expiresAt: new Date(Date.now() - 1000),
      })

      assert.equal(await sessions.getSession(sid), null)
    })
  })

  describe("deleteSession", () => {
    it("ends that session and leaves the others signed in", async () => {
      const laptop = await sessions.createSession(USER_ID)
      const phone = await sessions.createSession(USER_ID)

      await sessions.deleteSession(laptop)

      assert.equal(await sessions.getSession(laptop), null)
      assert.equal((await sessions.getSession(phone))?.userId, USER_ID)
    })

    it("clears both stores, so nothing answers from cache", async () => {
      const sid = await sessions.createSession(USER_ID)

      await sessions.deleteSession(sid)

      assert.equal(await redis.exists(`session:${sid}`), 0)
      assert.equal(await SessionModel.countDocuments({ sid }), 0)
    })

    it("is safe to call twice", async () => {
      const sid = await sessions.createSession(USER_ID)

      await sessions.deleteSession(sid)

      await assert.doesNotReject(sessions.deleteSession(sid))
    })

    it("leaves other users signed in", async () => {
      const mine = await sessions.createSession(USER_ID)
      const theirs = await sessions.createSession(OTHER_USER_ID)

      await sessions.deleteSession(mine)

      assert.equal(await sessions.getSession(mine), null)
      assert.ok(await sessions.getSession(theirs))
    })
  })
})
