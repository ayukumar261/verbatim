import assert from "node:assert/strict"
import { after, before, beforeEach, describe, it } from "node:test"

import { Account } from "../models/account.js"
import type { AccountDocument } from "../models/account.js"
import { User } from "../models/user.js"
import { startTestMongo } from "../test/containers.js"
import type { TestMongo } from "../test/containers.js"
import type { ProviderProfile, TokenGrant } from "../types.js"
import { signInWithProvider } from "./auth.js"

/** Shaped like a real GitHub access token, so the lengths are realistic. */
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

/** The one account we expect to exist, failing loudly if it does not. */
const storedAccount = async (): Promise<AccountDocument> => {
  const account = await Account.findOne({ providerId: PROFILE.providerId })

  assert.ok(account !== null, "expected an account to have been created")

  return account
}

describe("signInWithProvider", () => {
  let mongo: TestMongo

  before(async () => {
    mongo = await startTestMongo()

    // Builds the unique indexes up front. Without them the race below has
    // nothing to collide against and would quietly create two accounts.
    await Promise.all([Account.init(), User.init()])
  })

  after(async () => {
    await mongo.stop()
  })

  beforeEach(async () => {
    await mongo.clear()
  })

  it("creates a user and an account the first time it sees an identity", async () => {
    const userId = await signInWithProvider(PROFILE, GRANT)

    const user = await User.findById(userId)

    assert.ok(user !== null)
    assert.equal(user.name, "The Octocat")
    assert.equal(user.email, "octocat@github.com")

    const account = await storedAccount()

    assert.equal(account.userId.toString(), userId)
    assert.equal(account.username, "octocat")
    assert.deepEqual(account.scopes, ["read:user", "user:email"])
  })

  it("stores the access token encrypted", async () => {
    await signInWithProvider(PROFILE, GRANT)

    const account = await storedAccount()

    assert.notEqual(account.encryptedAccessToken, TOKEN)
    assert.equal(account.getAccessToken(), TOKEN)
  })

  it("stores a refresh token when the provider issues one", async () => {
    await signInWithProvider(PROFILE, { ...GRANT, refreshToken: "ghr_abc123" })

    const account = await storedAccount()

    assert.notEqual(account.encryptedRefreshToken, "ghr_abc123")
    assert.equal(account.getRefreshToken(), "ghr_abc123")
  })

  it("returns the same user on a second sign-in", async () => {
    const first = await signInWithProvider(PROFILE, GRANT)
    const second = await signInWithProvider(PROFILE, GRANT)

    assert.equal(first, second)
    assert.equal(await User.countDocuments(), 1)
    assert.equal(await Account.countDocuments(), 1)
  })

  it("replaces the stored credentials on a later sign-in", async () => {
    await signInWithProvider(PROFILE, GRANT)
    await signInWithProvider(PROFILE, {
      ...GRANT,
      accessToken: "gho_secondtokenc6912E7710c838347Ae178B4a",
      scopes: ["read:user", "user:email", "repo"],
    })

    const account = await storedAccount()

    assert.equal(
      account.getAccessToken(),
      "gho_secondtokenc6912E7710c838347Ae178B4a"
    )
    assert.deepEqual(account.scopes, ["read:user", "user:email", "repo"])
  })

  it("clears needsReauth, since the grant is fresh", async () => {
    await signInWithProvider(PROFILE, GRANT)
    await Account.updateOne({}, { needsReauth: true })

    await signInWithProvider(PROFILE, GRANT)

    assert.equal((await storedAccount()).needsReauth, false)
  })

  it("follows a rename at the provider", async () => {
    await signInWithProvider(PROFILE, GRANT)
    await signInWithProvider({ ...PROFILE, username: "monalisa" }, GRANT)

    assert.equal((await storedAccount()).username, "monalisa")
  })

  it("leaves the user's own profile alone after creation", async () => {
    const userId = await signInWithProvider(PROFILE, GRANT)

    // Stands in for the user editing their name inside Verbatim.
    await User.updateOne({ _id: userId }, { name: "Renamed Here" })

    await signInWithProvider(PROFILE, GRANT)

    assert.equal((await User.findById(userId))?.name, "Renamed Here")
  })

  it("treats a different provider id as a different person", async () => {
    const first = await signInWithProvider(PROFILE, GRANT)
    const second = await signInWithProvider(
      { ...PROFILE, providerId: "999999" },
      GRANT
    )

    assert.notEqual(first, second)
    assert.equal(await User.countDocuments(), 2)
  })

  it("creates one user when two callbacks race", async () => {
    const [first, second] = await Promise.all([
      signInWithProvider(PROFILE, GRANT),
      signInWithProvider(PROFILE, GRANT),
    ])

    // The loser deletes the user it had already created, so no orphan is
    // left behind and both callers agree on who signed in.
    assert.equal(first, second)
    assert.equal(await User.countDocuments(), 1)
    assert.equal(await Account.countDocuments(), 1)
  })
})
