import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

import { env } from "../env.js"

/**
 * AES-256 in GCM mode. GCM is *authenticated* encryption: decryption fails
 * loudly if the ciphertext was altered, rather than quietly returning garbage.
 */
const ALGORITHM = "aes-256-gcm"

const KEY_LENGTH = 32
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

const key = Buffer.from(env.tokenEncryptionKey, "base64")

if (key.length !== KEY_LENGTH) {
  throw new Error(
    `TOKEN_ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes, got ${key.length}. ` +
      `Generate one with: openssl rand -base64 32`
  )
}

/**
 * Encrypts a secret for storage in Mongo, so that a leaked database dump does
 * not hand over live GitHub access tokens.
 *
 * The output is `iv || authTag || ciphertext`, base64 encoded. Both the IV and
 * the auth tag are fixed width, so `decrypt` can slice them back off.
 *
 * The IV is random on every call, which means encrypting the same token twice
 * produces two different ciphertexts. That is deliberate: reusing an IV with
 * the same key breaks GCM badly.
 */
export const encrypt = (plaintext: string): string => {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ])

  // `getAuthTag` is only valid after `final`.
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64")
}

/**
 * Reverses `encrypt`. Throws if the payload was truncated, tampered with, or
 * encrypted under a different key.
 */
export const decrypt = (payload: string): string => {
  const raw = Buffer.from(payload, "base64")

  // An empty plaintext still carries an IV and an auth tag, so anything
  // shorter than the two of them combined cannot have come from `encrypt`.
  if (raw.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Malformed ciphertext: payload is too short")
  }

  const iv = raw.subarray(0, IV_LENGTH)
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  // `final` is what verifies the auth tag, so it throws on tampering.
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8")
}
