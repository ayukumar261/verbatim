import { Schema, model } from "mongoose"
import type { HydratedDocumentFromSchema } from "mongoose"

import { PROVIDERS } from "../types.js"
import { decrypt, encrypt } from "../utils/crypto.js"

/**
 * A user's identity and credentials at one OAuth provider. Owns the provider
 * identity outright: a sign-in looks up `{ provider, providerId }` here, then
 * follows `userId` to the `User`. Tokens are encrypted at rest.
 */
const accountSchema = new Schema(
  {
    /** Owning `User`. A user has at most one account per provider. */
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },

    provider: {
      type: String,
      required: true,
      enum: PROVIDERS,
      immutable: true,
    },

    /**
     * The user's id at the provider, as a string. Stable across renames,
     * which is why identity keys on this rather than on `username`.
     */
    providerId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
    },

    /**
     * The provider's handle, e.g. GitHub's `login`. Display only: users can
     * rename, and the freed name can then be claimed by someone else.
     */
    username: {
      type: String,
      default: null,
      trim: true,
    },

    encryptedAccessToken: {
      type: String,
      required: true,
    },

    /**
     * Only set when the provider issues expiring tokens. Plain GitHub OAuth
     * App tokens do not expire, so this stays `null` until we either move to
     * a GitHub App or opt in to token expiration.
     */
    encryptedRefreshToken: {
      type: String,
      default: null,
    },

    /** When `encryptedAccessToken` stops working. `null` means "no expiry". */
    expiresAt: {
      type: Date,
      default: null,
    },

    /**
     * Scopes the provider actually granted, which is not necessarily what we
     * asked for. Check this before attempting a call that needs `repo`, so a
     * missing scope becomes a prompt to re-authorise instead of a 403.
     */
    scopes: {
      type: [String],
      default: [],
    },

    /**
     * Set when the token stops working, typically because the user revoked
     * our access on GitHub. Signals the frontend to send them back through
     * the OAuth flow instead of showing them repeated failures.
     */
    needsReauth: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,

    methods: {
      /** Decrypts the access token for use in a GitHub API call. */
      getAccessToken(): string {
        return decrypt(this.encryptedAccessToken)
      },

      /** Encrypts and stores a token. Also clears any prior `needsReauth`. */
      setAccessToken(token: string): void {
        this.encryptedAccessToken = encrypt(token)
        this.needsReauth = false
      },

      getRefreshToken(): string | null {
        return this.encryptedRefreshToken
          ? decrypt(this.encryptedRefreshToken)
          : null
      },

      setRefreshToken(token: string | null): void {
        this.encryptedRefreshToken = token === null ? null : encrypt(token)
      },

      /** Whether the provider granted every one of `required`. */
      hasScopes(...required: string[]): boolean {
        return required.every((scope) => this.scopes.includes(scope))
      },
    },
  }
)

/**
 * Strips the token fields from any serialised account. Set here, not inline in
 * the schema options: an inline `transform` creates a type circularity that
 * silently collapses every inferred field to `unknown`.
 */
accountSchema.set("toJSON", {
  transform: (_document: unknown, record: Record<string, unknown>) => {
    // `Reflect.deleteProperty` rather than `delete`, which TypeScript rejects
    // on fields the schema declares as always present.
    Reflect.deleteProperty(record, "encryptedAccessToken")
    Reflect.deleteProperty(record, "encryptedRefreshToken")

    return record
  },
})

/**
 * One provider identity maps to exactly one account, so two users cannot both
 * claim the same GitHub login.
 */
accountSchema.index({ provider: 1, providerId: 1 }, { unique: true })

/**
 * And one user holds at most one account per provider. Doubles as the index
 * for "find this user's GitHub account", since `userId` is the prefix.
 */
accountSchema.index({ userId: 1, provider: 1 }, { unique: true })

export const Account = model("Account", accountSchema)

export type AccountDocument = HydratedDocumentFromSchema<typeof accountSchema>
