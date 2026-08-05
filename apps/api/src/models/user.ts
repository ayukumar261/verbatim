import { Schema, model } from "mongoose"
import type { HydratedDocumentFromSchema } from "mongoose"

/**
 * A person using the application.
 *
 * Deliberately says nothing about *how* they signed in. Provider identities,
 * and the credentials that come with them, live on `Account`: one document
 * per provider, pointing back here. Adding a second provider is therefore a
 * new `Account`, not a change to this schema.
 *
 * The profile fields are a snapshot seeded from whichever provider the user
 * first signed in with, and are the app's own copy: if we ever let someone
 * edit their display name, this is what changes, not the GitHub profile.
 *
 * All of them are optional. A GitHub account is allowed to have no display
 * name and no public email, so requiring either would reject real users.
 */
const userSchema = new Schema(
  {
    name: {
      type: String,
      default: null,
      trim: true,
    },

    /**
     * Intentionally *not* unique. Two people can legitimately end up sharing
     * an address, and more importantly, treating a matching email as proof of
     * "same person" is the classic way account linking becomes account
     * takeover. Linking is a decision for the route layer, not an index.
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
