const ORIGIN = "http://prismpm.invalid";

/**
 * The same-origin path to send a User to after signing in, or `/dashboard`. Resolved the way the
 * browser will resolve it, so `/\evil.com`, `/<tab>/evil.com`, `//evil.com` and absolute URLs,
 * which a prefix check lets through, all fall back instead of leaving the site.
 */
export function safeReturnPath(next: string | null) {
  if (!next?.startsWith("/")) return "/dashboard";
  try {
    const url = new URL(next, ORIGIN);
    return url.origin === ORIGIN ? `${url.pathname}${url.search}${url.hash}` : "/dashboard";
  } catch {
    return "/dashboard";
  }
}
