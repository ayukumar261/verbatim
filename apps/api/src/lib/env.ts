const isProduction = process.env.NODE_ENV === "production"

const withLocalDefault = (name: string, localDefault: string): string => {
  const value = process.env[name]

  if (value) {
    return value
  }

  if (isProduction) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return localDefault
}

export const env = {
  isProduction,
  port: Number(process.env.PORT ?? 3001),
  origin: withLocalDefault("ORIGIN", "http://localhost:3000"),
  mongoUrl: withLocalDefault("MONGO_URL", "mongodb://127.0.0.1:27017"),
  mongoDb: withLocalDefault("MONGO_DB", "verbatim"),
  redisUrl: withLocalDefault("REDIS_URL", "redis://127.0.0.1:6379"),
} as const
