/**
 * A one-shot marker that this tab started a Google sign-in. `/auth/complete` is an ordinary URL
 * anyone can open, so it records analytics and starts the tour only when the marker is there -
 * a pasted or repeated link, or a password login redirected through it, does neither.
 * `sessionStorage` is per tab and survives the round trip through Google.
 */
const KEY = "prismpm.oauth-pending";

export function markOAuthPending() {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {}
}

export function clearOAuthPending() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
}

/** True once per marked sign-in, then cleared. False when storage is unavailable. */
export function takeOAuthPending() {
  try {
    const pending = sessionStorage.getItem(KEY) === "1";
    sessionStorage.removeItem(KEY);
    return pending;
  } catch {
    return false;
  }
}
