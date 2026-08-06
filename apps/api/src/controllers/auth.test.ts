import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { after, afterEach, before, beforeEach, describe, it } from "node:test"

import type { Hono as HonoApp } from "hono"

import type { AuthEnv } from "../middleware/auth.js"
import type { SessionStore } from "../services/session.js"
import type { TestMongo, TestRedis } from "../test/containers.js"

// Assigned before any module reads it, so these tests assert fixed values
// rather than whatever `.env` holds. The value imports below must stay
// dynamic: a static one is hoisted above these assignments.
process.env.PORT = "3001"
process.env.ORIGIN = "http://localhost:3000"
process.env.MONGO_URL = "mongodb://127.0.0.1:27017"
process.env.MONGO_DB = "verbatim-test"
process.env.REDIS_URL = "redis://127.0.0.1:6379"
process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64")
process.env.GITHUB_CLIENT_ID = "test-client-id"
process.env.GITHUB_CLIENT_SECRET = "test-client-secret"
process.env.GITHUB_CALLBACK_URL = "http://localhost:3001/auth/github/callback"

const { Hono } = await import("hono")
const { Account } = await import("../models/account.js")
const { User } = await import("../models/user.js")
const { Session } = await import("../models/session.js")
const { createSessionStore } = await import("../services/session.js")
const { startTestMongo, startTestRedis } = await import("../test/containers.js")
const { createAuthRoutes } = await import("../routes/auth.js")

const ORIGIN = "http://localhost:3000"
const TOKEN = "gho_16C7e42F292c6912E7710c838347Ae178B4a"

const VIEWER = {
  id: 583231,
  login: "octocat",
  name: "The Octocat",
  email: "octocat@github.com",
  avatar_url: "https://avatars.githubusercontent.com/u/583231",
}

const realFetch = globalThis.fetch

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status })

/** Stands in for GitHub, so no test here touches the network. */
const stubGitHub = (
  overrides: { token?: () => Response; user?: () => Response } = {}
): void => {
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input)

    if (url.includes("login/oauth/access_token")) {
      return Promise.resolve(
        overrides.token?.() ??
          json({ access_token: TOKEN, scope: "read:user,user:email" })
      )
    }

    if (url.endsWith("/user")) {
      return Promise.resolve(overrides.user?.() ?? json(VIEWER))
    }

    return Promise.resolve(json({ message: `unexpected ${url}` }, 404))
  }) as typeof fetch
}

/** The value of one `Set-Cookie`, or `null` if the response did not set it. */
const cookieValue = (response: Response, name: string): string | null => {
  for (const header of response.headers.getSetCookie()) {
    const [pair = ""] = header.split(";")
    const [key, ...rest] = pair.split("=")

    if (key === name) {
      return rest.join("=")
    }
  }

  return null
}

describe("auth controller", () => {
  let mongo: TestMongo
  let container: TestRedis
  let sessions: SessionStore
  let app: HonoApp<AuthEnv>

  before(async () => {
    ;[mongo, container] = await Promise.all([
      startTestMongo(),
      startTestRedis(),
    ])

    sessions = createSessionStore(container.redis)
    app = new Hono<AuthEnv>()
    app.route("/auth", createAuthRoutes(sessions))

    await Promise.all([Account.init(), User.init(), Session.init()])
  })

  after(async () => {
    await Promise.all([mongo.stop(), container.stop()])
  })

  beforeEach(async () => {
    await Promise.all([container.redis.flushall(), mongo.clear()])
  })

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  /** Starts a flow, returning the state and the cookie holding it. */
  const start = async () => {
    const response = await app.request("/auth/github")
    const location = new URL(response.headers.get("location")!)

    return {
      response,
      state: location.searchParams.get("state")!,
      cookie: `verbatim_oauth_state=${cookieValue(response, "verbatim_oauth_state")}`,
    }
  }

  /** Runs a whole sign-in, returning the session cookie it plants. */
  const signIn = async () => {
    stubGitHub()

    const { state, cookie } = await start()
    const response = await app.request(
      `/auth/github/callback?code=abc&state=${state}`,
      { headers: { cookie } }
    )

    return `verbatim_session=${cookieValue(response, "verbatim_session")}`
  }

  describe("GET /auth/github", () => {
    it("redirects to GitHub's consent screen", async () => {
      const { response } = await start()

      assert.equal(response.status, 302)
      assert.ok(
        response.headers
          .get("location")
          ?.startsWith("https://github.com/login/oauth/authorize?")
      )
    })

    it("carries a state that matches the cookie it plants", async () => {
      const { state, cookie } = await start()

      assert.match(state, /^[\w-]{43}$/)
      assert.equal(cookie, `verbatim_oauth_state=${state}`)
    })

    it("keeps the state cookie out of reach of scripts", async () => {
      const { response } = await start()
      const [header = ""] = response.headers.getSetCookie()

      assert.match(header, /HttpOnly/i)
    })

    it("never puts the client secret in the URL", async () => {
      const { response } = await start()

      assert.ok(
        !response.headers.get("location")?.includes("test-client-secret")
      )
    })
  })

  describe("GET /auth/github/callback", () => {
    it("signs the user in and hands the browser back to the app", async () => {
      stubGitHub()

      const { state, cookie } = await start()
      const response = await app.request(
        `/auth/github/callback?code=abc&state=${state}`,
        { headers: { cookie } }
      )

      assert.equal(response.status, 302)
      assert.equal(response.headers.get("location"), ORIGIN)

      const sid = cookieValue(response, "verbatim_session")

      assert.ok(sid)

      const session = await sessions.getSession(sid)
      const user = await User.findOne({})

      assert.ok(session !== null)
      assert.ok(user !== null)
      assert.equal(session.userId, user._id.toString())
      assert.equal(user.name, "The Octocat")
    })

    it("stores the account against the signed-in user", async () => {
      stubGitHub()

      const { state, cookie } = await start()

      await app.request(`/auth/github/callback?code=abc&state=${state}`, {
        headers: { cookie },
      })

      const account = await Account.findOne({})

      assert.ok(account !== null)
      assert.equal(account.providerId, "583231")
      assert.equal(account.getAccessToken(), TOKEN)
    })

    it("spends the state cookie, whatever the outcome", async () => {
      stubGitHub()

      const { state, cookie } = await start()
      const response = await app.request(
        `/auth/github/callback?code=abc&state=${state}`,
        { headers: { cookie } }
      )

      assert.equal(cookieValue(response, "verbatim_oauth_state"), "")
    })

    // Login CSRF: an attacker holds a state we really did issue and feeds a
    // victim the callback URL. Only the missing cookie separates the two.
    it("refuses a valid state arriving without its cookie", async () => {
      stubGitHub()

      const { state } = await start()
      const response = await app.request(
        `/auth/github/callback?code=abc&state=${state}`
      )

      assert.equal(
        response.headers.get("location"),
        `${ORIGIN}/?error=invalid_state`
      )
      assert.equal(cookieValue(response, "verbatim_session"), null)
      assert.equal(await User.countDocuments(), 0)
    })

    it("refuses a state we never issued, cookie or not", async () => {
      stubGitHub()

      const forged = "f".repeat(43)
      const response = await app.request(
        `/auth/github/callback?code=abc&state=${forged}`,
        { headers: { cookie: `verbatim_oauth_state=${forged}` } }
      )

      assert.equal(
        response.headers.get("location"),
        `${ORIGIN}/?error=invalid_state`
      )
      assert.equal(cookieValue(response, "verbatim_session"), null)
    })

    it("refuses a cookie that disagrees with the query", async () => {
      stubGitHub()

      const mine = await start()
      const theirs = await start()

      const response = await app.request(
        `/auth/github/callback?code=abc&state=${theirs.state}`,
        { headers: { cookie: mine.cookie } }
      )

      assert.equal(
        response.headers.get("location"),
        `${ORIGIN}/?error=invalid_state`
      )
      assert.equal(cookieValue(response, "verbatim_session"), null)
    })

    it("refuses a state that has already been spent", async () => {
      stubGitHub()

      const { state, cookie } = await start()
      const replay = () =>
        app.request(`/auth/github/callback?code=abc&state=${state}`, {
          headers: { cookie },
        })

      const first = await replay()
      const second = await replay()

      assert.equal(first.headers.get("location"), ORIGIN)
      assert.equal(
        second.headers.get("location"),
        `${ORIGIN}/?error=invalid_state`
      )
      // The replay must not have opened a second session or a second user.
      assert.equal(await User.countDocuments(), 1)
    })

    it("reports a cancelled consent screen", async () => {
      const response = await app.request(
        "/auth/github/callback?error=access_denied"
      )

      assert.equal(
        response.headers.get("location"),
        `${ORIGIN}/?error=access_denied`
      )
    })

    it("does not echo GitHub's error text back into the URL", async () => {
      const response = await app.request(
        "/auth/github/callback?error=%3Cscript%3E"
      )

      assert.equal(
        response.headers.get("location"),
        `${ORIGIN}/?error=access_denied`
      )
    })

    it("rejects a callback with no code", async () => {
      const { state, cookie } = await start()
      const response = await app.request(
        `/auth/github/callback?state=${state}`,
        { headers: { cookie } }
      )

      assert.equal(
        response.headers.get("location"),
        `${ORIGIN}/?error=invalid_request`
      )
    })

    it("survives GitHub refusing the exchange", async () => {
      stubGitHub({ token: () => json({ error: "bad_verification_code" }) })

      const { state, cookie } = await start()
      const response = await app.request(
        `/auth/github/callback?code=abc&state=${state}`,
        { headers: { cookie } }
      )

      assert.equal(
        response.headers.get("location"),
        `${ORIGIN}/?error=provider_error`
      )
      assert.equal(cookieValue(response, "verbatim_session"), null)
      assert.equal(await User.countDocuments(), 0)
    })

    it("survives GitHub refusing to name the viewer", async () => {
      stubGitHub({ user: () => json({ message: "Bad credentials" }, 401) })

      const { state, cookie } = await start()
      const response = await app.request(
        `/auth/github/callback?code=abc&state=${state}`,
        { headers: { cookie } }
      )

      assert.equal(
        response.headers.get("location"),
        `${ORIGIN}/?error=provider_error`
      )
      assert.equal(await User.countDocuments(), 0)
    })
  })

  describe("GET /auth/me", () => {
    it("describes the user the cookie belongs to", async () => {
      const cookie = await signIn()
      const response = await app.request("/auth/me", { headers: { cookie } })

      assert.equal(response.status, 200)

      const body = (await response.json()) as {
        user: { _id: string; name: string; email: string }
      }
      const user = await User.findOne({})

      assert.equal(body.user._id, user?._id.toString())
      assert.equal(body.user.name, "The Octocat")
      assert.equal(body.user.email, "octocat@github.com")
    })

    it("names the provider account behind that user", async () => {
      const cookie = await signIn()
      const response = await app.request("/auth/me", { headers: { cookie } })

      const body = (await response.json()) as {
        account: { provider: string; providerId: string; scopes: string[] }
      }

      assert.equal(body.account.provider, "github")
      assert.equal(body.account.providerId, "583231")
      assert.deepEqual(body.account.scopes, ["read:user", "user:email"])
    })

    // The account holds the GitHub token. `toJSON` strips it, and this is the
    // route that would otherwise hand it to anything running in the browser.
    it("never leaks the tokens the account holds", async () => {
      const cookie = await signIn()
      const response = await app.request("/auth/me", { headers: { cookie } })
      const body = await response.text()

      assert.ok(!body.includes(TOKEN))
      assert.ok(!body.includes("encryptedAccessToken"))
      assert.ok(!body.includes("encryptedRefreshToken"))
    })

    it("refuses a request carrying no session cookie", async () => {
      const response = await app.request("/auth/me")

      assert.equal(response.status, 401)
      assert.deepEqual(await response.json(), { error: "unauthorized" })
    })

    it("refuses a session id we never issued", async () => {
      const response = await app.request("/auth/me", {
        headers: { cookie: `verbatim_session=${"f".repeat(43)}` },
      })

      assert.equal(response.status, 401)
    })

    it("refuses a session that has ended", async () => {
      const cookie = await signIn()

      await sessions.deleteSession(cookie.slice("verbatim_session=".length))

      const response = await app.request("/auth/me", { headers: { cookie } })

      assert.equal(response.status, 401)
    })

    // Expiry is enforced by the query, not by Mongo's TTL index, which sweeps
    // on its own schedule. Flushing Redis forces the read past the cache.
    it("refuses a session that expired but has not been swept", async () => {
      const cookie = await signIn()
      const sid = cookie.slice("verbatim_session=".length)

      await Session.updateOne({ sid }, { expiresAt: new Date(Date.now() - 1) })
      await container.redis.flushall()

      const response = await app.request("/auth/me", { headers: { cookie } })

      assert.equal(response.status, 401)
    })
  })
})
