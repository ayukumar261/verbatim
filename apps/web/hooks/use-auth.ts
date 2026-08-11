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
  isRevoked: boolean
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

  // Only this code means the session is gone. A 401 can also mean the session
  // is fine and just the GitHub token died, which this must not catch.
  const isUnauthorized =
    error instanceof ApiError && error.code === "unauthorized"

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

  // Signed out is one answer, not three: nobody, no account, and no error.
  let session
  if (isUnauthorized) {
    session = { user: null, account: null, error: undefined }
  } else {
    session = {
      user: data?.user ?? null,
      account: data?.account ?? null,
      error,
    }
  }

  return { ...session, isLoading, signIn, signOut }
}

export { useAuth }
export type { Account, Me, User }
