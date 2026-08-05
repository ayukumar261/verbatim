const isProduction = process.env.NODE_ENV === "production"

const read = (name: string): string => {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

export const env = {
  isProduction,
  port: Number(read("PORT")),
  origin: read("ORIGIN"),
  mongoUrl: read("MONGO_URL"),
  mongoDb: read("MONGO_DB"),
  redisUrl: read("REDIS_URL"),
  tokenEncryptionKey: read("TOKEN_ENCRYPTION_KEY"),
} as const
