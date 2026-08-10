import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { after, afterEach, before, beforeEach, describe, it } from "node:test"

// Safe to import statically: neither reads the environment.
import { Types } from "mongoose"

import type { TestMongo } from "../test/containers.js"
import type { ProviderProfile, TokenGrant } from "../types.js"

// Assigned before any module reads them, so these tests never depend on what
// `.env` holds. The value imports below must stay dynamic: a static one would
// be hoisted above these assignments.
process.env.PORT = "3001"
process.env.ORIGIN = "http://localhost:3000"
process.env.MONGO_URL = "mongodb://127.0.0.1:27017"
process.env.MONGO_DB = "verbatim-test"
process.env.REDIS_URL = "redis://127.0.0.1:6379"
process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64")
process.env.GITHUB_CLIENT_ID = "test-client-id"
process.env.GITHUB_CLIENT_SECRET = "test-client-secret"
process.env.GITHUB_CALLBACK_URL = "http://localhost:3001/auth/github/callback"

const { Account } = await import("../models/account.js")
const { Repository } = await import("../models/repository.js")
const { User } = await import("../models/user.js")
const { startTestMongo } = await import("../test/containers.js")
const { ProviderError } = await import("../types.js")
const { signInWithProvider } = await import("./auth.js")
const {
  connectRepository,
  disconnectRepository,
  listAvailableRepositories,
  listConnectedRepositories,
} = await import("./repository.js")

const TOKEN = "gho_16C7e42F292c6912E7710c838347Ae178B4a"

const PROFILE: ProviderProfile = {
  provider: "github",
  providerId: "583231",
  username: "octocat",
  name: "The Octocat",
  email: "octocat@github.com",
  avatarUrl: "https://avatars.githubusercontent.com/u/583231",
}

const GRANT: TokenGrant = {
  accessToken: TOKEN,
  refreshToken: null,
  expiresAt: null,
  scopes: ["read:user", "user:email"],
}

/** One repository as GitHub returns it. */
const REPO = {
  id: 1296269,
  name: "Hello-World",
  owner: { login: "octocat" },
  default_branch: "main",
  description: "My first repository on GitHub!",
  pushed_at: "2011-01-26T19:06:43Z",
}

const realFetch = globalThis.fetch

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status })

/** Stands in for GitHub, so nothing here touches the network. */
const stubGitHub = (handler: (url: string) => Response): void => {
  globalThis.fetch = ((input: string | URL | Request) =>
    Promise.resolve(handler(String(input)))) as typeof fetch
}

/** Signs a user in so there is an account holding a usable token. */
const signIn = (): Promise<string> => signInWithProvider(PROFILE, GRANT)

let mongo: TestMongo

before(async () => {
  mongo = await startTestMongo()

  // Builds the unique indexes up front, without which the race below has
  // nothing to collide against.
  await Promise.all([Account.init(), Repository.init(), User.init()])
})

after(async () => {
  await mongo.stop()
})

beforeEach(async () => {
  await mongo.clear()
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe("listConnectedRepositories", () => {
  it("is empty before anything is connected", async () => {
    const userId = await signIn()

    assert.deepEqual(await listConnectedRepositories(userId), [])
  })

  it("returns what was connected", async () => {
    const userId = await signIn()

    stubGitHub(() => json(REPO))
    await connectRepository(userId, "1296269")

    const connected = await listConnectedRepositories(userId)

    assert.equal(connected.length, 1)
    assert.equal(connected[0]?.name, "Hello-World")
  })

  it("hides a disconnected repository", async () => {
    const userId = await signIn()

    stubGitHub(() => json(REPO))
    const repository = await connectRepository(userId, "1296269")

    await disconnectRepository(userId, repository._id.toString())

    assert.deepEqual(await listConnectedRepositories(userId), [])
  })

  it("never returns another user's repositories", async () => {
    const owner = await signIn()

    stubGitHub(() => json(REPO))
    await connectRepository(owner, "1296269")

    const stranger = await User.create({})

    assert.deepEqual(
      await listConnectedRepositories(stranger._id.toString()),
      []
    )
  })

  it("reads Mongo alone, so the provider is never called", async () => {
    const userId = await signIn()

    // Any request at all fails the test: this runs on every page load and
    // must not depend on GitHub being reachable.
    stubGitHub(() => {
      throw new Error("listConnectedRepositories must not call the provider")
    })

    assert.deepEqual(await listConnectedRepositories(userId), [])
  })
})

describe("listAvailableRepositories", () => {
  it("marks nothing as connected on a fresh account", async () => {
    const userId = await signIn()

    stubGitHub(() => json([REPO]))

    const available = await listAvailableRepositories(userId)

    assert.equal(available.length, 1)
    assert.equal(available[0]?.isConnected, false)
    assert.equal(available[0]?.providerId, "1296269")
  })

  it("marks a repository that is already connected", async () => {
    const userId = await signIn()

    stubGitHub((url) =>
      url.includes("/user/repos") ? json([REPO]) : json(REPO)
    )

    await connectRepository(userId, "1296269")

    assert.equal(
      (await listAvailableRepositories(userId))[0]?.isConnected,
      true
    )
  })

  it("stops marking one that was disconnected again", async () => {
    const userId = await signIn()

    stubGitHub((url) =>
      url.includes("/user/repos") ? json([REPO]) : json(REPO)
    )

    const repository = await connectRepository(userId, "1296269")
    await disconnectRepository(userId, repository._id.toString())

    assert.equal(
      (await listAvailableRepositories(userId))[0]?.isConnected,
      false
    )
  })

  it("records the credentials as revoked when the provider rejects them", async () => {
    const userId = await signIn()

    stubGitHub(() => json({ message: "Bad credentials" }, 401))

    await assert.rejects(listAvailableRepositories(userId))

    const account = await Account.findOne({ userId })

    assert.equal(account?.isRevoked, true)
  })

  it("refuses outright once the credentials are known dead", async () => {
    const userId = await signIn()

    await Account.updateOne({ userId }, { isRevoked: true })

    // Nothing should reach GitHub: we already know the answer.
    stubGitHub(() => {
      throw new Error("must not call the provider with dead credentials")
    })

    await assert.rejects(
      listAvailableRepositories(userId),
      (error: unknown) => {
        assert.ok(error instanceof ProviderError)
        assert.equal(error.status, 401)

        return true
      }
    )
  })

  it("leaves the credentials alone when the provider merely fails", async () => {
    const userId = await signIn()

    stubGitHub(() => json({ message: "server error" }, 500))

    await assert.rejects(listAvailableRepositories(userId))

    // A bad day at GitHub is not evidence that the token died.
    assert.equal((await Account.findOne({ userId }))?.isRevoked, false)
  })
})

describe("connectRepository", () => {
  it("stores what the provider returned, not what was asked for", async () => {
    const userId = await signIn()

    // The caller only chose an id. Everything else comes from this response.
    stubGitHub(() => json({ ...REPO, owner: { login: "monalisa" } }))

    const repository = await connectRepository(userId, "1296269")

    assert.equal(repository.owner, "monalisa")
    assert.equal(repository.name, "Hello-World")
    assert.equal(repository.defaultBranch, "main")
    assert.equal(repository.providerId, "1296269")
    assert.equal(repository.userId.toString(), userId)
  })

  it("looks the repository up by the id it was given", async () => {
    const userId = await signIn()

    let requested: string | null = null

    stubGitHub((url) => {
      requested = url

      return json(REPO)
    })

    await connectRepository(userId, "1296269")

    assert.equal(requested, "https://api.github.com/repositories/1296269")
  })

  it("connects twice without creating a second document", async () => {
    const userId = await signIn()

    stubGitHub(() => json(REPO))

    await connectRepository(userId, "1296269")
    await connectRepository(userId, "1296269")

    assert.equal(await Repository.countDocuments(), 1)
  })

  it("creates one document when two clicks race", async () => {
    const userId = await signIn()

    stubGitHub(() => json(REPO))

    await Promise.all([
      connectRepository(userId, "1296269"),
      connectRepository(userId, "1296269"),
    ])

    assert.equal(await Repository.countDocuments(), 1)
  })

  it("brings a disconnected repository back", async () => {
    const userId = await signIn()

    stubGitHub(() => json(REPO))

    const first = await connectRepository(userId, "1296269")
    await disconnectRepository(userId, first._id.toString())

    const second = await connectRepository(userId, "1296269")

    assert.equal(second._id.toString(), first._id.toString())
    assert.equal(second.disconnectedAt, null)
    assert.equal(await Repository.countDocuments(), 1)
  })

  it("refreshes the cached owner and name on reconnect", async () => {
    const userId = await signIn()

    stubGitHub(() => json(REPO))
    await connectRepository(userId, "1296269")

    stubGitHub(() =>
      json({ ...REPO, name: "goodbye-world", owner: { login: "monalisa" } })
    )
    const renamed = await connectRepository(userId, "1296269")

    assert.equal(renamed.owner, "monalisa")
    assert.equal(renamed.name, "goodbye-world")
  })

  it("writes nothing for a repository the user cannot see", async () => {
    const userId = await signIn()

    stubGitHub(() => json({ message: "Not Found" }, 404))

    await assert.rejects(connectRepository(userId, "999"), (error: unknown) => {
      assert.ok(error instanceof ProviderError)
      assert.equal(error.status, 404)

      return true
    })

    assert.equal(await Repository.countDocuments(), 0)
  })

  it("treats a 404 as someone else's repository, not a dead token", async () => {
    const userId = await signIn()

    stubGitHub(() => json({ message: "Not Found" }, 404))

    await assert.rejects(connectRepository(userId, "999"))

    assert.equal((await Account.findOne({ userId }))?.isRevoked, false)
  })
})

describe("disconnectRepository", () => {
  it("marks the connection ended without deleting it", async () => {
    const userId = await signIn()

    stubGitHub(() => json(REPO))
    const repository = await connectRepository(userId, "1296269")

    assert.equal(
      await disconnectRepository(userId, repository._id.toString()),
      true
    )

    // The document survives, which is what keeps its conversations readable.
    const stored = await Repository.findById(repository._id)

    assert.ok(stored?.disconnectedAt instanceof Date)
    assert.equal(await Repository.countDocuments(), 1)
  })

  it("refuses to disconnect another user's repository", async () => {
    const owner = await signIn()

    stubGitHub(() => json(REPO))
    const repository = await connectRepository(owner, "1296269")

    const stranger = await User.create({})

    assert.equal(
      await disconnectRepository(
        stranger._id.toString(),
        repository._id.toString()
      ),
      false
    )
    assert.equal(
      (await Repository.findById(repository._id))?.disconnectedAt,
      null
    )
  })

  it("reports a miss for an id that was never connected", async () => {
    const userId = await signIn()
    const absent = new Types.ObjectId().toString()

    assert.equal(await disconnectRepository(userId, absent), false)
  })

  it("reports a miss rather than throwing on a malformed id", async () => {
    const userId = await signIn()

    // Straight from a URL, so it can be anything at all.
    assert.equal(await disconnectRepository(userId, "not-an-object-id"), false)
  })

  it("is a no-op the second time", async () => {
    const userId = await signIn()

    stubGitHub(() => json(REPO))
    const repository = await connectRepository(userId, "1296269")
    const id = repository._id.toString()

    assert.equal(await disconnectRepository(userId, id), true)
    assert.equal(await disconnectRepository(userId, id), false)
  })
})
