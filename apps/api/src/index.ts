import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"

import { env } from "./env.js"
import { connectMongo, disconnectMongo, mongoStatus } from "./db/mongo.js"
import { connectRedis, disconnectRedis, redisStatus } from "./db/redis.js"

const app = new Hono()

app.use("*", logger())

app.use(
  "*",
  cors({
    origin: env.origin,
    credentials: true,
  })
)

app.get("/health", (c) =>
  c.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    mongo: mongoStatus(),
    redis: redisStatus(),
  })
)

await Promise.all([connectMongo(), connectRedis()])

const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`)
})

const shutdown = () => {
  server.close(async () => {
    await Promise.all([disconnectMongo(), disconnectRedis()])
    process.exit(0)
  })
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

export default app
