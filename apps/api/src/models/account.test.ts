import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { Error as MongooseError, Types } from "mongoose"

import { Account } from "./account.js"
import type { AccountDocument } from "./account.js"

/** Shaped like a real GitHub access token, so the lengths are realistic. */
const TOKEN = "gho_16C7e42F292c6912E7710c838347Ae178B4a"

/**
 * Builds an unsaved account, so these tests need no Mongo connection.
 * The access token is set through the method unless a test overrides it.
 */
const build = (overrides: Record<string, unknown> = {}): AccountDocument => {
  const account = new Account({
    userId: new Types.ObjectId(),
    provider: "github",
    providerId: "583231",
    username: "octocat",
    ...overrides,
  })

  if (!("encryptedAccessToken" in overrides)) {
    account.setAccessToken(TOKEN)
  }

  return account
}

/** Asserts that validation fails, and that it fails on `path` specifically. */
const rejectsOn = (path: string, overrides: Record<string, unknown>) =>
  assert.rejects(build(overrides).validate(), (error: unknown) => {
    assert.ok(error instanceof MongooseError.ValidationError)
    assert.ok(path in error.errors, `expected an error on ${path}`)

    return true
  })

describe("Account", () => {
  it("accepts a minimal document", async () => {
    await build().validate()
  })

  it("applies sensible defaults", () => {
    const account = build()

    assert.equal(account.encryptedRefreshToken, null)
    assert.equal(account.expiresAt, null)
    assert.deepEqual(account.scopes, [])
    assert.equal(account.needsReauth, false)
  })

  it("treats username as optional, since not every provider has one", async () => {
    const account = build({ username: undefined })

    await account.validate()

    assert.equal(account.username, null)
  })

  it("keeps providerId as a string, even when given a number", () => {
    assert.equal(build({ providerId: 583231 }).providerId, "583231")
  })
})

describe("Account token storage", () => {
  it("round-trips an access token", () => {
    assert.equal(build().getAccessToken(), TOKEN)
  })

  it("stores the token encrypted, not in plaintext", () => {
    const account = build()

    assert.notEqual(account.encryptedAccessToken, TOKEN)
    assert.ok(!account.encryptedAccessToken.includes(TOKEN))
  })

  it("clears needsReauth when a fresh token is stored", () => {
    const account = build({ needsReauth: true })

    account.setAccessToken(TOKEN)

    assert.equal(account.needsReauth, false)
  })

  it("round-trips a refresh token", () => {
    const account = build()

    account.setRefreshToken("ghr_abc123")

    assert.notEqual(account.encryptedRefreshToken, "ghr_abc123")
    assert.equal(account.getRefreshToken(), "ghr_abc123")
  })

  it("reports no refresh token when none was set", () => {
    assert.equal(build().getRefreshToken(), null)
  })

  it("can clear a refresh token", () => {
    const account = build()

    account.setRefreshToken("ghr_abc123")
    account.setRefreshToken(null)

    assert.equal(account.encryptedRefreshToken, null)
    assert.equal(account.getRefreshToken(), null)
  })

  it("omits both token fields from toJSON", () => {
    // Typed as a plain object: `toJSON` strips fields the schema marks as
    // always present, so the precise document type no longer describes it.
    const record: Record<string, unknown> = build({
      scopes: ["read:user"],
    }).toJSON()

    assert.ok(!("encryptedAccessToken" in record))
    assert.ok(!("encryptedRefreshToken" in record))
    // The rest of the document still comes through.
    assert.deepEqual(record.scopes, ["read:user"])
  })
})

describe("Account.hasScopes", () => {
  it("is true when every required scope was granted", () => {
    const account = build({ scopes: ["read:user", "user:email"] })

    assert.equal(account.hasScopes("read:user"), true)
    assert.equal(account.hasScopes("read:user", "user:email"), true)
  })

  it("is false when any required scope is missing", () => {
    const account = build({ scopes: ["read:user"] })

    assert.equal(account.hasScopes("repo"), false)
    assert.equal(account.hasScopes("read:user", "repo"), false)
  })

  it("is vacuously true when nothing is required", () => {
    assert.equal(build().hasScopes(), true)
  })
})

describe("Account rejects bad documents", () => {
  for (const field of [
    "userId",
    "provider",
    "providerId",
    "encryptedAccessToken",
  ]) {
    it(`requires ${field}`, async () => {
      await rejectsOn(field, { [field]: undefined })
    })
  }

  it("rejects an unknown provider", async () => {
    await rejectsOn("provider", { provider: "bitbucket" })
  })

  it("rejects a userId that is not an ObjectId", async () => {
    await rejectsOn("userId", { userId: "not-an-object-id" })
  })
})
