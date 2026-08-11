import type { MiddlewareHandler } from "hono"

import type { SessionStore } from "../services/session.js"
import { readSessionCookie } from "../utils/cookie.js"

/**
 * What `requireAuth` leaves on the context. Declared once and shared, so the
 * app, its routes, and the handlers behind them agree on what `c.get` holds.
 */
export interface AuthEnv {
  Variables: {
    userId: string
  }
}

/**
 * Turns the session cookie into a `userId`, or answers 401. Every handler
 * mounted behind this can read `c.get("userId")` and trust it.
 *
 * Takes the store as an argument rather than building its own, so it shares
 * one Redis client with the rest of the app and a test can substitute its own.
 */
export const requireAuth = (
  sessions: SessionStore
): MiddlewareHandler<AuthEnv> => {
  return async (c, next) => {
    const sid = readSessionCookie(c)
    const session = sid === null ? null : await sessions.getSession(sid)

    // No cookie, an unknown id, and an expired session are one answer: this
    // request is not signed in. Saying which would only help someone guessing.
    if (session === null) {
      return c.json({ error: { code: "unauthorized" } }, 401)
    }

    c.set("userId", session.userId)

    return next()
  }
}
