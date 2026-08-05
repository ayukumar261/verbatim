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
