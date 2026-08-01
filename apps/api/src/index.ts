import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"

const port = Number(process.env.PORT ?? 3001)
const origin = process.env.ORIGIN ?? "http://localhost:3000"

const app = new Hono()

app.use("*", logger())

app.use(
  "*",
  cors({
    origin: origin,
    credentials: true,
  })
)

app.get("/health", (c) =>
  c.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  })
)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`)
})

export default app
