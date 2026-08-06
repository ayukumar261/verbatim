import { Hono } from "hono"

import { createAuthController } from "../controllers/auth.js"
import type { SessionStore } from "../services/session.js"

export const createAuthRoutes = (sessions: SessionStore) => {
  const auth = createAuthController(sessions)
  const routes = new Hono()

  routes.get("/github", auth.authorize)
  routes.get("/github/callback", auth.callback)

  return routes
}
