import type { Context } from "hono"

import type { AuthEnv } from "../middleware/auth.js"
import {
  connectRepository,
  disconnectRepository,
  listAvailableRepositories,
  listConnectedRepositories,
} from "../services/repository.js"
import { ProviderError } from "../types.js"

/**
 * Turns a failed provider call into the answer a fetch client gets. Not shared
 * with `auth`, which hands a browser a redirect and has nowhere to put a
 * status, and which collapses every sign-in failure to one code on purpose.
 */
const providerFailure = (c: Context, error: unknown) => {
  if (error instanceof ProviderError) {
    // The session is fine, the provider token is not. A different body from
    // `requireAuth`'s, so the app can send the user back through OAuth rather
    // than show a login wall for a session that still works.
    if (error.status === 401) {
      return c.json({ error: "reauth_required" }, 401)
    }

    if (error.status === 404) {
      return c.json({ error: "not_found" }, 404)
    }

    // Down, rate limited, or a failure carrying no status at all. Upstream's
    // fault rather than the caller's, which is what 502 says.
    return c.json({ error: "provider_error" }, 502)
  }

  // Why it broke belongs in our logs, not in a body the browser reads.
  console.error("provider call failed:", error)

  return c.json({ error: "server_error" }, 500)
}

/**
 * What the sidebar selector offers. Mongo alone, so it answers on every page
 * load whether or not the provider is reachable.
 */
export const listConnected = async (c: Context<AuthEnv>) => {
  const repositories = await listConnectedRepositories(c.get("userId"))

  return c.json({
    repositories: repositories.map((repository) => repository.toJSON()),
  })
}

/** What the picker offers: the provider's list, marked with what is connected. */
export const listAvailable = async (c: Context<AuthEnv>) => {
  try {
    const repositories = await listAvailableRepositories(c.get("userId"))

    return c.json({ repositories })
  } catch (error) {
    return providerFailure(c, error)
  }
}

/**
 * Connects one repository. The body names it and nothing more: the service
 * re-fetches from the provider and stores that, so a client can choose a
 * repository but never describe one.
 */
export const connect = async (c: Context<AuthEnv>) => {
  // Caught, so a malformed body is a 400 rather than a `SyntaxError` escaping
  // as a 500.
  const body = (await c.req.json().catch(() => null)) as {
    providerId?: unknown
  } | null

  const providerId =
    typeof body?.providerId === "string" ? body.providerId.trim() : ""

  // Without this an absent field reaches the provider as `undefined` and comes
  // back as a 404, which reads as "no such repository" rather than "bad call".
  if (providerId === "") {
    return c.json({ error: "invalid_request" }, 400)
  }

  try {
    const repository = await connectRepository(c.get("userId"), providerId)

    // 200 rather than 201: the write upserts, so connecting something already
    // connected succeeds without creating anything.
    return c.json({ repository: repository.toJSON() })
  } catch (error) {
    return providerFailure(c, error)
  }
}

/** Ends a connection, leaving the repository and its conversations readable. */
export const disconnect = async (c: Context<AuthEnv, "/:id">) => {
  const disconnected = await disconnectRepository(
    c.get("userId"),
    c.req.param("id")
  )

  // One answer for "not yours", "never existed", "malformed", and "already
  // disconnected". Separating them would confirm that a stranger's id exists.
  if (!disconnected) {
    return c.json({ error: "not_found" }, 404)
  }

  return c.body(null, 204)
}
