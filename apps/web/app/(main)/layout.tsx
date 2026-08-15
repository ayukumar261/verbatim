"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

import { FailureNotice } from "@/components/FailureNotice"
import { Spinner } from "@/components/ui/spinner"
import { useAuth } from "@/hooks/use-auth"

/**
 * The gate every signed-in route sits behind. It lives here rather than in
 * each page so no page can forget it.
 */
export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const router = useRouter()
  const { user, isLoading, error, refresh } = useAuth()

  // Being signed out belongs on the connect page. An unreachable API does not,
  // since that is worth showing rather than bouncing the user on.
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

  if (error !== undefined) {
    return (
      <div className="flex min-h-svh items-center justify-center p-6">
        <FailureNotice error={error} onRetry={() => void refresh()} />
      </div>
    )
  }

  return children
}
