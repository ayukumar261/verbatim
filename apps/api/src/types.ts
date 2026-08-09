/**
 * Domain types: our vocabulary, not any provider's. Clients map into these
 * before returning, so nothing downstream depends on GitHub's JSON shapes.
 */

/**
 * The OAuth providers we know how to talk to. Kept as a list so adding one is
 * a single edit rather than a schema migration.
 */
export const PROVIDERS = ["github"] as const

export type Provider = (typeof PROVIDERS)[number]

/**
 * Who an access token belongs to. The first three fields describe the
 * `Account`, the rest seed the `User`. All nullable: a GitHub profile may
 * have no name, email, or avatar, and none of that should block a sign-in.
 */
export interface ProviderProfile {
  provider: Provider
  providerId: string
  username: string | null
  name: string | null
  email: string | null
  avatarUrl: string | null
}

/**
 * The result of trading an authorization code for credentials. `refreshToken`
 * and `expiresAt` are null for GitHub OAuth App tokens, which do not expire.
 */
export interface TokenGrant {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
  scopes: string[]
}

/**
 * A repository as we describe it. `description` and `pushedAt` are here for
 * the picker and deliberately not persisted: both go stale on the next push,
 * and the connected list reads from Mongo rather than from the provider.
 */
export interface ProviderRepository {
  provider: Provider
  providerId: string
  owner: string
  name: string
  defaultBranch: string
  isPrivate: boolean
  description: string | null
  /** Null for a repository that has never been pushed to. */
  pushedAt: Date | null
}

/**
 * A session as the rest of the app sees it: plain, already revived from
 * whichever store answered, so a caller never learns whether the read was a
 * cache hit or a trip to Mongo.
 */
export interface Session {
  sid: string
  userId: string
  createdAt: Date
  expiresAt: Date
}

/**
 * A call to a provider failed. Named for the role rather than the provider, so
 * a second one throws the same class and `provider` says which.
 */
export class ProviderError extends Error {
  readonly provider: Provider

  /**
   * The HTTP status, as a field rather than only in the message, so a handler
   * can tell "you cannot see this" from "the provider is down" without
   * matching on text. Null when the failure was not an HTTP status, which is
   * how GitHub reports OAuth errors.
   */
  readonly status: number | null

  constructor(
    provider: Provider,
    message: string,
    options?: { status?: number; cause?: unknown }
  ) {
    super(message, options)
    this.name = "ProviderError"
    this.provider = provider
    this.status = options?.status ?? null
  }
}
