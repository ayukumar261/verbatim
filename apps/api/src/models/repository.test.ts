import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { Error as MongooseError, Types } from "mongoose"

import { Repository } from "./repository.js"
import type { RepositoryDocument } from "./repository.js"

/**
 * Builds an unsaved repository, so these tests need no Mongo connection. The
 * unique index is enforced by Mongo rather than validation, so it belongs with
 * the service that relies on it.
 */
const build = (overrides: Record<string, unknown> = {}): RepositoryDocument =>
  new Repository({
    userId: new Types.ObjectId(),
    githubId: 1296269,
    owner: "octocat",
    name: "hello-world",
    defaultBranch: "main",
    ...overrides,
  })

/** Asserts that validation fails, and that it fails on `path` specifically. */
const rejectsOn = (path: string, overrides: Record<string, unknown>) =>
  assert.rejects(build(overrides).validate(), (error: unknown) => {
    assert.ok(error instanceof MongooseError.ValidationError)
    assert.ok(path in error.errors, `expected an error on ${path}`)

    return true
  })

describe("Repository", () => {
  it("accepts a well-formed repository", async () => {
    await assert.doesNotReject(build().validate())
  })

  it("applies sensible defaults", () => {
    const repository = build()

    assert.equal(repository.isPrivate, false)
    assert.equal(repository.disconnectedAt, null)
  })

  it("keeps githubId a number, even when given a string", () => {
    assert.equal(build({ githubId: "1296269" }).githubId, 1296269)
  })

  it("trims the owner and name", async () => {
    const repository = build({ owner: "  octocat  ", name: "  spoon-knife  " })

    await repository.validate()

    assert.equal(repository.owner, "octocat")
    assert.equal(repository.name, "spoon-knife")
  })

  it("treats userId and githubId as immutable", () => {
    const repository = build()

    // Mongoose only enforces `immutable` on a document it believes is saved.
    repository.isNew = false

    repository.set({ userId: new Types.ObjectId(), githubId: 999 })

    assert.equal(repository.githubId, 1296269)
  })

  it("allows a rename, since owner and name are only a display cache", async () => {
    const repository = build()

    repository.isNew = false

    repository.set({ owner: "monalisa", name: "goodbye-world" })

    await repository.validate()

    assert.equal(repository.owner, "monalisa")
    assert.equal(repository.name, "goodbye-world")
  })
})

describe("Repository rejects bad documents", () => {
  for (const field of [
    "userId",
    "githubId",
    "owner",
    "name",
    "defaultBranch",
  ]) {
    it(`requires ${field}`, async () => {
      await rejectsOn(field, { [field]: undefined })
    })
  }

  it("rejects a userId that is not an ObjectId", async () => {
    await rejectsOn("userId", { userId: "not-an-object-id" })
  })

  it("rejects a githubId that is not a number", async () => {
    await rejectsOn("githubId", { githubId: "octocat" })
  })
})
