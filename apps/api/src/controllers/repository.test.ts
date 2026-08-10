import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { after, afterEach, before, beforeEach, describe, it } from "node:test"

import type { Hono as HonoApp } from "hono"

import type { AuthEnv } from "../middleware/auth.js"
import type { SessionStore } from "../services/session.js"
import type { TestMongo, TestRedis } from "../test/containers.js"
import type { ProviderProfile, TokenGrant } from "../types.js"

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
const { Types } = await import("mongoose")
const { Account } = await import("../models/account.js")
const { Repository } = await import("../models/repository.js")
const { Session } = await import("../models/session.js")
const { User } = await import("../models/user.js")
const { createSessionStore } = await import("../services/session.js")
const { signInWithProvider } = await import("../services/auth.js")
const { connectRepository } = await import("../services/repository.js")
const { startTestMongo, startTestRedis } = await import("../test/containers.js")
const { createAuthRoutes } = await import("../routes/auth.js")
const { createRepositoryRoutes } = await import("../routes/repository.js")

const TOKEN = "gho_16C7e42F292c6912E7710c838347Ae178B4a"

const VIEWER = {
  id: 583231,
  login: "octocat",
  name: "The Octocat",
  email: "octocat@github.com",
  avatar_url: "https://avatars.githubusercontent.com/u/583231",
}

/** Two repositories, named so that GitHub's order is not Mongo's order. */
const HELLO = {
  id: 1296269,
  name: "Hello-World",
  owner: { login: "octocat" },
  default_branch: "main",
  description: "My first repository on GitHub!",
  pushed_at: "2011-01-26T19:06:43Z",
}

const AARDVARK = {
  id: 1296270,
  name: "Aardvark",
  owner: { login: "octocat" },
  default_branch: "trunk",
  description: null,
  pushed_at: null,
}

const REPOS = [HELLO, AARDVARK]

/** Somebody else entirely, for the tests that prove one user cannot see another. */
const STRANGER: ProviderProfile = {
  provider: "github",
  providerId: "1",
  username: "mojombo",
  name: "Tom",
  email: "tom@github.com",
  avatarUrl: null,
}

const GRANT: TokenGrant = {
  accessToken: TOKEN,
  refreshToken: null,
  expiresAt: null,
  scopes: ["read:user", "user:email"],
}

const realFetch = globalThis.fetch

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status })

/**
 * Stands in for GitHub, so no test here touches the network. The overrides are
 * per endpoint, since most tests need the sign-in half to succeed while the
 * repository half fails.
 */
const stubGitHub = (
  overrides: { repos?: () => Response; repo?: () => Response } = {}
): void => {
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input)

    if (url.includes("login/oauth/access_token")) {
      return Promise.resolve(
        json({ access_token: TOKEN, scope: "read:user,user:email" })
      )
    }

    if (url.includes("/user/repos")) {
      return Promise.resolve(overrides.repos?.() ?? json(REPOS))
    }

    if (url.includes("/repositories/")) {
      const [, id = ""] = url.split("/repositories/")
      const found = REPOS.find((repository) => String(repository.id) === id)

      return Promise.resolve(
        overrides.repo?.() ??
          (found === undefined ? json({ message: "Not Found" }, 404) : json(found))
      )
    }

    if (url.endsWith("/user")) {
      return Promise.resolve(json(VIEWER))
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

interface ListedRepository {
  _id: string
  owner: string
  name: string
  providerId: string
  defaultBranch: string
  disconnectedAt: string | null
}

describe("repository controller", () => {
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
    app.route("/repositories", createRepositoryRoutes(sessions))

    await Promise.all([
      Account.init(),
      Repository.init(),
      Session.init(),
      User.init(),
    ])
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

  /** Runs a whole sign-in, returning the session cookie it plants. */
  const signIn = async (): Promise<string> => {
    stubGitHub()

    const authorize = await app.request("/auth/github")
    const location = new URL(authorize.headers.get("location")!)
    const state = location.searchParams.get("state")!

    const response = await app.request(
      `/auth/github/callback?code=abc&state=${state}`,
      {
        headers: {
          cookie: `verbatim_oauth_state=${cookieValue(authorize, "verbatim_oauth_state")}`,
        },
      }
    )

    return `verbatim_session=${cookieValue(response, "verbatim_session")}`
  }

  const list = (cookie?: string) =>
    app.request("/repositories", {
      headers: cookie === undefined ? {} : { cookie },
    })

  const available = (cookie?: string) =>
    app.request("/repositories/available", {
      headers: cookie === undefined ? {} : { cookie },
    })

  const post = (body: string, cookie?: string) =>
    app.request("/repositories", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        ...(cookie === undefined ? {} : { cookie }),
      },
    })

  const connect = (providerId: string, cookie: string) =>
    post(JSON.stringify({ providerId }), cookie)

  const disconnect = (id: string, cookie?: string) =>
    app.request(`/repositories/${id}`, {
      method: "DELETE",
      headers: cookie === undefined ? {} : { cookie },
    })

  /** Connects a repository to somebody who is not the caller. */
  const connectAsStranger = async (providerId: string): Promise<string> => {
    const userId = await signInWithProvider(STRANGER, GRANT)
    const repository = await connectRepository(userId, providerId)

    return repository._id.toString()
  }

  describe("GET /repositories", () => {
    it("refuses a request carrying no session cookie", async () => {
      const response = await list()

      assert.equal(response.status, 401)
      assert.deepEqual(await response.json(), { error: "unauthorized" })
    })

    it("is empty before anything is connected", async () => {
      const cookie = await signIn()
      const response = await list(cookie)

      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { repositories: [] })
    })

    it("returns what was connected", async () => {
      const cookie = await signIn()

      await connect("1296269", cookie)

      const response = await list(cookie)
      const body = (await response.json()) as {
        repositories: ListedRepository[]
      }

      assert.equal(body.repositories.length, 1)
      assert.equal(body.repositories[0]?.owner, "octocat")
      assert.equal(body.repositories[0]?.name, "Hello-World")
      assert.equal(body.repositories[0]?.providerId, "1296269")
      assert.ok(body.repositories[0]?._id)
    })

    it("sorts by owner and name rather than by connection order", async () => {
      const cookie = await signIn()

      await connect("1296269", cookie)
      await connect("1296270", cookie)

      const body = (await (await list(cookie)).json()) as {
        repositories: ListedRepository[]
      }

      assert.deepEqual(
        body.repositories.map((repository) => repository.name),
        ["Aardvark", "Hello-World"]
      )
    })

    it("drops a repository that was disconnected", async () => {
      const cookie = await signIn()

      const connected = (await (await connect("1296269", cookie)).json()) as {
        repository: ListedRepository
      }

      await disconnect(connected.repository._id, cookie)

      const body = (await (await list(cookie)).json()) as {
        repositories: ListedRepository[]
      }

      assert.deepEqual(body.repositories, [])
    })

    it("never returns another user's repositories", async () => {
      const cookie = await signIn()

      await connectAsStranger("1296269")

      const body = (await (await list(cookie)).json()) as {
        repositories: ListedRepository[]
      }

      assert.deepEqual(body.repositories, [])
      assert.equal(await Repository.countDocuments(), 1)
    })

    // This runs on every page load, so it must not depend on GitHub being
    // reachable or on a rate limit.
    it("reads Mongo alone, so the provider is never called", async () => {
      const cookie = await signIn()

      await connect("1296269", cookie)

      globalThis.fetch = (() => {
        throw new Error("the connected list must not call the provider")
      }) as unknown as typeof fetch

      const response = await list(cookie)

      assert.equal(response.status, 200)
    })
  })

  describe("GET /repositories/available", () => {
    it("refuses a request carrying no session cookie", async () => {
      const response = await available()

      assert.equal(response.status, 401)
    })

    it("marks nothing as connected on a fresh account", async () => {
      const cookie = await signIn()
      const response = await available(cookie)

      assert.equal(response.status, 200)

      const body = (await response.json()) as {
        repositories: { providerId: string; isConnected: boolean }[]
      }

      assert.equal(body.repositories.length, 2)
      assert.deepEqual(
        body.repositories.map((repository) => repository.isConnected),
        [false, false]
      )
    })

    it("marks a repository that is already connected", async () => {
      const cookie = await signIn()

      await connect("1296269", cookie)

      const body = (await (await available(cookie)).json()) as {
        repositories: { providerId: string; isConnected: boolean }[]
      }

      const hello = body.repositories.find(
        (repository) => repository.providerId === "1296269"
      )
      const aardvark = body.repositories.find(
        (repository) => repository.providerId === "1296270"
      )

      assert.equal(hello?.isConnected, true)
      assert.equal(aardvark?.isConnected, false)
    })

    it("asks the user to reconnect once the credentials are known dead", async () => {
      const cookie = await signIn()

      await Account.updateOne({}, { isRevoked: true })

      const response = await available(cookie)

      assert.equal(response.status, 401)
      assert.deepEqual(await response.json(), { error: "reauth_required" })
    })

    // A 401 from the provider is the token dying, which is almost always the
    // user revoking our access on their end.
    it("records the credentials as revoked when the provider rejects them", async () => {
      const cookie = await signIn()

      stubGitHub({ repos: () => json({ message: "Bad credentials" }, 401) })

      const response = await available(cookie)

      assert.equal(response.status, 401)
      assert.deepEqual(await response.json(), { error: "reauth_required" })
      assert.equal((await Account.findOne({}))?.isRevoked, true)
    })

    // Distinct from the 401 above: the caller did nothing wrong and the token
    // is fine, so the app must not send anyone back through OAuth.
    it("answers 502 when the provider is broken, and keeps the token", async () => {
      const cookie = await signIn()

      stubGitHub({ repos: () => json({ message: "Server Error" }, 500) })

      const response = await available(cookie)

      assert.equal(response.status, 502)
      assert.deepEqual(await response.json(), { error: "provider_error" })
      assert.equal((await Account.findOne({}))?.isRevoked, false)
    })
  })

  describe("POST /repositories", () => {
    it("refuses a request carrying no session cookie", async () => {
      const response = await post(JSON.stringify({ providerId: "1296269" }))

      assert.equal(response.status, 401)
      assert.equal(await Repository.countDocuments(), 0)
    })

    it("connects the repository the body names", async () => {
      const cookie = await signIn()
      const response = await connect("1296269", cookie)

      assert.equal(response.status, 200)

      const body = (await response.json()) as { repository: ListedRepository }

      assert.equal(body.repository.providerId, "1296269")
      assert.equal(body.repository.owner, "octocat")
      assert.equal(body.repository.name, "Hello-World")
      assert.equal(body.repository.defaultBranch, "main")
      assert.equal(body.repository.disconnectedAt, null)
      assert.equal(await Repository.countDocuments(), 1)
    })

    // The whole reason the service re-fetches: otherwise anyone could write a
    // false owner and name over a repository id they are allowed to see.
    it("stores what the provider said, not what the body claimed", async () => {
      const cookie = await signIn()

      const response = await post(
        JSON.stringify({
          providerId: "1296269",
          owner: "attacker",
          name: "totally-legit",
          defaultBranch: "evil",
        }),
        cookie
      )

      assert.equal(response.status, 200)

      const stored = await Repository.findOne({})

      assert.equal(stored?.owner, "octocat")
      assert.equal(stored?.name, "Hello-World")
      assert.equal(stored?.defaultBranch, "main")
    })

    it("rejects a body with no providerId", async () => {
      const cookie = await signIn()
      const response = await post(JSON.stringify({}), cookie)

      assert.equal(response.status, 400)
      assert.deepEqual(await response.json(), { error: "invalid_request" })
    })

    it("rejects a providerId that is blank or the wrong type", async () => {
      const cookie = await signIn()

      for (const providerId of ["", "   ", 1296269, null]) {
        const response = await post(JSON.stringify({ providerId }), cookie)

        assert.equal(response.status, 400)
      }

      assert.equal(await Repository.countDocuments(), 0)
    })

    it("rejects a body that is not JSON at all", async () => {
      const cookie = await signIn()
      const response = await post("not json", cookie)

      assert.equal(response.status, 400)
      assert.deepEqual(await response.json(), { error: "invalid_request" })
    })

    it("answers 404 for a repository the provider will not show", async () => {
      const cookie = await signIn()
      const response = await connect("999999", cookie)

      assert.equal(response.status, 404)
      assert.deepEqual(await response.json(), { error: "not_found" })
      assert.equal(await Repository.countDocuments(), 0)
    })

    it("asks the user to reconnect when the token died mid-connect", async () => {
      const cookie = await signIn()

      stubGitHub({ repo: () => json({ message: "Bad credentials" }, 401) })

      const response = await connect("1296269", cookie)

      assert.equal(response.status, 401)
      assert.deepEqual(await response.json(), { error: "reauth_required" })
    })

    it("is safe to call twice", async () => {
      const cookie = await signIn()

      const first = await connect("1296269", cookie)
      const second = await connect("1296269", cookie)

      assert.equal(first.status, 200)
      assert.equal(second.status, 200)
      assert.equal(await Repository.countDocuments(), 1)
    })

    it("brings back one that was disconnected rather than writing a second", async () => {
      const cookie = await signIn()

      const connected = (await (await connect("1296269", cookie)).json()) as {
        repository: ListedRepository
      }

      await disconnect(connected.repository._id, cookie)
      await connect("1296269", cookie)

      const body = (await (await list(cookie)).json()) as {
        repositories: ListedRepository[]
      }

      assert.equal(body.repositories.length, 1)
      assert.equal(body.repositories[0]?._id, connected.repository._id)
      assert.equal(await Repository.countDocuments(), 1)
    })
  })

  describe("DELETE /repositories/:id", () => {
    /** Connects one and hands back its id. */
    const connected = async (cookie: string): Promise<string> => {
      const body = (await (await connect("1296269", cookie)).json()) as {
        repository: ListedRepository
      }

      return body.repository._id
    }

    it("refuses a request carrying no session cookie", async () => {
      const cookie = await signIn()
      const id = await connected(cookie)

      const response = await disconnect(id)

      assert.equal(response.status, 401)
      assert.equal(await Repository.countDocuments({ disconnectedAt: null }), 1)
    })

    it("disconnects, so the repository leaves the list", async () => {
      const cookie = await signIn()
      const id = await connected(cookie)

      const response = await disconnect(id, cookie)

      assert.equal(response.status, 204)
      assert.equal(await response.text(), "")

      const body = (await (await list(cookie)).json()) as {
        repositories: ListedRepository[]
      }

      assert.deepEqual(body.repositories, [])
    })

    // Soft, so conversations under it stay readable.
    it("leaves the document in place", async () => {
      const cookie = await signIn()
      const id = await connected(cookie)

      await disconnect(id, cookie)

      const stored = await Repository.findById(id)

      assert.ok(stored !== null)
      assert.ok(stored.disconnectedAt !== null)
    })

    it("answers 404 the second time", async () => {
      const cookie = await signIn()
      const id = await connected(cookie)

      assert.equal((await disconnect(id, cookie)).status, 204)

      const second = await disconnect(id, cookie)

      assert.equal(second.status, 404)
      assert.deepEqual(await second.json(), { error: "not_found" })
    })

    it("answers 404 for an id nobody has", async () => {
      const cookie = await signIn()
      const response = await disconnect(new Types.ObjectId().toString(), cookie)

      assert.equal(response.status, 404)
    })

    // A cast error would otherwise escape the service as a 500.
    it("answers 404 for an id that is not an ObjectId", async () => {
      const cookie = await signIn()
      const response = await disconnect("not-an-id", cookie)

      assert.equal(response.status, 404)
    })

    it("answers 404 for another user's repository, leaving it connected", async () => {
      const cookie = await signIn()
      const id = await connectAsStranger("1296269")

      const response = await disconnect(id, cookie)

      assert.equal(response.status, 404)
      assert.equal((await Repository.findById(id))?.disconnectedAt, null)
    })
  })
})
