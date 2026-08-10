import { Hono } from "hono"

import {
  connect,
  disconnect,
  listAvailable,
  listConnected,
} from "../controllers/repository.js"
import { requireAuth } from "../middleware/auth.js"
import type { AuthEnv } from "../middleware/auth.js"
import type { SessionStore } from "../services/session.js"

export const createRepositoryRoutes = (sessions: SessionStore) => {
  const routes = new Hono<AuthEnv>()

  routes.use("*", requireAuth(sessions))

  routes.get("/", listConnected)
  routes.get("/available", listAvailable)
  routes.post("/", connect)
  routes.delete("/:id", disconnect)

  return routes
}
