"use client"

import { LogOutIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useAuth } from "@/hooks/use-auth"

export default function Page() {
  const router = useRouter()
  const { user, account, isLoading, error, signOut } = useAuth()
  const [signingOut, setSigningOut] = useState(false)

  // Being signed out belongs on the connect page. An unreachable API does not:
  // that is worth showing rather than bouncing the user on.
  const signedOut = !isLoading && error === undefined && user === null

  useEffect(() => {
    if (signedOut) {
      router.replace("/connect")
    }
  }, [signedOut, router])

  // Held through the redirect too, so the page never flashes empty on the way.
  if (isLoading || signedOut) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  const body = error === undefined ? { user, account } : { error: error.message }

  const onSignOut = async () => {
    setSigningOut(true)

    try {
      await signOut()
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="flex min-h-svh flex-col items-start gap-4 p-6">
      <pre className="font-mono text-xs">{JSON.stringify(body, null, 2)}</pre>

      {/* Only with a session to end. A failed `/auth/me` leaves nothing to
          sign out of, and the same request would fail again anyway. */}
      {user !== null && (
        <Button onClick={onSignOut} disabled={signingOut}>
          <LogOutIcon />
          {signingOut ? "Signing out..." : "Sign out"}
        </Button>
      )}
    </div>
  )
}
