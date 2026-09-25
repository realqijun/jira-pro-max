import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  reset: vi.fn(),
  identify: vi.fn(),
  capture: vi.fn(),
  get_property: vi.fn(),
  get_distinct_id: vi.fn(),
  sessionManager: { checkAndGetSessionAndWindowId: vi.fn() },
}));
vi.mock("posthog-js", () => ({ default: sdk }));
const fetch = vi.fn();
const location = new URL("https://app.example.com/dashboard");
const sid = "0195351c-67a7-7b00-8410-85317b184742";

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
  vi.stubGlobal("window", { location, fetch });
  sdk.get_distinct_id.mockReturnValue("user-a");
  sdk.sessionManager.checkAndGetSessionAndWindowId.mockReturnValue({ sessionId: sid });
  fetch.mockResolvedValue(new Response());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("browser identity boundary", () => {
  it("does not initialize during pending auth or on credential/Participant routes", async () => {
    const analytics = await import("./browser");
    analytics.syncAnalyticsIdentity(undefined);
    for (const pathname of ["/invite/secret", "/m/project/login"]) {
      vi.stubGlobal("window", { location: new URL(pathname, location), fetch });
      analytics.syncAnalyticsIdentity("user-a");
    }
    expect(sdk.init).not.toHaveBeenCalled();
  });

  it("resets a previous identified User before identifying the next one", async () => {
    sdk.get_property.mockReturnValue("user-a");
    sdk.get_distinct_id.mockReturnValue("user-a");
    const analytics = await import("./browser");
    analytics.authenticationCompleted("user-b", true);
    expect(sdk.reset).toHaveBeenCalledWith(true);
    expect(sdk.identify).toHaveBeenCalledWith("user-b");
    expect(sdk.reset.mock.invocationCallOrder[0]).toBeLessThan(sdk.identify.mock.invocationCallOrder[0]);
    expect(sdk.identify.mock.invocationCallOrder[0]).toBeLessThan(sdk.capture.mock.invocationCallOrder[0]);
    expect(sdk.capture).toHaveBeenCalledExactlyOnceWith("signup_completed");
  });

  it("resets persisted identified state when auth resolves anonymous", async () => {
    sdk.get_property.mockReturnValue("user-a");
    const analytics = await import("./browser");
    analytics.syncAnalyticsIdentity(null);
    expect(sdk.reset).toHaveBeenCalledWith(true);
    expect(sdk.identify).not.toHaveBeenCalled();
  });

  it("ignores stale auth hook values after successful logout and login", async () => {
    const analytics = await import("./browser");
    analytics.syncAnalyticsIdentity("user-a");
    analytics.resetAnalyticsIdentity();
    analytics.syncAnalyticsIdentity("user-a");
    analytics.capturePageview("/login");
    expect(sdk.capture).not.toHaveBeenCalled();
    analytics.syncAnalyticsIdentity(null);
    analytics.capturePageview("/login");
    expect(sdk.capture).toHaveBeenCalledExactlyOnceWith("$pageview", { $current_url: "/login" });
    sdk.capture.mockClear();
    analytics.authenticationCompleted("user-b", false);
    expect(sdk.capture).toHaveBeenCalledExactlyOnceWith("login_completed");
    sdk.capture.mockClear();
    analytics.syncAnalyticsIdentity(null);
    analytics.capturePageview("/dashboard");
    expect(sdk.capture).not.toHaveBeenCalled();
    analytics.syncAnalyticsIdentity("user-b");
    analytics.capturePageview("/dashboard");
    expect(sdk.capture).toHaveBeenCalledOnce();
  });

  it("emits login, not signup, on returning sign-in and deduplicates effect pageviews", async () => {
    const analytics = await import("./browser");
    analytics.authenticationCompleted("user-a", false);
    expect(sdk.capture).toHaveBeenCalledExactlyOnceWith("login_completed");
    sdk.capture.mockClear();
    analytics.capturePageview("/dashboard");
    analytics.syncAnalyticsIdentity("user-a");
    analytics.capturePageview("/dashboard");
    expect(sdk.capture).toHaveBeenCalledExactlyOnceWith("$pageview", { $current_url: "/dashboard" });
  });

  it("counts a query-only navigation but sends no query to PostHog", async () => {
    const analytics = await import("./browser");
    analytics.syncAnalyticsIdentity("user-a");
    analytics.capturePageview("/projects?tab=open");
    analytics.capturePageview("/projects?tab=done");
    expect(sdk.capture).toHaveBeenCalledTimes(2);
    const { before_send } = sdk.init.mock.calls[0][1];
    const properties = { ...sdk.capture.mock.calls[0][1], distinct_id: "user-a" };
    expect(before_send({ event: "$pageview", properties }).properties).toEqual({
      $current_url: "/projects",
      distinct_id: "user-a",
    });
  });

  it("suppresses captures immediately after credential navigation and during pending auth", async () => {
    const analytics = await import("./browser");
    analytics.syncAnalyticsIdentity("user-a");
    const options = sdk.init.mock.calls[0][1];
    expect(options.disable_session_recording).toBe(true);
    expect(options.autocapture).toBe(false);
    vi.stubGlobal("window", { location: new URL("/invite/secret", location), fetch });
    expect(options.before_send({ event: "$snapshot" })).toBeNull();
    vi.stubGlobal("window", { location, fetch });
    analytics.syncAnalyticsIdentity(undefined);
    expect(options.before_send({ event: "$pageview" })).toBeNull();
  });

  it.each(["init", "identify", "capture", "reset", "get_property"])("isolates %s/storage failures", async (method) => {
    sdk.get_distinct_id.mockReturnValue("anonymous");
    sdk[method as "init" | "identify" | "capture" | "reset" | "get_property"].mockImplementation(() => {
      throw new Error("unavailable");
    });
    const analytics = await import("./browser");
    expect(() => analytics.authenticationCompleted("user-a", true)).not.toThrow();
    expect(() => analytics.resetAnalyticsIdentity()).not.toThrow();
    expect(() => analytics.capturePageview("/dashboard")).not.toThrow();
  });

  it("does nothing without configuration", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    const analytics = await import("./browser");
    analytics.authenticationCompleted("user-a", true);
    analytics.capturePageview("/dashboard");
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.capture).not.toHaveBeenCalled();
  });
});

describe("browser mutation session transport", () => {
  it("adds current session to Server Actions while preserving body, signal, headers and credentials", async () => {
    const analytics = await import("./browser");
    analytics.syncAnalyticsIdentity("user-a");
    const controller = new AbortController();
    const options = {
      method: "POST",
      headers: { "Next-Action": "action-id" },
      body: "payload",
      signal: controller.signal,
      credentials: "same-origin" as const,
    };
    await window.fetch("/dashboard", options);
    const [url, init] = fetch.mock.calls[0];
    const request = new Request(new URL(url, location), init);
    expect(await request.text()).toBe("payload");
    expect(init.signal).toBe(controller.signal);
    expect(request.credentials).toBe("same-origin");
    expect(request.headers.get("Next-Action")).toBe("action-id");
    expect(request.headers.get("X-PostHog-Session-Id")).toBe(sid);
    expect(request.headers.get("X-PostHog-Distinct-Id")).toBe("user-a");
    expect(sdk.sessionManager.checkAndGetSessionAndWindowId).toHaveBeenCalledWith();
  });

  it("handles the Assistant Request form without consuming its body", async () => {
    const analytics = await import("./browser");
    analytics.syncAnalyticsIdentity("user-a");
    const input = new Request("https://app.example.com/api/assistant/chat", {
      method: "POST",
      body: "assistant payload",
    });
    await window.fetch(input);
    expect(input.bodyUsed).toBe(false);
    const forwarded = new Request(fetch.mock.calls[0][0], fetch.mock.calls[0][1]);
    expect(await forwarded.text()).toBe("assistant payload");
    expect(forwarded.headers.get("X-PostHog-Session-Id")).toBe(sid);
  });

  it("adds no context to cross-origin, credential, auth or anonymous requests", async () => {
    const analytics = await import("./browser");
    analytics.syncAnalyticsIdentity("user-a");
    const options = { method: "POST", headers: { "Next-Action": "action-id" } };
    for (const path of ["https://other.example.com/", "/invite/secret", "/m/project/login"])
      await window.fetch(path, options);
    await window.fetch("/api/auth/sign-in/email", { method: "POST" });
    analytics.resetAnalyticsIdentity();
    await window.fetch("/dashboard", options);
    for (const [, init] of fetch.mock.calls) expect(new Headers(init.headers).has("X-PostHog-Session-Id")).toBe(false);
  });

  it("falls back unchanged on session failures and never retries a rejected mutation", async () => {
    const analytics = await import("./browser");
    analytics.syncAnalyticsIdentity("user-a");
    sdk.sessionManager.checkAndGetSessionAndWindowId.mockImplementation(() => {
      throw new Error("storage failure");
    });
    const options = { method: "POST", headers: { "Next-Action": "action-id" }, body: "payload" };
    fetch.mockRejectedValue(new Error("offline"));
    await expect(window.fetch("/dashboard", options)).rejects.toThrow("offline");
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/dashboard", options);
  });
});
