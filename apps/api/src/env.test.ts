import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"

const VALID = {
  PORT: "3001",
  ORIGIN: "http://localhost:3000",
  MONGO_URL: "mongodb://127.0.0.1:27017",
  MONGO_DB: "verbatim",
  REDIS_URL: "redis://127.0.0.1:6379",
  TOKEN_ENCRYPTION_KEY: "not-a-real-key",
  GITHUB_CLIENT_ID: "client-id",
  GITHUB_CLIENT_SECRET: "client-secret",
  GITHUB_CALLBACK_URL: "http://localhost:3001/auth/github/callback",
}

const NAMES = Object.keys(VALID)
const MANAGED = [...NAMES, "NODE_ENV"]

const snapshot = Object.fromEntries(
  MANAGED.map((name) => [name, process.env[name]])
)

let bust = 0

const load = async (overrides: Record<string, string | undefined> = {}) => {
  Object.assign(process.env, VALID)

  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = value
    }
  }

  bust += 1

  const module = (await import(
    `./env.js?bust=${bust}`
  )) as typeof import("./env.js")

  return module.env
}

afterEach(() => {
  for (const name of MANAGED) {
    const value = snapshot[name]

    if (value === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = value
    }
  }
})

describe("env", () => {
  it("reads each variable from the environment", async () => {
    const env = await load()

    assert.equal(env.origin, "http://localhost:3000")
    assert.equal(env.mongoUrl, "mongodb://127.0.0.1:27017")
    assert.equal(env.mongoDb, "verbatim")
    assert.equal(env.redisUrl, "redis://127.0.0.1:6379")
    assert.equal(env.tokenEncryptionKey, "not-a-real-key")
  })

  it("groups the GitHub OAuth settings together", async () => {
    const env = await load()

    assert.deepEqual(env.github, {
      clientId: "client-id",
      clientSecret: "client-secret",
      callbackUrl: "http://localhost:3001/auth/github/callback",
    })
  })

  it("exposes PORT as a number, not a string", async () => {
    const env = await load({ PORT: "8080" })

    assert.equal(env.port, 8080)
    assert.equal(typeof env.port, "number")
  })

  it("is production only when NODE_ENV says so", async () => {
    assert.equal((await load({ NODE_ENV: "production" })).isProduction, true)
    assert.equal((await load({ NODE_ENV: "development" })).isProduction, false)
    assert.equal((await load({ NODE_ENV: undefined })).isProduction, false)
  })
})

describe("env rejects bad configuration", () => {
  for (const name of NAMES) {
    it(`throws when ${name} is missing, naming it in the error`, async () => {
      await assert.rejects(load({ [name]: undefined }), new RegExp(name))
    })
  }

  it("throws when a variable is present but empty", async () => {
    await assert.rejects(load({ ORIGIN: "" }), /ORIGIN/)
  })
})
