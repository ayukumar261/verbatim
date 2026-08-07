"use client"

import { SiGithub } from "@icons-pack/react-simple-icons"
import { useSearchParams } from "next/navigation"

import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"

import {
  GITHUB_OAUTH_ERROR_FALLBACK,
  GITHUB_OAUTH_ERROR_MESSAGES,
} from "../constants"

function ConnectForm() {
  const { isLoading, signIn } = useAuth()
  const error = useSearchParams().get("error")

  return (
    <div className="flex flex-col items-center gap-4">
      {error !== null && (
        <p className="text-center text-sm text-destructive">
          {GITHUB_OAUTH_ERROR_MESSAGES[error] ?? GITHUB_OAUTH_ERROR_FALLBACK}
        </p>
      )}

      <Button size="lg" onClick={signIn} disabled={isLoading}>
        <SiGithub className="size-5" />
        Sign in with GitHub
      </Button>
    </div>
  )
}

export { ConnectForm }
