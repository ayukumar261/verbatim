import { Schema, model } from "mongoose"
import type { HydratedDocumentFromSchema } from "mongoose"

/**
 * A person using the application. Says nothing about how they signed in:
 * provider identities and credentials live on `Account`, one per provider, so
 * adding a second is a new `Account` rather than a change to this schema.
 */
const userSchema = new Schema(
  {
    name: {
      type: String,
      default: null,
      trim: true,
    },

    /**
     * Intentionally *not* unique: treating a matching email as proof of "same
     * person" is how account linking becomes account takeover.
     */
    email: {
      type: String,
      default: null,
      trim: true,
      lowercase: true,
    },

    avatarUrl: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
)

export const User = model("User", userSchema)

/** What a query gives you back: the raw fields plus Mongoose's document API. */
export type UserDocument = HydratedDocumentFromSchema<typeof userSchema>
