import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { describe, it } from "node:test"

// Configured as production, because that is what the Dokploy container runs
// and the only place a wrong flag fails silently. Set before any module reads
// it, so the value imports below must stay dynamic.
process.env.NODE_ENV = "production"
process.env.PORT = "3001"
process.env.ORIGIN = "https://verbatim.example"
process.env.MONGO_URL = "mongodb://127.0.0.1:27017"
process.env.MONGO_DB = "verbatim-test"
process.env.REDIS_URL = "redis://127.0.0.1:6379"
process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64")
process.env.GITHUB_CLIENT_ID = "test-client-id"
process.env.GITHUB_CLIENT_SECRET = "test-client-secret"
process.env.GITHUB_CALLBACK_URL =
  "https://verbatim.example/auth/github/callback"

const { Hono } = await import("hono")
const { SESSION_TTL, STATE_TTL } = await import("../services/session.js")
const cookies = await import("./cookie.js")

const app = new Hono()

app.get("/session/set", (c) => {
  cookies.setSessionCookie(c, "sid-value")

  return c.body(null, 204)
})

app.get("/session/clear", (c) => {
  cookies.clearSessionCookie(c)

  return c.body(null, 204)
})

app.get("/session/read", (c) => c.json({ value: cookies.readSessionCookie(c) }))

app.get("/state/set", (c) => {
  cookies.setStateCookie(c, "state-value")

  return c.body(null, 204)
})

app.get("/state/clear", (c) => {
  cookies.clearStateCookie(c)

  return c.body(null, 204)
})

app.get("/state/read", (c) => c.json({ value: cookies.readStateCookie(c) }))

/** The one `Set-Cookie` a route emitted, split into value and attributes. */
const emitted = async (path: string) => {
  const response = await app.request(path)
  const [header] = response.headers.getSetCookie()

  assert.ok(header, `expected ${path} to set a cookie`)

  const [pair = "", ...attributes] = header
    .split(";")
    .map((part) => part.trim())
  const [name = "", ...value] = pair.split("=")

  // Attribute names are case-insensitive, so they are lowered before lookup.
  const flags = new Map(
    attributes.map((attribute): [string, string] => {
      const [key = "", ...rest] = attribute.split("=")

      return [key.toLowerCase(), rest.join("=")]
    })
  )

  return { name, value: value.join("="), flags }
}

/** What a route read back out of the `Cookie` header handed to it. */
const readBack = async (path: string, cookie: string): Promise<unknown> => {
  const response = await app.request(path, { headers: { cookie } })
  const body = (await response.json()) as { value: unknown }

  return body.value
}

describe("session cookie", () => {
  it("carries the session id under a namespaced name", async () => {
    const { name, value } = await emitted("/session/set")

    assert.equal(name, "verbatim_session")
    assert.equal(value, "sid-value")
  })

  it("is kept away from scripts and scoped to the whole site", async () => {
    const { flags } = await emitted("/session/set")

    assert.ok(flags.has("httponly"))
    assert.equal(flags.get("path"), "/")
  })

  // `Strict` would withhold the cookie on exactly the callback hop.
  it("survives the top-level redirect back from GitHub", async () => {
    const { flags } = await emitted("/session/set")

    assert.equal(flags.get("samesite"), "Lax")
  })

  it("expires with the session it names", async () => {
    const { flags } = await emitted("/session/set")

    assert.equal(flags.get("max-age"), String(SESSION_TTL))
  })

  it("round-trips through a Cookie header", async () => {
    assert.equal(
      await readBack("/session/read", "verbatim_session=sid-value"),
      "sid-value"
    )
  })

  it("reads as null when the browser sends nothing", async () => {
    assert.equal(await readBack("/session/read", "unrelated=1"), null)
  })
})

describe("state cookie", () => {
  it("carries the state under a namespaced name", async () => {
    const { name, value } = await emitted("/state/set")

    assert.equal(name, "verbatim_oauth_state")
    assert.equal(value, "state-value")
  })

  it("is kept away from scripts and scoped to the whole site", async () => {
    const { flags } = await emitted("/state/set")

    assert.ok(flags.has("httponly"))
    assert.equal(flags.get("path"), "/")
  })

  it("survives the top-level redirect back from GitHub", async () => {
    const { flags } = await emitted("/state/set")

    assert.equal(flags.get("samesite"), "Lax")
  })

  it("expires with the consent window it guards", async () => {
    const { flags } = await emitted("/state/set")

    assert.equal(flags.get("max-age"), String(STATE_TTL))
  })

  it("round-trips through a Cookie header", async () => {
    assert.equal(
      await readBack("/state/read", "verbatim_oauth_state=state-value"),
      "state-value"
    )
  })

  it("reads as null when the browser sends nothing", async () => {
    assert.equal(await readBack("/state/read", "unrelated=1"), null)
  })
})

// Without this the session id crosses the wire in plaintext. Nothing else in
// the suite catches it, since it is the one flag development never sets.
describe("every cookie is marked Secure in production", () => {
  for (const path of [
    "/session/set",
    "/state/set",
    "/session/clear",
    "/state/clear",
  ]) {
    it(`sets Secure on ${path}`, async () => {
      const { flags } = await emitted(path)

      assert.ok(flags.has("secure"))
    })
  }
})

// A browser only drops a cookie when the deletion matches the flags it was
// written with. A clear that disagrees looks like it worked and silently
// leaves the user signed in.
describe("clearing a cookie matches setting it", () => {
  for (const [label, name] of [
    ["session", "session"],
    ["state", "state"],
  ] as const) {
    it(`empties the ${label} cookie`, async () => {
      const { value, flags } = await emitted(`/${name}/clear`)

      assert.equal(value, "")
      assert.equal(flags.get("max-age"), "0")
    })

    it(`clears the ${label} cookie with the flags it set`, async () => {
      const set = await emitted(`/${name}/set`)
      const clear = await emitted(`/${name}/clear`)

      assert.equal(clear.name, set.name)
      assert.equal(clear.flags.get("path"), set.flags.get("path"))
      assert.equal(clear.flags.get("samesite"), set.flags.get("samesite"))
      assert.equal(clear.flags.has("secure"), set.flags.has("secure"))
    })
  }
})
