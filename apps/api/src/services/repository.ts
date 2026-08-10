import { Types } from "mongoose"

import { fetchRepository, listRepositories } from "../clients/github.js"
import { Repository } from "../models/repository.js"
import type { RepositoryDocument } from "../models/repository.js"
import { ProviderError } from "../types.js"
import type { AvailableRepository, Provider } from "../types.js"
import { getProviderToken, markRevoked } from "./auth.js"

/** The only provider so far, named once rather than at every call. */
const PROVIDER: Provider = "github"

/** Mongo's error code for a unique index refusing a duplicate. */
const DUPLICATE_KEY = 11000

/**
 * Runs `call` with the user's stored credentials, recording them as revoked if
 * the provider rejects them. One place owns both halves of that lifecycle, so
 * no caller has to remember the second one.
 */
const withToken = async <T>(
  userId: string,
  call: (accessToken: string) => Promise<T>
): Promise<T> => {
  const accessToken = await getProviderToken(userId, PROVIDER)

  if (accessToken === null) {
    throw new ProviderError(PROVIDER, "No usable credentials", { status: 401 })
  }

  try {
    return await call(accessToken)
  } catch (error) {
    // A 401 from the provider means the token itself died, which is almost
    // always the user revoking our access on their end.
    if (error instanceof ProviderError && error.status === 401) {
      await markRevoked(userId, PROVIDER)
    }

    throw error
  }
}

/**
 * The repositories this user has connected. Mongo alone: this backs the
 * selector on every page load, so it must not depend on the provider being
 * reachable, or on a rate limit.
 */
export const listConnectedRepositories = async (
  userId: string
): Promise<RepositoryDocument[]> =>
  Repository.find({ userId, disconnectedAt: null }).sort({ owner: 1, name: 1 })

/**
 * What the picker offers: everything the provider lists, marked with what is
 * already connected. Marking here keeps the controller and the browser from
 * each having to know how the two lists relate.
 */
export const listAvailableRepositories = async (
  userId: string
): Promise<AvailableRepository[]> => {
  const [available, connected] = await Promise.all([
    withToken(userId, listRepositories),
    listConnectedRepositories(userId),
  ])

  const connectedIds = new Set(connected.map((entry) => entry.providerId))

  return available.map((repository) => ({
    ...repository,
    isConnected: connectedIds.has(repository.providerId),
  }))
}

/**
 * Connects a repository, after asking the provider whether this user may see
 * it at all. What gets stored is the provider's answer, never what a client
 * sent, so a caller can choose a repository but not describe one.
 */
export const connectRepository = async (
  userId: string,
  providerId: string
): Promise<RepositoryDocument> => {
  const repository = await withToken(userId, (accessToken) =>
    fetchRepository(providerId, accessToken)
  )

  const identity = {
    userId,
    provider: PROVIDER,
    providerId: repository.providerId,
  }

  const update = {
    owner: repository.owner,
    name: repository.name,
    defaultBranch: repository.defaultBranch,
    // Reconnecting is the same action as connecting, so one that was
    // disconnected comes back rather than colliding with its own document.
    disconnectedAt: null,
  }

  try {
    return await Repository.findOneAndUpdate(identity, update, {
      upsert: true,
      returnDocument: "after",
    })
  } catch (error) {
    if ((error as { code?: unknown }).code !== DUPLICATE_KEY) {
      throw error
    }

    // Two clicks raced into the same insert and the other won. Its document is
    // the survivor, so this call updates that rather than inserting a second.
    const winner = await Repository.findOneAndUpdate(identity, update, {
      returnDocument: "after",
    })

    if (winner === null) {
      throw error
    }

    return winner
  }
}

/**
 * Ends a connection, leaving the document and its conversations readable.
 * Scoped to the owner, so one user cannot disconnect another's repository.
 */
export const disconnectRepository = async (
  userId: string,
  id: string
): Promise<boolean> => {
  // A malformed id is a miss, rather than a cast error escaping as a 500.
  if (!Types.ObjectId.isValid(id)) {
    return false
  }

  const result = await Repository.updateOne(
    { _id: id, userId, disconnectedAt: null },
    { disconnectedAt: new Date() }
  )

  return result.matchedCount === 1
}
