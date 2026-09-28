import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./return-path";

describe("safeReturnPath", () => {
  it.each(["/settings", "/projects/abc?tab=tasks#t-1", "/dashboard"])("keeps same-origin path %s", (path) => {
    expect(safeReturnPath(path)).toBe(path);
  });

  it.each([
    null,
    "",
    "settings",
    "//evil.com",
    "/\\evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "\\/evil.com",
    "https://evil.com/",
    "javascript:alert(1)",
  ])("falls back to the dashboard for %j", (next) => {
    expect(safeReturnPath(next)).toBe("/dashboard");
  });
});
