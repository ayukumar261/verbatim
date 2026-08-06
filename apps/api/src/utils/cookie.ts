import type { Context } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import type { CookieOptions } from "hono/utils/cookie"

import { env } from "../env.js"
import { SESSION_TTL, STATE_TTL } from "../services/session.js"

const SESSION_COOKIE = "verbatim_session"
const STATE_COOKIE = "verbatim_oauth_state"

// `Lax` not `Strict`: the callback is a top-level navigation from github.com.
// Subdomains of one domain are same-site, so a web/api split on Dokploy keeps
// working; only a wholly different domain would force `None`.
const base: CookieOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: "Lax",
  path: "/",
}

/** Marks the browser as signed in. Carries an opaque id, never a claim. */
export const setSessionCookie = (c: Context, sid: string): void => {
  setCookie(c, SESSION_COOKIE, sid, { ...base, maxAge: SESSION_TTL })
}

export const readSessionCookie = (c: Context): string | null =>
  getCookie(c, SESSION_COOKIE) ?? null

export const clearSessionCookie = (c: Context): void => {
  deleteCookie(c, SESSION_COOKIE, base)
}

// Binds an in-flight attempt to this browser. Redis proves we issued a
// `state`; only this proves the browser coming back is the one that left.
export const setStateCookie = (c: Context, state: string): void => {
  setCookie(c, STATE_COOKIE, state, { ...base, maxAge: STATE_TTL })
}

export const readStateCookie = (c: Context): string | null =>
  getCookie(c, STATE_COOKIE) ?? null

export const clearStateCookie = (c: Context): void => {
  deleteCookie(c, STATE_COOKIE, base)
}
