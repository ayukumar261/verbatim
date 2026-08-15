"use client"

import { useState } from "react"

import type { Repository } from "@/hooks/use-repositories"

const STORAGE_KEY = "verbatim:selected-repository"

/** The fallback when nothing is remembered, or what was is no longer connected. */
const newestConnected = (repositories: Repository[]): Repository | null =>
  repositories.reduce<Repository | null>(
    (latest, entry) =>
      latest === null || entry.updatedAt > latest.updatedAt ? entry : latest,
    null
  )

/**
 * Which repository is in scope, remembered per browser so a reload lands where
 * the last visit left off. Resolved during render rather than in an effect, so
 * the field never flashes empty on the way to its answer.
 */
function useSelectedRepository(repositories: Repository[]) {
  // Read once. This is null on the server, but the selector only renders once
  // the list has arrived on the client, so there is nothing to mismatch.
  const [rememberedId] = useState(() =>
    typeof window === "undefined"
      ? null
      : window.localStorage.getItem(STORAGE_KEY)
  )

  const [selectedId, setSelectedId] = useState<string | null>(null)

  const byId = (id: string | null) =>
    id === null
      ? null
      : (repositories.find((entry) => entry._id === id) ?? null)

  // Falls through rather than going empty, so disconnecting the one in scope
  // lands on another instead of clearing the field.
  const selected =
    byId(selectedId) ?? byId(rememberedId) ?? newestConnected(repositories)

  const select = (repository: Repository | null) => {
    setSelectedId(repository?._id ?? null)

    // A cleared selection keeps the last real choice, since that is still the
    // better guess than whatever happens to be newest.
    if (repository !== null) {
      window.localStorage.setItem(STORAGE_KEY, repository._id)
    }
  }

  return { selected, select }
}

export { useSelectedRepository }
