"use client";

import posthog from "posthog-js";
import { isCredentialPath, redactAnalyticsProperties } from "./redact";
import { SESSION_HEADER, USER_HEADER } from "./session-context";

let started = false;
let failed = false;
let userId: string | null | undefined;
let lastPage: string | undefined;
// Better Auth may briefly retain its old hook value while refetching after a successful transition.
let expectedIdentity: string | null | undefined;

function excluded() {
  return isCredentialPath(window.location.pathname) || window.location.pathname.startsWith("/m/");
}

function usable() {
  return started && !failed && userId !== undefined && !excluded();
}

/** Analytics failures must never prevent authentication, navigation or a domain write. */
function safely(work: () => void) {
  try {
    work();
  } catch {
    failed = true;
    userId = undefined;
  }
}

function installSessionTransport() {
  const originalFetch = window.fetch;
  window.fetch = (input, init) => {
    let options = init;
    try {
      const request = input instanceof Request ? input : undefined;
      const url = new URL(request?.url ?? String(input), window.location.href);
      const headers = new Headers(init?.headers ?? request?.headers);
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      if (
        usable() &&
        userId &&
        url.origin === window.location.origin &&
        method === "POST" &&
        (headers.has("Next-Action") || url.pathname === "/api/assistant/chat") &&
        !isCredentialPath(url.pathname) &&
        !url.pathname.startsWith("/m/") &&
        posthog.get_distinct_id() === userId
      ) {
        // Unlike get_session_id(), this treats the mutation as activity and rotates an idle session.
        const session = posthog.sessionManager?.checkAndGetSessionAndWindowId();
        if (session) {
          headers.set(SESSION_HEADER, session.sessionId);
          headers.set(USER_HEADER, userId);
          // Inherit RequestInit so bodies, abort signals, credentials and non-enumerable options survive.
          options = Object.create(init ?? null);
          Object.defineProperty(options, "headers", { value: headers, enumerable: true });
        }
      }
    } catch {
      options = init;
    }
    // Dispatch exactly once, outside the fallback catch: never retry a rejected mutation.
    return originalFetch.call(window, input, options);
  };
}

function start() {
  if (started || failed || excluded()) return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    advanced_disable_flags: true,
    capture_pageview: false,
    capture_pageleave: false,
    autocapture: false,
    disable_session_recording: true,
    capture_heatmaps: false,
    capture_performance: false,
    // Explicit workflow events only. In particular, replay bypasses property sanitization.
    before_send: (event) => {
      if (!usable() || !event) return null;
      // A sibling tab can change SDK persistence before Better Auth's hook catches up.
      if (userId ? event.properties.distinct_id !== userId : event.properties.$is_identified) return null;
      // Apply to the full envelope: $set_once can hold the original referrer inside a nested object.
      for (const key of ["properties", "$set", "$set_once"] as const) {
        if (event[key]) event[key] = redactAnalyticsProperties(event[key]) as typeof event.properties;
      }
      return event;
    },
  });
  started = true;
  installSessionTransport();
}

/** undefined means auth is pending/unavailable; null means confirmed anonymous. */
export function syncAnalyticsIdentity(nextUserId: string | null | undefined) {
  safely(() => {
    userId = undefined;
    if (nextUserId === undefined || excluded()) return;
    if (expectedIdentity !== undefined && nextUserId !== expectedIdentity) return;
    expectedIdentity = undefined;
    start();
    if (!started || failed) return;
    const previous = posthog.get_property("$user_id");
    if (previous && previous !== nextUserId) posthog.reset(true);
    userId = nextUserId;
    if (nextUserId && posthog.get_distinct_id() !== nextUserId) posthog.identify(nextUserId);
  });
}

export function capturePageview(url: string) {
  safely(() => {
    if (!usable() || lastPage === url) return;
    // Redaction is central in `before_send`, which drops the query and hash of every captured
    // address. The full address stays the dedupe key, so a query-only navigation still counts.
    posthog.capture("$pageview", { $current_url: url });
    lastPage = url;
  });
}

export function authenticationCompleted(id: string, signup: boolean) {
  expectedIdentity = undefined;
  syncAnalyticsIdentity(id);
  expectedIdentity = id;
  safely(() => {
    if (usable()) posthog.capture(signup ? "signup_completed" : "login_completed");
  });
}

/** A named workflow event from the browser. Properties must be ids or bounded metadata, never content. */
export function captureEvent(event: string, properties?: Record<string, unknown>) {
  safely(() => {
    if (usable()) posthog.capture(event, properties);
  });
}

export function resetAnalyticsIdentity() {
  expectedIdentity = null;
  userId = undefined;
  lastPage = undefined;
  safely(() => {
    if (started) posthog.reset(true);
  });
}
