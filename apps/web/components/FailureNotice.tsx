"use client"

import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { apiErrorMessage, isProviderUnauthorized } from "@/lib/errors"
import { cn } from "@/lib/utils"

interface FailureNoticeProps {
  error: unknown
  /** Left off where the retry is somewhere else on screen already. */
  onRetry?: () => void
  className?: string
}

/**
 * A failed call and the one thing worth doing about it. A dead GitHub token
 * wants OAuth again rather than a retry, so the button follows the code.
 */
function FailureNotice({ error, onRetry, className }: FailureNoticeProps) {
  const { signIn } = useAuth()
  const expired = isProviderUnauthorized(error)

  return (
    <div
      className={cn("flex flex-col items-center gap-3 py-8", className)}
      role="alert"
    >
      <p className="text-center text-sm text-destructive">
        {apiErrorMessage(error)}
      </p>

      {expired ? (
        <Button variant="outline" size="sm" onClick={signIn}>
          Reconnect GitHub
        </Button>
      ) : (
        onRetry !== undefined && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )
      )}
    </div>
  )
}

export { FailureNotice }
