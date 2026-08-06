import assert from "node:assert/strict"
import { after, before, beforeEach, describe, it } from "node:test"

import type { Redis } from "ioredis"
import mongoose from "mongoose"

import { startTestMongo, startTestRedis } from "./containers.js"
import type { TestMongo, TestRedis } from "./containers.js"

/**
 * Proves the container harness works, and pins the three Redis behaviours the
 * session layer is about to be built on. If this file fails, nothing written
 * against it can be trusted.
 */
describe("startTestRedis", () => {
  let container: TestRedis
  let redis: Redis

  before(async () => {
    container = await startTestRedis()
    redis = container.redis
  })

  after(() => container.stop())

  it("hands back a live connection", async () => {
    assert.equal(await redis.ping(), "PONG")
  })

  it("starts empty", async () => {
    assert.deepEqual(await redis.keys("*"), [])
  })

  it("expires a key once its TTL elapses", async () => {
    // 60 milliseconds rather than seconds, so the test does not sit and wait.
    await redis.set("session:expiring", "value", "PX", 60)
    assert.equal(await redis.get("session:expiring"), "value")

    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(await redis.get("session:expiring"), null)
  })

  it("reads and deletes in one step, so state is single-use", async () => {
    await redis.set("oauth:state:abc", "")

    assert.equal(await redis.getdel("oauth:state:abc"), "")
    // The second read is what a replayed callback would see.
    assert.equal(await redis.getdel("oauth:state:abc"), null)
  })

  it("tracks a user's sessions in a set", async () => {
    await redis.sadd("user:1:sessions", "sid-a", "sid-b")
    assert.deepEqual((await redis.smembers("user:1:sessions")).sort(), [
      "sid-a",
      "sid-b",
    ])

    await redis.srem("user:1:sessions", "sid-a")
    assert.deepEqual(await redis.smembers("user:1:sessions"), ["sid-b"])
  })
})

/**
 * Same idea for Mongo: the harness is proved here, along with the two server
 * behaviours the models rely on but cannot demonstrate unsaved.
 */
describe("startTestMongo", () => {
  let container: TestMongo

  /** Mongo takes a few seconds to elect itself, so the pull is not the wait. */
  before(async () => {
    container = await startTestMongo()
  })

  after(() => container.stop())

  beforeEach(() => container.clear())

  it("hands back a live connection", async () => {
    const result = await mongoose.connection.db?.admin().ping()

    assert.equal(result?.ok, 1)
  })

  it("clears documents between tests", async () => {
    const items = mongoose.connection.collection("items")
    await items.insertOne({ name: "leftover" })

    await container.clear()

    assert.equal(await items.countDocuments(), 0)
  })

  it("enforces unique indexes, as the account lookup keys depend on", async () => {
    const accounts = mongoose.connection.collection("unique_probe")
    await accounts.createIndex({ provider: 1, providerId: 1 }, { unique: true })

    await accounts.insertOne({ provider: "github", providerId: "583231" })

    await assert.rejects(
      accounts.insertOne({ provider: "github", providerId: "583231" }),
      // 11000 is Mongo's duplicate key error, the one a second sign-up hits.
      (error: { code?: number }) => error.code === 11000
    )
  })

  it("supports transactions, which need a replica set", async () => {
    const session = await mongoose.startSession()

    // Aborting is the point: a standalone Mongo throws here instead.
    await session.withTransaction(async () => {
      await mongoose.connection
        .collection("items")
        .insertOne({ name: "rolled back" }, { session })

      await session.abortTransaction()
    })

    await session.endSession()

    assert.equal(
      await mongoose.connection.collection("items").countDocuments(),
      0
    )
  })
})
