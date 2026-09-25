import { describe, expect, it, vi } from "vitest";
import { guardedFetch, normalizePublicHttpsUrl } from "./endpoint";

describe("OpenAI-compatible endpoint guard", () => {
  it.each([
    "http://example.com/v1",
    "https://user:pass@example.com/v1",
    "https://example.com/v1?q=1",
    "https://example.com/v1#x",
    "https://localhost/v1",
    "https://127.0.0.1/v1",
    "https://[::1]/v1",
    "https://169.254.1.1/v1",
    "https://192.0.2.1/v1",
    "https://198.51.100.1/v1",
    "https://203.0.113.1/v1",
  ])("rejects unsafe URL %s", async (value) => {
    await expect(normalizePublicHttpsUrl(value)).rejects.toThrow();
  });

  it("normalizes a public HTTPS endpoint after resolving its host", async () => {
    await expect(normalizePublicHttpsUrl("https://api.example.com/v1/", async () => ["93.184.216.34"])).resolves.toBe(
      "https://api.example.com/v1",
    );
  });

  it("rejects public names resolving to private addresses and redirects", async () => {
    await expect(normalizePublicHttpsUrl("https://api.example.com", async () => ["10.0.0.2"])).rejects.toThrow();
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: "https://other.test" } }),
    );
    const fetcher = guardedFetch(async () => ["93.184.216.34"], fetchImpl);
    await expect(fetcher("https://api.example.com/v1/chat/completions")).rejects.toThrow("redirect");
    expect(fetchImpl).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ redirect: "manual" }));

    const originFetcher = guardedFetch(async () => ["93.184.216.34"], fetchImpl, "https://api.example.com");
    await expect(originFetcher("https://other.example.com/v1/chat/completions")).rejects.toThrow("origin");
  });
});
