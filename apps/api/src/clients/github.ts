import { env } from "../env.js"
import type { ProviderProfile, TokenGrant } from "../types.js"

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
const TOKEN_URL = "https://github.com/login/oauth/access_token"
const API_URL = "https://api.github.com"

/** GitHub rejects API requests that do not identify themselves. */
const USER_AGENT = "verbatim-api"

/**
 * Deliberately minimal. `repo` is requested later and incrementally, when a
 * user actually asks us to open a private repository.
 */
export const SCOPES = ["read:user", "user:email"] as const

export class GitHubError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "GitHubError"
  }
}

/**
 * The URL we send the browser to for consent. Note what is absent:
 * `client_secret`, since anything in this URL is public.
 */
export const buildAuthorizeUrl = (state: string): string => {
  const params = new URLSearchParams({
    client_id: env.github.clientId,
    redirect_uri: env.github.callbackUrl,
    scope: SCOPES.join(" "),
    state,
    allow_signup: "true",
  })

  return `${AUTHORIZE_URL}?${params.toString()}`
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

/**
 * Trades the callback's short-lived `code` for an access token. The only call
 * carrying the client secret, and the reason this must happen server-side.
 */
export const exchangeCodeForToken = async (
  code: string
): Promise<TokenGrant> => {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      client_id: env.github.clientId,
      client_secret: env.github.clientSecret,
      code,
      redirect_uri: env.github.callbackUrl,
    }),
  })

  if (!response.ok) {
    throw new GitHubError(`Token exchange failed: HTTP ${response.status}`)
  }

  const body = (await response.json()) as TokenResponse

  // GitHub reports OAuth failures as HTTP 200 with an `error` key, so the
  // status check above is not enough on its own.
  if (body.error || !body.access_token) {
    throw new GitHubError(
      body.error_description ?? body.error ?? "No access token in response"
    )
  }

  return {
    accessToken: body.access_token,
    // Both null for standard OAuth App tokens, which do not expire.
    refreshToken: body.refresh_token ?? null,
    expiresAt: body.expires_in
      ? new Date(Date.now() + body.expires_in * 1000)
      : null,
    // GitHub returns granted scopes comma-separated, not space-separated.
    scopes: body.scope ? body.scope.split(",").filter(Boolean) : [],
  }
}

const apiGet = async <T>(path: string, accessToken: string): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": USER_AGENT,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  })

  if (!response.ok) {
    throw new GitHubError(`GET ${path} failed: HTTP ${response.status}`)
  }

  return (await response.json()) as T
}

interface GitHubUser {
  id: number
  login: string
  name: string | null
  email: string | null
  avatar_url: string | null
}

interface GitHubEmail {
  email: string
  primary: boolean
  verified: boolean
}

/**
 * `/user` only exposes an email when the user made it public, which most have
 * not, so fall back to the verified primary address.
 */
const fetchPrimaryEmail = async (
  accessToken: string
): Promise<string | null> => {
  const emails = await apiGet<GitHubEmail[]>("/user/emails", accessToken)

  return emails.find((entry) => entry.primary && entry.verified)?.email ?? null
}

/**
 * Who this token belongs to. The exchange returns a credential and nothing
 * else, so this is how a callback learns whose account it holds.
 */
export const fetchViewer = async (
  accessToken: string
): Promise<ProviderProfile> => {
  const user = await apiGet<GitHubUser>("/user", accessToken)

  // A missing email must not block sign-in, so a failure here is swallowed
  // rather than propagated.
  const email =
    user.email ?? (await fetchPrimaryEmail(accessToken).catch(() => null))

  return {
    provider: "github",
    providerId: String(user.id),
    username: user.login,
    name: user.name,
    email,
    avatarUrl: user.avatar_url,
  }
}
