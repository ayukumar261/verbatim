"use client"

import type { SWRConfiguration } from "swr"
import { SWRConfig } from "swr"

import { ApiError, fetcher } from "@/lib/api"

const config: SWRConfiguration = {
  fetcher,

  // A 4xx is an answer, not a hiccup, so retrying it only wastes requests.
  // Anything else keeps SWR's usual backoff.
  onErrorRetry: (error, _key, options, revalidate, { retryCount }) => {
    if (error instanceof ApiError && error.status < 500) {
      return
    }

    if (retryCount >= (options.errorRetryCount ?? 5)) {
      return
    }

    setTimeout(() => revalidate({ retryCount }), options.errorRetryInterval)
  },
}

/**
 * Global SWR configuration. Every cache key is an API endpoint, so the fetcher
 * is set once here rather than passed at each `useSWR` call.
 */
function SWRProvider({ children }: { children: React.ReactNode }) {
  return <SWRConfig value={config}>{children}</SWRConfig>
}

export { SWRProvider }
