import { Suspense } from "react"

import { ConnectForm } from "./components/ConnectForm"

export default function Page() {
  // `useSearchParams` opts its subtree out of prerendering, so the boundary
  // keeps everything above it static.
  return (
    <Suspense fallback={null}>
      <ConnectForm />
    </Suspense>
  )
}
