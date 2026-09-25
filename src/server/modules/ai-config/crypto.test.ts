import { describe, expect, it } from "vitest";
import { decryptApiKey, encryptApiKey } from "./crypto";

const key = Buffer.alloc(32, 7).toString("base64");

describe("AI credential encryption", () => {
  it("round-trips with randomized ciphertext bound to the User", () => {
    const first = encryptApiKey("secret", "user-1", key);
    const second = encryptApiKey("secret", "user-1", key);
    expect(first).not.toBe(second);
    expect(first).not.toContain("secret");
    expect(decryptApiKey(first, "user-1", key)).toBe("secret");
    expect(() => decryptApiKey(first, "user-2", key)).toThrow();
  });

  it("rejects tampering and invalid encryption keys", () => {
    const encrypted = encryptApiKey("secret", "user-1", key);
    const parts = encrypted.split(".");
    parts[2] = `${parts[2]![0] === "A" ? "B" : "A"}${parts[2]!.slice(1)}`;
    expect(() => decryptApiKey(parts.join("."), "user-1", key)).toThrow();
    expect(() => encryptApiKey("secret", "user-1", Buffer.alloc(16).toString("base64"))).toThrow(
      "AI_CREDENTIALS_ENCRYPTION_KEY",
    );
  });
});
