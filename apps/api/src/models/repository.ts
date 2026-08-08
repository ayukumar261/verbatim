import { Schema, model } from "mongoose"
import type { HydratedDocumentFromSchema } from "mongoose"

/**
 * A GitHub repository someone connected to Verbatim. Conversations hang off
 * these, which is what makes the sidebar a filter rather than a search.
 */
const repositorySchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },

    /**
     * GitHub's numeric id, which survives a rename or a transfer. Identity
     * lives here so `owner` and `name` stay a display cache.
     */
    githubId: {
      type: Number,
      required: true,
      immutable: true,
    },

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
repositorySchema.index({ userId: 1, githubId: 1 }, { unique: true })

export const Repository = model("Repository", repositorySchema)

export type RepositoryDocument = HydratedDocumentFromSchema<
  typeof repositorySchema
>
