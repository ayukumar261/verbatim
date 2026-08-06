import { Account } from "../models/account.js"
import type { AccountDocument } from "../models/account.js"
import { User } from "../models/user.js"
import type { ProviderProfile, TokenGrant } from "../types.js"

/** Mongo's error code for a unique index refusing a duplicate. */
const DUPLICATE_KEY = 11000

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code: unknown }).code === DUPLICATE_KEY

// Encryption is the model's business, so this goes through its setters.
// `username` is refreshed every time because it is display-only and people
// rename themselves. The `User` behind it deliberately is not, see below.
const storeGrant = async (
  account: AccountDocument,
  profile: ProviderProfile,
  grant: TokenGrant
): Promise<string> => {
  account.username = profile.username
  // Also clears `needsReauth`: these credentials are known good.
  account.setAccessToken(grant.accessToken)
  account.setRefreshToken(grant.refreshToken)
  account.expiresAt = grant.expiresAt
  account.scopes = grant.scopes

  await account.save()

  return account.userId.toString()
}

/**
 * Turns a completed OAuth exchange into the id of whoever it belongs to,
 * creating the `User` and `Account` the first time we see this identity.
 */
export const signInWithProvider = async (
  profile: ProviderProfile,
  grant: TokenGrant
): Promise<string> => {
  const identity = {
    provider: profile.provider,
    providerId: profile.providerId,
  }

  const existing = await Account.findOne(identity)

  if (existing !== null) {
    return storeGrant(existing, profile, grant)
  }

  // Seeded once, on creation. Later sign-ins leave these alone, so a name
  // edited inside Verbatim survives the next trip through GitHub.
  const user = await User.create({
    name: profile.name,
    email: profile.email,
    avatarUrl: profile.avatarUrl,
  })

  try {
    const account = new Account({ ...identity, userId: user._id })

    return await storeGrant(account, profile, grant)
  } catch (error) {
    // There is no transaction to roll back: development Mongo runs standalone,
    // so the user created a moment ago is undone by hand instead.
    await User.deleteOne({ _id: user._id })

    // Anything but a duplicate is a real failure worth surfacing.
    if (!isDuplicateKey(error)) {
      throw error
    }

    // Two callbacks raced and the other won. Its account is the survivor, so
    // this grant is stored against that rather than against a second user.
    const winner = await Account.findOne(identity)

    if (winner === null) {
      throw error
    }

    return storeGrant(winner, profile, grant)
  }
}
