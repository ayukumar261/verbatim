import { Schema, model } from "mongoose"
import type { HydratedDocumentFromSchema } from "mongoose"

/**
 * One signed-in browser. The source of truth: Redis caches these, but losing
 * the cache costs a round trip rather than a user's session.
 */
const sessionSchema = new Schema(
  {
    /**
     * The opaque id carried in the cookie. A credential, not an identifier,
     * so anything user-facing should key on `_id` instead.
     */
    sid: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
    },

    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },

    /**
     * When this session stops working. Queries must check it themselves: the
     * TTL index below sweeps roughly once a minute, so an expired document is
     * still readable for a while after the fact.
     */
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
)

/**
 * Strips the session id from anything serialised, so a "your devices" view
 * cannot hand one browser the credential belonging to another.
 */
sessionSchema.set("toJSON", {
  transform: (_document: unknown, record: Record<string, unknown>) => {
    Reflect.deleteProperty(record, "sid")

    return record
  },
})

/** Every session a user holds, which is what makes the device list a query. */
sessionSchema.index({ userId: 1 })

/** Mongo deletes documents once `expiresAt` passes. Cleanup, not correctness. */
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const Session = model("Session", sessionSchema)

export type SessionDocument = HydratedDocumentFromSchema<typeof sessionSchema>
