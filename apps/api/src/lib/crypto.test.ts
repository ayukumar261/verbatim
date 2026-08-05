import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { decrypt, encrypt } from "./crypto.js"

/** Shaped like a real GitHub access token, so the lengths are realistic. */
const TOKEN = "gho_16C7e42F292c6912E7710c838347Ae178B4a"

/** Flips every bit of one byte, at `index` counted from the end. */
const corrupt = (payload: string, fromEnd: number): string => {
  const raw = Buffer.from(payload, "base64")
  const index = raw.length - fromEnd

  raw.writeUInt8(raw.readUInt8(index) ^ 0xff, index)

  return raw.toString("base64")
}

describe("encrypt / decrypt", () => {
  it("round-trips a token", () => {
    assert.equal(decrypt(encrypt(TOKEN)), TOKEN)
  })

  it("round-trips an empty string", () => {
    assert.equal(decrypt(encrypt("")), "")
  })

  it("round-trips multi-byte characters", () => {
    const value = "héllo 🌍 — naïve"

    assert.equal(decrypt(encrypt(value)), value)
  })

  it("does not leak the plaintext into the ciphertext", () => {
    assert.ok(!encrypt(TOKEN).includes(TOKEN))
  })

  it("produces different ciphertext each time, because the IV is random", () => {
    assert.notEqual(encrypt(TOKEN), encrypt(TOKEN))
  })

  it("still decrypts both of those to the same plaintext", () => {
    assert.equal(decrypt(encrypt(TOKEN)), decrypt(encrypt(TOKEN)))
  })
})

describe("decrypt rejects bad input", () => {
  it("throws on a tampered ciphertext", () => {
    assert.throws(() => decrypt(corrupt(encrypt(TOKEN), 1)))
  })

  it("throws on a tampered auth tag", () => {
    // The ciphertext is as long as the plaintext, so stepping one byte past it
    // from the end lands on the last byte of the tag.
    assert.throws(() => decrypt(corrupt(encrypt(TOKEN), TOKEN.length + 1)))
  })

  it("throws on a tampered IV", () => {
    // Another 16 bytes back clears the tag and lands inside the IV.
    assert.throws(() => decrypt(corrupt(encrypt(TOKEN), TOKEN.length + 20)))
  })

  it("throws on a truncated payload", () => {
    const encrypted = encrypt(TOKEN)
    const truncated = Buffer.from(encrypted, "base64")
      .subarray(0, 20)
      .toString("base64")

    assert.throws(() => decrypt(truncated), /too short/)
  })

  it("throws on an empty payload", () => {
    assert.throws(() => decrypt(""), /too short/)
  })

  it("throws on a value that was never encrypted", () => {
    assert.throws(() => decrypt("this is not a ciphertext at all, promise"))
  })
})
