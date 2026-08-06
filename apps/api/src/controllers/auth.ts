import type { Context } from "hono"

import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchViewer,
} from "../clients/github.js"
import { env } from "../env.js"
import type { AuthEnv } from "../middleware/auth.js"
import { Account } from "../models/account.js"
import { User } from "../models/user.js"
import { signInWithProvider } from "../services/auth.js"
import type { SessionStore } from "../services/session.js"
import {
  clearStateCookie,
  readStateCookie,
  setSessionCookie,
  setStateCookie,
} from "../utils/cookie.js"

// A browser lands here, not a fetch client, so a failure ends as a redirect
// carrying a short code rather than as a JSON error body.
const landing = (error?: string): string =>
  error === undefined
    ? env.origin
    : `${env.origin}/?error=${encodeURIComponent(error)}`

export const createAuthController = (sessions: SessionStore) => {
  /** Step one: hand the browser to GitHub, holding a `state` on both sides. */
  const authorize = async (c: Context) => {
    const state = await sessions.createState()

    setStateCookie(c, state)

    return c.redirect(buildAuthorizeUrl(state))
  }

  /** Step two: GitHub returns the browser here with a `code` worth trading. */
  const callback = async (c: Context) => {
    const code = c.req.query("code")
    const state = c.req.query("state")
    const denied = c.req.query("error")

    const expected = readStateCookie(c)

    // However this ends, the attempt is spent the moment we have read it.
    clearStateCookie(c)

    // A cancelled consent screen arrives here as a query param, not as a
    // failed request. The reason is GitHub's text, so it is not echoed on.
    if (denied !== undefined) {
      return c.redirect(landing("access_denied"))
    }

    if (code === undefined || state === undefined) {
      return c.redirect(landing("invalid_request"))
    }

    // Redis proves we issued this state and nobody has spent it; the cookie
    // proves the browser finishing the flow is the one that began it. Without
    // the second, an attacker can sign a victim into the attacker's account.
    const issued = await sessions.consumeState(state)

    if (!issued || expected !== state) {
      return c.redirect(landing("invalid_state"))
    }

    try {
      const grant = await exchangeCodeForToken(code)
      const profile = await fetchViewer(grant.accessToken)
      const userId = await signInWithProvider(profile, grant)

      setSessionCookie(c, await sessions.createSession(userId))
    } catch (error) {
      // Why it broke belongs in our logs, not in a URL the user can read.
      console.error("github callback failed:", error)

      return c.redirect(landing("provider_error"))
    }

    return c.redirect(landing())
  }

  /**
   * Who the session cookie belongs to. Runs behind `requireAuth`, so reaching
   * this means the caller is signed in and `userId` is already resolved.
   */
  const me = async (c: Context<AuthEnv>) => {
    const userId = c.get("userId")

    const [user, account] = await Promise.all([
      User.findById(userId),
      Account.findOne({ userId }),
    ])

    // A live session pointing at a deleted user. Nobody left to describe, so
    // it is the same answer as never having signed in.
    if (user === null) {
      return c.json({ error: "unauthorized" }, 401)
    }

    // Serialising the account runs its `toJSON`, which drops the encrypted
    // tokens. `null` only if the user somehow has no provider account.
    return c.json({ user: user.toJSON(), account: account?.toJSON() ?? null })
  }

  return { authorize, callback, me }
}
