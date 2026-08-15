"use client"

import { LogOutIcon } from "lucide-react"

import { FailureNotice } from "@/components/FailureNotice"
import { RepositoryPicker } from "@/components/RepositoryPicker"
import { RepositorySelect } from "@/components/RepositorySelect"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useAuth } from "@/hooks/use-auth"
import { useRepositories } from "@/hooks/use-repositories"
import { useSelectedRepository } from "@/hooks/use-selected-repository"

export default function Page() {
  const { signOut } = useAuth()
  const { repositories, isLoading, error, refresh } = useRepositories()
  const { selected, select } = useSelectedRepository(repositories)

  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  if (error !== undefined) {
    return (
      <div className="flex min-h-svh items-center justify-center p-6">
        <FailureNotice error={error} onRetry={() => void refresh()} />
      </div>
    )
  }

  // With nothing connected there is no selector to hang a dialog off, so the
  // picker is the page itself.
  if (repositories.length === 0) {
    return (
      <div className="flex min-h-svh items-center justify-center p-6">
        <div className="w-full max-w-2xl">
          <RepositoryPicker />
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-svh flex-col">
      <nav className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-4 py-3">
        <RepositorySelect
          className="w-64"
          value={selected}
          onValueChange={select}
        />

        <Button onClick={() => void signOut()}>
          <LogOutIcon />
          Sign out
        </Button>
      </nav>
    </div>
  )
}
