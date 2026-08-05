import mongoose from "mongoose"

import { env } from "../env.js"

mongoose.set("strictQuery", true)

mongoose.connection.on("error", (error) => {
  console.error("mongo connection error:", error)
})

mongoose.connection.on("disconnected", () => {
  console.warn("mongo disconnected")
})

export const connectMongo = async () => {
  await mongoose.connect(env.mongoUrl, {
    dbName: env.mongoDb,
    serverSelectionTimeoutMS: 5000,
  })

  return mongoose.connection
}

export const disconnectMongo = () => mongoose.disconnect()

export const mongoStatus = () => mongoose.STATES[mongoose.connection.readyState]
