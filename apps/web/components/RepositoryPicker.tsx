"use client"

import { PlusIcon, XIcon } from "lucide-react"
import { useState } from "react"

import { FailureNotice } from "@/components/FailureNotice"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  useAvailableRepositories,
  useRepositories,
} from "@/hooks/use-repositories"

/**
 * Connects and disconnects repositories. It brings no shell of its own, so the
 * same list serves the first-run page and the "Edit repositories" dialog.
 */
function RepositoryPicker() {
  const { repositories, isLoading, error, refresh } = useAvailableRepositories()
  const { repositories: connected, connect, disconnect } = useRepositories()
  const [query, setQuery] = useState("")
  const [pending, setPending] = useState<string | null>(null)
  const [failure, setFailure] = useState<unknown>(null)

  // Keyed on `providerId`, the only id the two lists share. Reading the row's
  // state from here rather than from `isConnected` keeps it from disagreeing
  // with the `_id` that disconnecting needs.
  const connections = new Map(
    connected.map((entry) => [entry.providerId, entry])
  )

  const run = async (providerId: string, action: () => Promise<unknown>) => {
    setPending(providerId)
    setFailure(null)

    try {
      await action()
    } catch (thrown) {
      setFailure(thrown)
    } finally {
      setPending(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner className="size-5" />
      </div>
    )
  }

  if (error !== undefined) {
    return <FailureNotice error={error} onRetry={() => void refresh()} />
  }

  if (repositories.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        GitHub lists no public repositories for this account.
      </p>
    )
  }

  // Filtered here rather than at the API, since the provider already sent the
  // whole list and a round trip per keystroke would be slower than this.
  const needle = query.trim().toLowerCase()
  const matches =
    needle === ""
      ? repositories
      : repositories.filter((repository) =>
          `${repository.owner}/${repository.name}`
            .toLowerCase()
            .includes(needle)
        )

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search repositories..."
        aria-label="Search repositories"
      />

      {matches.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No repositories match.
        </p>
      ) : (
        /* Most recently pushed first, which is the order the API sends. */
        <ul className="max-h-80 divide-y divide-border overflow-y-auto overscroll-contain rounded-lg border">
          {matches.map((repository) => {
            const connection = connections.get(repository.providerId) ?? null
            const busy = pending === repository.providerId

            return (
              <li
                key={repository.providerId}
                className="flex items-center gap-4 px-4 py-3"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="truncate text-sm font-medium">
                    {repository.owner}/{repository.name}
                  </p>

                  {repository.description !== null && (
                    <p className="truncate text-sm text-muted-foreground">
                      {repository.description}
                    </p>
                  )}
                </div>

                {/* Both buttons share a width so the column stays straight as
                    rows flip between the two states. */}
                {connection === null ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-32 shrink-0"
                    disabled={pending !== null}
                    onClick={() =>
                      void run(repository.providerId, () =>
                        connect(repository.providerId)
                      )
                    }
                  >
                    {busy ? <Spinner /> : <PlusIcon />}
                    Connect
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-32 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    disabled={pending !== null}
                    onClick={() =>
                      void run(repository.providerId, () =>
                        disconnect(connection._id)
                      )
                    }
                  >
                    {busy ? <Spinner /> : <XIcon />}
                    Disconnect
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* No retry button, since the row's own button is the retry. */}
      {failure !== null && <FailureNotice error={failure} className="py-2" />}
    </div>
  )
}

export { RepositoryPicker }
