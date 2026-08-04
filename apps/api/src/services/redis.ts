import { Redis } from "ioredis"

import { env } from "../lib/env.js"

export const redis = new Redis(env.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
})

redis.on("error", (error) => {
  console.error("redis error:", error.message)
})

export const connectRedis = async () => {
  await redis.connect()

  return redis
}

export const disconnectRedis = () => redis.quit()

export const redisStatus = () => redis.status
