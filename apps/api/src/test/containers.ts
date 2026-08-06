import { connect } from "node:net"
import { setTimeout as delay } from "node:timers/promises"

import { MongoDBContainer } from "@testcontainers/mongodb"
import { RedisContainer } from "@testcontainers/redis"
import { Redis } from "ioredis"
import mongoose from "mongoose"

/**
 * Pinned to the same images `docker-compose.yml` runs, so a test never passes
 * against a version that development does not use.
 */
const REDIS_IMAGE = "redis:7-alpine"
const MONGO_IMAGE = "mongo:8"

/** Resolves once something accepts a TCP connection on `url`'s host and port. */
const waitForPort = async (url: string, timeoutMs = 10_000): Promise<void> => {
  const { hostname, port } = new URL(url)
  const deadline = Date.now() + timeoutMs

  for (;;) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = connect({ host: hostname, port: Number(port) })

        socket.once("connect", () => {
          socket.end()
          resolve()
        })
        socket.once("error", reject)
      })

      return
    } catch (error) {
      if (Date.now() >= deadline) throw error

      await delay(50)
    }
  }
}

export interface TestRedis {
  /** A client already connected to the throwaway container. */
  redis: Redis
  /** Closes the client and destroys the container. Call this in an `after`. */
  stop: () => Promise<void>
}

/**
 * Starts a disposable Redis on a random free port. Nothing is shared with the
 * development container, so tests cannot see each other's keys or yours.
 */
export const startTestRedis = async (): Promise<TestRedis> => {
  const container = await new RedisContainer(REDIS_IMAGE).start()
  const url = container.getConnectionUrl()

  // Docker reports the container started a beat before its published port
  // forwards, so a client built here is refused once and reconnects. Waiting
  // on a plain socket keeps that expected failure out of the test output.
  await waitForPort(url)

  const redis = new Redis(url)

  return {
    redis,
    stop: async () => {
      await redis.quit()
      await container.stop()
    },
  }
}

export interface TestMongo {
  /** Empties every collection, leaving indexes intact. */
  clear: () => Promise<void>
  /** Disconnects mongoose and destroys the container. Call this in an `after`. */
  stop: () => Promise<void>
}

/**
 * Starts a disposable Mongo and connects the default mongoose instance to it,
 * which is the one `models/` registers against — so imported models simply
 * work, with no wiring at the call site.
 */
export const startTestMongo = async (): Promise<TestMongo> => {
  const container = await new MongoDBContainer(MONGO_IMAGE).start()

  // A single-node replica set, which is what makes transactions available.
  // `directConnection` stops the driver hunting for members that do not exist.
  await mongoose.connect(container.getConnectionString(), {
    dbName: "verbatim-test",
    directConnection: true,
  })

  return {
    clear: async () => {
      const collections = await mongoose.connection.db!.collections()

      // `deleteMany` rather than `drop`, which would take the indexes with it
      // and quietly disable every uniqueness assertion that follows.
      await Promise.all(
        collections.map((collection) => collection.deleteMany())
      )
    },
    stop: async () => {
      await mongoose.disconnect()
      await container.stop()
    },
  }
}
