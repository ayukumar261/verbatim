import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { User } from "./user.js"

/**
 * These build documents but never save them, so no Mongo connection is
 * required. `validate` runs the same validators a write would.
 */
const build = (overrides: Record<string, unknown> = {}) => new User(overrides)

describe("User", () => {
  it("accepts an empty document, because identity lives on Account", async () => {
    await build().validate()
  })

  it("defaults every profile field to null", () => {
    const user = build()

    assert.equal(user.name, null)
    assert.equal(user.email, null)
    assert.equal(user.avatarUrl, null)
  })

  it("keeps the fields it was given", () => {
    const user = build({
      name: "The Octocat",
      email: "octocat@github.com",
      avatarUrl: "https://avatars.githubusercontent.com/u/583231",
    })

    assert.equal(user.name, "The Octocat")
    assert.equal(user.email, "octocat@github.com")
    assert.equal(
      user.avatarUrl,
      "https://avatars.githubusercontent.com/u/583231"
    )
  })

  it("normalises email to lowercase, so lookups are predictable", () => {
    assert.equal(
      build({ email: "OctoCat@GitHub.com" }).email,
      "octocat@github.com"
    )
  })

  it("trims whitespace off name and email", () => {
    const user = build({ name: "  The Octocat  ", email: "  a@b.com  " })

    assert.equal(user.name, "The Octocat")
    assert.equal(user.email, "a@b.com")
  })

  it("carries no provider identity, so a second provider needs no migration", () => {
    assert.deepEqual(
      Object.keys(build().toJSON()).filter((key) =>
        /github|provider|token/i.test(key)
      ),
      []
    )
  })
})
