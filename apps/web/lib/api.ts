interface ApiResponse<T = unknown> {
  data?: T
  error?: string
  status: number
}

interface RequestOptions {
  headers?: Record<string, string>
  body?: unknown
}

class Api {
  private baseUrl: string

  constructor() {
    this.baseUrl =
      process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001"
  }

  private async request<T>(
    endpoint: string,
    method: "GET" | "POST" | "PUT" | "DELETE",
    options: RequestOptions = {}
  ): Promise<ApiResponse<T>> {
    try {
      const url = `${this.baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`

      const config: RequestInit = {
        method,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
      }

      if (options.body && method !== "GET") {
        config.body = JSON.stringify(options.body)
      }

      const response = await fetch(url, config)

      let data
      try {
        data = await response.json()
      } catch {
        data = null
      }

      if (!response.ok) {
        return {
          error:
            typeof data?.error?.code === "string"
              ? data.error.code
              : "unexpected_response",
          status: response.status,
        }
      }

      return {
        data,
        status: response.status,
      }
    } catch {
      return {
        error: "network_error",
        status: 0,
      }
    }
  }

  /**
   * Make a GET request
   */
  async get<T>(
    endpoint: string,
    options: Omit<RequestOptions, "body"> = {}
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, "GET", options)
  }

  /**
   * Make a POST request
   */
  async post<T>(
    endpoint: string,
    body?: unknown,
    options: RequestOptions = {}
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, "POST", { ...options, body })
  }

  /**
   * Make a PUT request
   */
  async put<T>(
    endpoint: string,
    body?: unknown,
    options: RequestOptions = {}
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, "PUT", { ...options, body })
  }

  /**
   * Make a DELETE request
   */
  async delete<T>(
    endpoint: string,
    body?: unknown,
    options: RequestOptions = {}
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, "DELETE", { ...options, body })
  }

  /**
   * Get the base URL being used
   */
  getBaseUrl(): string {
    return this.baseUrl
  }
}

// Export a singleton instance
export const api = new Api()

class ApiError extends Error {
  readonly status: number

  readonly code: string

  constructor(code: string, status: number) {
    super(code)
    this.name = "ApiError"
    this.status = status
    this.code = code
  }
}

/**
 * SWR's global fetcher. The cache key is the endpoint, and anything that is
 * not ok throws, which is the contract SWR expects.
 */
const fetcher = async <T>(endpoint: string): Promise<T> => {
  const response = await api.get<T>(endpoint)

  if (response.error !== undefined) {
    throw new ApiError(response.error, response.status)
  }

  return response.data as T
}

export { ApiError, fetcher }

// Export the class for custom instances if needed
export { Api }

// Export types for use in components
export type { ApiResponse, RequestOptions }
