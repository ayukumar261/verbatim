import { Schema, model } from "mongoose"
import type { HydratedDocumentFromSchema } from "mongoose"

import { decrypt, encrypt } from "../utils/crypto.js"

/**
 * The OAuth providers we know how to talk to. Kept as a list so adding one
 * later is a single edit here rather than a schema migration.
 */
export const PROVIDERS = ["github"] as const

export type Provider = (typeof PROVIDERS)[number]

/**
 * A user's identity and credentials at one OAuth provider: who they are on
 * GitHub, and the token that lets us call GitHub *as* them.
 *
 * This collection owns the provider identity outright; `User` holds no
 * provider ids. A sign-in callback therefore starts here: look up
 * `{ provider, providerId }`, and either follow `userId` to a returning user
 * or create a new one.
 *
 * Tokens are stored encrypted (see `utils/crypto.ts`). The threat this guards
 * against is a leaked database dump: a stolen backup full of plaintext tokens
 * is live access to every user's GitHub, whereas ciphertext is inert without
 * `TOKEN_ENCRYPTION_KEY`, which lives in the environment and never in Mongo.
 *
 * The stored fields are named `encrypted*` so it is obvious at the call site
 * that they are ciphertext. Read and write them through the methods below
 * rather than touching them directly.
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
     * The user's id *at the provider*: GitHub's numeric id, as a string.
     *
     * This is the only place a provider identity is recorded, and it is what
     * a sign-in callback looks up to decide whether this is a returning user.
     *
     * Stored as a string even though GitHub's is numeric, because the next
     * provider's may not be, and because it is only ever compared, never
     * arithmetic. Note that Mongoose 9 refuses to build an ObjectId from a
     * number, so string is also the safer habit generally.
     */
    providerId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
    },

    /**
     * The user's handle at the provider: GitHub's `login`, e.g. `octocat`.
     *
     * For display and for building GitHub URLs. Never use it to identify
     * someone: users can rename, and the name is then free for someone else
     * to take. That is what `providerId` is for.
     *
     * Nullable because not every provider has a concept of a handle.
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
 * Defence in depth. The ciphertext is useless without the key, but an account
 * document has no business appearing in a response at all, so strip the token
 * fields on the way out.
 *
 * Set here rather than in the options above on purpose: a `transform` declared
 * inline is typed against the very document type Mongoose is still inferring,
 * and the resulting circularity silently collapses every field to `unknown`.
 * Applying it afterwards keeps the inferred types intact.
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
