import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ValidationError } from "@/server/core/errors";

type Resolve = (hostname: string) => Promise<string[]>;
const resolve: Resolve = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((x) => x.address);

function blocked(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  if (normalized.includes(":"))
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("100:") ||
      normalized.startsWith("2001:db8")
    );
  const [a, b, c] = normalized.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a! >= 224 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

export async function normalizePublicHttpsUrl(value: string, resolveHost: Resolve = resolve): Promise<string> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ValidationError("Enter a valid public HTTPS base URL", { baseUrl: ["Enter a valid URL"] });
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new ValidationError("The base URL must be public HTTPS without credentials, a query, or fragment", {
      baseUrl: ["Use a public HTTPS URL"],
    });
  if (url.hostname === "localhost" || url.hostname.endsWith(".localhost") || isIP(url.hostname))
    throw new ValidationError("The base URL must use a public hostname", {
      baseUrl: ["IP addresses and localhost are not allowed"],
    });
  let addresses: string[];
  try {
    addresses = await resolveHost(url.hostname);
  } catch {
    throw new ValidationError("The base URL hostname could not be resolved", {
      baseUrl: ["Hostname could not be resolved"],
    });
  }
  if (!addresses.length || addresses.some(blocked))
    throw new ValidationError("The base URL must resolve only to public addresses", {
      baseUrl: ["Private and reserved networks are not allowed"],
    });
  return url.toString().replace(/\/$/, "");
}

export function guardedFetch(
  resolveHost: Resolve = resolve,
  fetchImpl: typeof fetch = fetch,
  allowedOrigin?: string,
): typeof fetch {
  return async (input, init) => {
    const raw = input instanceof Request ? input.url : String(input);
    if (allowedOrigin && new URL(raw).origin !== allowedOrigin)
      throw new Error("Provider request origin is not allowed");
    await normalizePublicHttpsUrl(raw, resolveHost);
    const response = await fetchImpl(input, { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) throw new Error("Provider redirects are not allowed");
    return response;
  };
}
