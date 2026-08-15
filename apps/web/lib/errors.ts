import { ApiError } from "./api"

/**
 * What a failed call means to a person, looked up by code. Nothing the server
 * sent is rendered as text.
 */
const API_ERROR_MESSAGES: Record<string, string> = {
  network_error: "Could not reach Verbatim. Check your connection.",
  provider_error: "GitHub is not responding right now. Try again shortly.",
  provider_unauthorized: "Verbatim's access to GitHub has run out.",
  server_error: "Something went wrong on our end. Please try again.",
  unexpected_response: "Verbatim did not understand the server's answer.",
}

/** Shown for a code we do not recognise, which is the case that matters. */
const API_ERROR_FALLBACK = "Something went wrong. Please try again."

const apiErrorMessage = (error: unknown): string => {
  if (!(error instanceof ApiError)) {
    return API_ERROR_FALLBACK
  }

  return API_ERROR_MESSAGES[error.code] ?? API_ERROR_FALLBACK
}

/**
 * The session is fine and only the GitHub token is not. Worth its own check
 * because it is the one failure the user can fix, by going through OAuth again.
 */
const isProviderUnauthorized = (error: unknown): boolean =>
  error instanceof ApiError && error.code === "provider_unauthorized"

export { apiErrorMessage, isProviderUnauthorized }
