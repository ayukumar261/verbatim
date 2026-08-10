import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"

// Safe to import statically: `types.js` reads no environment.
import { ProviderError } from "../types.js"

/**
 * Deterministic credentials, assigned before the module reads them, so these
 * tests never depend on real ones in `.env`. The import must be dynamic: a
 * static one would be hoisted above these assignments.
 */
process.env.GITHUB_CLIENT_ID = "test-client-id"
process.env.GITHUB_CLIENT_SECRET = "test-client-secret"
process.env.GITHUB_CALLBACK_URL = "http://localhost:3001/auth/github/callback"

const {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchRepository,
  fetchViewer,
  listRepositories,
} = await import("./github.js")

const realFetch = globalThis.fetch

let calls: { url: string; init: RequestInit | undefined }[] = []

/** Replaces `fetch` with `handler`, recording every call for assertions. */
const stubFetch = (
  handler: (url: string) => Response | Promise<Response>
): void => {
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })

    return Promise.resolve(handler(url))
  }) as typeof fetch
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status })

const VIEWER = {
  id: 583231,
  login: "octocat",
  name: "The Octocat",
  email: "public@github.com",
  avatar_url: "https://avatars.githubusercontent.com/u/583231",
}

const REPO = {
  id: 1296269,
  name: "Hello-World",
  owner: { login: "octocat" },
  default_branch: "main",
  description: "My first repository on GitHub!",
  pushed_at: "2011-01-26T19:06:43Z",
}

afterEach(() => {
  globalThis.fetch = realFetch
  calls = []
})

describe("buildAuthorizeUrl", () => {
  it("points at GitHub's authorize endpoint", () => {
    assert.ok(
      buildAuthorizeUrl("s").startsWith(
        "https://github.com/login/oauth/authorize?"
      )
    )
  })

  it("carries the client id, callback, scopes and state", () => {
    const params = new URL(buildAuthorizeUrl("state-123")).searchParams

    assert.equal(params.get("client_id"), "test-client-id")
    assert.equal(
      params.get("redirect_uri"),
      "http://localhost:3001/auth/github/callback"
    )
    assert.equal(params.get("scope"), "read:user user:email")
    assert.equal(params.get("state"), "state-123")
  })

  it("never leaks the client secret, since this URL goes to the browser", () => {
    assert.ok(!buildAuthorizeUrl("state-123").includes("test-client-secret"))
  })

  it("requests no more than read:user and user:email", () => {
    const scope = new URL(buildAuthorizeUrl("s")).searchParams.get("scope")

    assert.ok(!scope?.includes("repo"))
  })
})

describe("exchangeCodeForToken", () => {
  it("returns the access token and granted scopes", async () => {
    stubFetch(() => json({ access_token: "gho_abc", scope: "read:user" }))

    const grant = await exchangeCodeForToken("code-1")

    assert.equal(grant.accessToken, "gho_abc")
    assert.deepEqual(grant.scopes, ["read:user"])
  })

  it("splits GitHub's comma-separated scope string", async () => {
    stubFetch(() =>
      json({ access_token: "gho_abc", scope: "read:user,user:email" })
    )

    assert.deepEqual((await exchangeCodeForToken("c")).scopes, [
      "read:user",
      "user:email",
    ])
  })

  it("reports no scopes when GitHub returns none", async () => {
    stubFetch(() => json({ access_token: "gho_abc" }))

    assert.deepEqual((await exchangeCodeForToken("c")).scopes, [])
  })

  it("sends the secret server-to-server, not in a URL", async () => {
    stubFetch(() => json({ access_token: "gho_abc" }))

    await exchangeCodeForToken("code-1")

    const [call] = calls

    assert.ok(call)
    assert.ok(!call.url.includes("test-client-secret"))
    assert.equal(call.init?.method, "POST")
    assert.ok(String(call.init?.body).includes("test-client-secret"))
  })

  it("leaves refresh token and expiry null for non-expiring tokens", async () => {
    stubFetch(() => json({ access_token: "gho_abc" }))

    const grant = await exchangeCodeForToken("c")

    assert.equal(grant.refreshToken, null)
    assert.equal(grant.expiresAt, null)
  })

  it("converts expires_in into an absolute expiry", async () => {
    stubFetch(() =>
      json({
        access_token: "gho_abc",
        refresh_token: "ghr_xyz",
        expires_in: 3600,
      })
    )

    const grant = await exchangeCodeForToken("c")

    assert.equal(grant.refreshToken, "ghr_xyz")
    assert.ok(grant.expiresAt instanceof Date)

    const secondsAway = (grant.expiresAt.getTime() - Date.now()) / 1000

    assert.ok(
      secondsAway > 3590 && secondsAway <= 3600,
      `expected ~3600s away, got ${secondsAway}`
    )
  })
})

describe("exchangeCodeForToken rejects failures", () => {
  /**
   * The important one. GitHub reports OAuth errors as HTTP 200 with an `error`
   * key, so a naive `response.ok` check treats a rejection as a success.
   */
  it("throws on an error body returned with HTTP 200", async () => {
    stubFetch(() =>
      json({
        error: "bad_verification_code",
        error_description: "The code passed is incorrect or expired.",
      })
    )

    await assert.rejects(exchangeCodeForToken("stale"), (error: unknown) => {
      assert.ok(error instanceof ProviderError)
      assert.match(error.message, /incorrect or expired/)
      assert.equal(error.provider, "github")
      // The 200 describes nothing, so nothing is claimed about the status.
      assert.equal(error.status, null)

      return true
    })
  })

  it("prefers the error description, falling back to the code", async () => {
    stubFetch(() => json({ error: "bad_verification_code" }))

    await assert.rejects(exchangeCodeForToken("stale"), /bad_verification_code/)
  })

  it("throws when the response is 200 but carries no token", async () => {
    stubFetch(() => json({ scope: "read:user" }))

    await assert.rejects(exchangeCodeForToken("c"), /No access token/)
  })

  it("throws on a non-2xx response", async () => {
    stubFetch(() => json({}, 500))

    await assert.rejects(exchangeCodeForToken("c"), /HTTP 500/)
  })
})

describe("fetchViewer", () => {
  it("maps GitHub's shape onto our own", async () => {
    stubFetch(() => json(VIEWER))

    assert.deepEqual(await fetchViewer("gho_abc"), {
      provider: "github",
      providerId: "583231",
      username: "octocat",
      name: "The Octocat",
      email: "public@github.com",
      avatarUrl: "https://avatars.githubusercontent.com/u/583231",
    })
  })

  it("returns providerId as a string, not GitHub's number", async () => {
    stubFetch(() => json(VIEWER))

    assert.equal(typeof (await fetchViewer("gho_abc")).providerId, "string")
  })

  it("authenticates with the token as a bearer credential", async () => {
    stubFetch(() => json(VIEWER))

    await fetchViewer("gho_abc")

    const headers = new Headers(calls[0]?.init?.headers)

    assert.equal(headers.get("authorization"), "Bearer gho_abc")
  })

  it("skips the email lookup when the profile already has one", async () => {
    stubFetch(() => json(VIEWER))

    await fetchViewer("gho_abc")

    assert.equal(calls.length, 1)
    assert.ok(!calls[0]?.url.includes("/user/emails"))
  })

  it("falls back to the verified primary when the email is private", async () => {
    stubFetch((url) =>
      url.endsWith("/user/emails")
        ? json([
            { email: "secondary@example.com", primary: false, verified: true },
            { email: "primary@example.com", primary: true, verified: true },
          ])
        : json({ ...VIEWER, email: null })
    )

    assert.equal((await fetchViewer("gho_abc")).email, "primary@example.com")
    assert.equal(calls.length, 2)
  })

  it("ignores a primary address that is unverified", async () => {
    stubFetch((url) =>
      url.endsWith("/user/emails")
        ? json([{ email: "unverified@x.com", primary: true, verified: false }])
        : json({ ...VIEWER, email: null })
    )

    assert.equal((await fetchViewer("gho_abc")).email, null)
  })

  it("still signs the user in when the email lookup fails outright", async () => {
    stubFetch((url) =>
      url.endsWith("/user/emails")
        ? json({}, 403)
        : json({ ...VIEWER, email: null })
    )

    const profile = await fetchViewer("gho_abc")

    assert.equal(profile.email, null)
    assert.equal(profile.providerId, "583231")
  })

  it("tolerates a profile with no name or avatar", async () => {
    stubFetch(() => json({ ...VIEWER, name: null, avatar_url: null }))

    const profile = await fetchViewer("gho_abc")

    assert.equal(profile.name, null)
    assert.equal(profile.avatarUrl, null)
  })

  it("throws when the profile request itself fails", async () => {
    stubFetch(() => json({}, 401))

    await assert.rejects(fetchViewer("expired"), /HTTP 401/)
  })
})

describe("listRepositories", () => {
  it("maps GitHub's shape onto our own", async () => {
    stubFetch(() => json([REPO]))

    assert.deepEqual(await listRepositories("gho_abc"), [
      {
        provider: "github",
        providerId: "1296269",
        owner: "octocat",
        name: "Hello-World",
        defaultBranch: "main",
        description: "My first repository on GitHub!",
        pushedAt: new Date("2011-01-26T19:06:43Z"),
      },
    ])
  })

  it("returns providerId as a string, not GitHub's number", async () => {
    stubFetch(() => json([REPO]))

    const [repository] = await listRepositories("gho_abc")

    assert.equal(typeof repository?.providerId, "string")
  })

  it("asks for owned repositories, newest push first", async () => {
    stubFetch(() => json([]))

    await listRepositories("gho_abc")

    const params = new URL(String(calls[0]?.url)).searchParams

    assert.equal(params.get("affiliation"), "owner")
    assert.equal(params.get("sort"), "pushed")
    assert.equal(params.get("per_page"), "100")
  })

  it("never constrains visibility, so the token decides what comes back", async () => {
    stubFetch(() => json([]))

    await listRepositories("gho_abc")

    // Hardcoding `public` would mean editing this call the day `repo` is
    // granted, rather than private repositories simply appearing.
    assert.equal(
      new URL(String(calls[0]?.url)).searchParams.get("visibility"),
      null
    )
  })

  it("authenticates with the token as a bearer credential", async () => {
    stubFetch(() => json([]))

    await listRepositories("gho_abc")

    assert.equal(
      new Headers(calls[0]?.init?.headers).get("authorization"),
      "Bearer gho_abc"
    )
  })

  it("returns an empty list without complaint", async () => {
    stubFetch(() => json([]))

    assert.deepEqual(await listRepositories("gho_abc"), [])
  })

  it("leaves pushedAt null for a repository with no commits", async () => {
    stubFetch(() => json([{ ...REPO, pushed_at: null }]))

    const [repository] = await listRepositories("gho_abc")

    // `new Date(null)` is 1970, which would sort an untouched repo oddly and
    // read as a real date everywhere downstream.
    assert.equal(repository?.pushedAt, null)
  })

  it("throws when the request fails", async () => {
    stubFetch(() => json({}, 401))

    await assert.rejects(listRepositories("expired"), /HTTP 401/)
  })
})

describe("fetchRepository", () => {
  it("looks the repository up by its provider id", async () => {
    stubFetch(() => json(REPO))

    await fetchRepository("1296269", "gho_abc")

    assert.equal(calls[0]?.url, "https://api.github.com/repositories/1296269")
  })

  it("maps GitHub's shape onto our own", async () => {
    stubFetch(() => json(REPO))

    const repository = await fetchRepository("1296269", "gho_abc")

    assert.equal(repository.providerId, "1296269")
    assert.equal(repository.owner, "octocat")
    assert.equal(repository.name, "Hello-World")
    assert.equal(repository.defaultBranch, "main")
  })

  it("escapes the id, which arrives in a request body", async () => {
    stubFetch(() => json(REPO))

    await fetchRepository("../user", "gho_abc")

    // Unescaped, this would walk out of /repositories and hit /user instead.
    assert.ok(!String(calls[0]?.url).includes("/repositories/../user"))
  })

  it("carries the status, so a caller can tell 404 from 500", async () => {
    stubFetch(() => json({}, 404))

    await assert.rejects(fetchRepository("1", "gho_abc"), (error: unknown) => {
      assert.ok(error instanceof ProviderError)
      assert.equal(error.status, 404)
      assert.equal(error.provider, "github")

      return true
    })
  })

  it("reports a dead token with its own status, not as a 404", async () => {
    stubFetch(() => json({}, 401))

    await assert.rejects(fetchRepository("1", "gho_abc"), (error: unknown) => {
      assert.ok(error instanceof ProviderError)
      assert.equal(error.status, 401)

      return true
    })
  })
})
