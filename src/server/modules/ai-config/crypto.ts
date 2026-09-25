import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

function encryptionKey(value = process.env.AI_CREDENTIALS_ENCRYPTION_KEY): Buffer {
  if (!value) throw new Error("AI_CREDENTIALS_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value)
    throw new Error("AI_CREDENTIALS_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return key;
}

export function encryptApiKey(plaintext: string, userId: string, configuredKey?: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(configuredKey), nonce);
  cipher.setAAD(Buffer.from(`${VERSION}:${userId}`));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    VERSION,
    nonce.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

export function decryptApiKey(value: string, userId: string, configuredKey?: string): string {
  const [version, nonce, ciphertext, tag, extra] = value.split(".");
  if (version !== VERSION || !nonce || !ciphertext || !tag || extra) throw new Error("Unsupported credential format");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(configuredKey), Buffer.from(nonce, "base64url"));
  decipher.setAAD(Buffer.from(`${VERSION}:${userId}`));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
