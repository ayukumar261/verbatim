"use client"

import useSWR from "swr"

import { ApiError, api } from "@/lib/api"

/** The `User` the API returns, with Mongo's dates already serialised. */
interface User {
  _id: string
  name: string | null
  email: string | null
  avatarUrl: string | null
}

/**
 * The provider identity behind the user. The API strips the encrypted tokens
 * before this reaches the browser, so there is nothing secret here.
 */
interface Account {
  _id: string
  provider: string
  providerId: string
  username: string | null
  scopes: string[]
  needsReauth: boolean
}

interface Me {
  user: User
  account: Account | null
}

/**
 * Who is signed in, if anyone. SWR caches this under one key, so every caller
 * shares a single request and a single answer.
 */
function useAuth() {
  const { data, error, isLoading, mutate } = useSWR<Me, Error>("/auth/me")

  // 401 is the answer, not a failure: it means nobody is signed in. Anything
  // else really is broken, and stays in `error` for the UI to say so.
  const signedOut = error instanceof ApiError && error.status === 401

  // A full navigation, not a fetch: the browser has to actually land on
  // GitHub's consent screen, and a redirect cannot do that from inside XHR.
  const signIn = () => {
    window.location.href = `${api.getBaseUrl()}/auth/github`
  }

  const signOut = async () => {
    await api.delete("/auth/session")

    // The answer is already known, so write it into the cache rather than
    // asking the API a question it just answered.
    await mutate(undefined, { revalidate: false })
  }

  return {
    user: signedOut ? null : (data?.user ?? null),
    account: signedOut ? null : (data?.account ?? null),
    isLoading,
    error: signedOut ? undefined : error,
    signIn,
    signOut,
  }
}

export { useAuth }
export type { Account, Me, User }
