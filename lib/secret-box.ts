import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * Symmetric encryption for secrets that must be stored but later USED, not just
 * compared — a third-party portal password we have to replay on login, unlike a
 * user password (which would be hashed one-way and never recovered).
 *
 * AES-256-GCM: the tag authenticates the ciphertext, so a row tampered with in
 * the database fails to decrypt rather than silently returning garbage. The key
 * is HOTEL_EYE_ENC_KEY — 32 bytes as 64 hex chars — held only in the server
 * environment. Losing it makes every stored password unreadable; leaking it
 * makes them all readable, so it is treated exactly like SUPABASE_SERVICE_ROLE_KEY.
 *
 * Format: base64(iv).base64(tag).base64(ciphertext). The iv is random per
 * encryption, so the same password stored twice yields two different rows.
 */

function key(): Buffer {
  const hex = process.env.HOTEL_EYE_ENC_KEY ?? "";
  if (hex.length !== 64) {
    // Fail loud rather than fall back to a weak or empty key: a silent default
    // would encrypt every hostel's password under a guessable value.
    throw new Error(
      "HOTEL_EYE_ENC_KEY is missing or not 32 bytes (64 hex chars). Set it in the server environment before using the HotelEye integration."
    );
  }
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12); // 96-bit nonce, the GCM standard
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  const [ivB64, tagB64, dataB64] = stored.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Stored secret is malformed.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
