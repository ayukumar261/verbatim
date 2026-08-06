import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { Error as MongooseError, Types } from "mongoose"

import { Session } from "./session.js"
import type { SessionDocument } from "./session.js"

/**
 * Builds an unsaved session, so these tests need no Mongo connection. The
 * behaviour that does (TTL sweeps, the unique index) is covered against a
 * real container in `services/session.test.ts`.
 */
const build = (overrides: Record<string, unknown> = {}): SessionDocument =>
  new Session({
    sid: "0Jw3Xk1r8mQvZ2pL5tN7yB4cH6sD9fG1jK3lM0nP2qR",
    userId: new Types.ObjectId(),
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  })

/** Asserts that validation fails, and that it fails on `path` specifically. */
const rejectsOn = (path: string, overrides: Record<string, unknown>) =>
  assert.rejects(build(overrides).validate(), (error: unknown) => {
    assert.ok(error instanceof MongooseError.ValidationError)
    assert.ok(path in error.errors, `expected an error on ${path}`)

    return true
  })

describe("Session", () => {
  it("accepts a well-formed session", async () => {
    await assert.doesNotReject(build().validate())
  })

  it("requires a sid", () => rejectsOn("sid", { sid: undefined }))

  it("requires a userId", () => rejectsOn("userId", { userId: undefined }))

  it("requires an expiry", () =>
    rejectsOn("expiresAt", { expiresAt: undefined }))

  it("rejects a userId that is not an id", () =>
    rejectsOn("userId", { userId: "octocat" }))

  it("treats sid and userId as immutable", () => {
    const session = build()

    // Mongoose only enforces `immutable` on a document it believes is saved.
    session.isNew = false

    session.set({ sid: "replaced", userId: new Types.ObjectId() })

    assert.notEqual(session.sid, "replaced")
  })

  it("keeps the sid out of anything serialised", () => {
    const serialised = build().toJSON()

    // The sid is the credential itself, so a device list must never carry it.
    assert.ok(!("sid" in serialised))
    assert.ok("expiresAt" in serialised)
  })
})
