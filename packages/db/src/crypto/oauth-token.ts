import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_HEX_LENGTH = 64;

function keyBufferFromHex(keyHex: string): Buffer {
  if (!/^[0-9a-fA-F]+$/.test(keyHex) || keyHex.length !== KEY_HEX_LENGTH) {
    throw new Error(
      `OAUTH_ENCRYPTION_KEY must be ${KEY_HEX_LENGTH} hexadecimal characters (32 bytes)`
    );
  }
  return Buffer.from(keyHex, "hex");
}

function hex(buf: Buffer): string {
  return buf.toString("hex");
}

function fromHex(s: string): Buffer {
  return Buffer.from(s, "hex");
}

/**
 * Encrypts a UTF-8 string. Stored format: iv:authTag:ciphertext (each segment hex).
 */
export function encryptOAuthToken(plain: string, keyHex: string): string {
  const key = keyBufferFromHex(keyHex);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${hex(iv)}:${hex(tag)}:${hex(enc)}`;
}

/**
 * Decrypts a blob produced by encryptOAuthToken.
 */
export function decryptOAuthToken(blob: string, keyHex: string): string {
  const key = keyBufferFromHex(keyHex);
  const parts = blob.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted token format");
  }
  const [ivHex, tagHex, ctHex] = parts;
  const iv = fromHex(ivHex);
  const tag = fromHex(tagHex);
  const ciphertext = fromHex(ctHex);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8"
  );
}
