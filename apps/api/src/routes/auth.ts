import { Hono } from "hono"

import { createAuthController } from "../controllers/auth.js"
import { requireAuth } from "../middleware/auth.js"
import type { AuthEnv } from "../middleware/auth.js"
import type { SessionStore } from "../services/session.js"

export const createAuthRoutes = (sessions: SessionStore) => {
  const auth = createAuthController(sessions)
  const routes = new Hono<AuthEnv>()

  routes.get("/github", auth.authorize)
  routes.get("/github/callback", auth.callback)
  routes.get("/me", requireAuth(sessions), auth.me)

  return routes
}
