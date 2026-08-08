import { Schema, model } from "mongoose"
import type { HydratedDocumentFromSchema } from "mongoose"

import { PROVIDERS } from "../types.js"

/**
 * A repository someone connected to Verbatim. Conversations hang off these,
 * which is what makes the sidebar a filter rather than a search. Identity keys
 * on `{ provider, providerId }`, the same way `Account` does.
 */
const repositorySchema = new Schema(
  {
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
     * The repository's id at the provider, as a string. Stable across renames
     * and transfers, which is what lets `owner` and `name` be a display cache.
     */
    providerId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
    },

    /**
     * Whoever the repository sits under, e.g. GitHub's `owner.login`. Display
     * only, and refreshed, since repositories get renamed and transferred.
     */
    owner: {
      type: String,
      required: true,
      trim: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    /** Where a clone starts. Refreshed alongside `owner` and `name`. */
    defaultBranch: {
      type: String,
      required: true,
    },

    /** Always false while scopes stay minimal, but the picker badges it. */
    isPrivate: {
      type: Boolean,
      default: false,
    },

    /**
     * Set instead of deleting, so disconnecting a repository leaves its
     * conversations readable rather than destroying them.
     */
    disconnectedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
)

/**
 * One connection per user per repository, so a double-clicked connect loses to
 * a duplicate key rather than writing twice. Also serves "list my
 * repositories", since `userId` leads the index.
 */
repositorySchema.index(
  { userId: 1, provider: 1, providerId: 1 },
  { unique: true }
)

export const Repository = model("Repository", repositorySchema)

export type RepositoryDocument = HydratedDocumentFromSchema<
  typeof repositorySchema
>
