/**
 * What the API's `landing()` can redirect back with, and what each code means
 * to a person. Looked up rather than rendered, so nothing from the URL reaches
 * the page as text. Adding a code to the API means adding it here.
 */
export const GITHUB_OAUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "You cancelled the GitHub sign-in.",
  invalid_request: "GitHub sent an incomplete response. Please try again.",
  invalid_state: "That sign-in expired or began somewhere else. Start over.",
  provider_error: "GitHub could not complete the sign-in. Please try again.",
}

/** Shown for a code we do not recognise, which is the case that matters. */
export const GITHUB_OAUTH_ERROR_FALLBACK = "Sign-in failed. Please try again."
