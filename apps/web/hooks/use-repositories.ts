"use client"

import useSWR, { useSWRConfig } from "swr"

import { ApiError, api } from "@/lib/api"

/** A repository someone has connected, with Mongo's dates already serialised. */
interface Repository {
  _id: string
  provider: string
  providerId: string
  owner: string
  name: string
  defaultBranch: string
  /** Last write, which for a connected one is when it was connected. */
  updatedAt: string
}

/**
 * A repository the picker can offer. `isConnected` is computed per request, so
 * it is right on arrival and stale the moment anyone connects.
 */
interface AvailableRepository {
  provider: string
  providerId: string
  owner: string
  name: string
  defaultBranch: string
  description: string | null
  pushedAt: string | null
  isConnected: boolean
}

const CONNECTED_KEY = "/repositories"
const AVAILABLE_KEY = "/repositories/available"

/**
 * The repositories this user has connected. Mongo-backed, so it answers
 * whether or not GitHub is reachable.
 */
function useRepositories() {
  const { data, error, isLoading, mutate } = useSWR<{
    repositories: Repository[]
  }>(CONNECTED_KEY)

  const { mutate: mutateKey } = useSWRConfig()

  // Writing here also changes `isConnected` over in the picker's list, so the
  // two keys always go stale together.
  const refreshBoth = async () => {
    await Promise.all([mutate(), mutateKey(AVAILABLE_KEY)])
  }

  const connect = async (providerId: string): Promise<Repository> => {
    const response = await api.post<{ repository: Repository }>(CONNECTED_KEY, {
      providerId,
    })

    if (response.error !== undefined || response.data === undefined) {
      throw new ApiError(
        response.error ?? "unexpected_response",
        response.status
      )
    }

    await refreshBoth()

    return response.data.repository
  }

  const disconnect = async (id: string) => {
    const response = await api.delete(`${CONNECTED_KEY}/${id}`)

    if (response.error !== undefined) {
      throw new ApiError(response.error, response.status)
    }

    await refreshBoth()
  }

  return {
    repositories: data?.repositories ?? [],
    isLoading,
    error,
    refresh: mutate,
    connect,
    disconnect,
  }
}

/**
 * What the picker offers. This one does reach GitHub, so it can fail in ways
 * the connected list cannot.
 */
function useAvailableRepositories() {
  const { data, error, isLoading, mutate } = useSWR<{
    repositories: AvailableRepository[]
  }>(AVAILABLE_KEY)

  return {
    repositories: data?.repositories ?? [],
    isLoading,
    error,
    refresh: mutate,
  }
}

export { useAvailableRepositories, useRepositories }
export type { AvailableRepository, Repository }
