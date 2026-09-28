import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Analytics E2E runs with a fake key in a separate process from the normal dev server.
  distDir: process.env.ANALYTICS_E2E ? ".next/analytics" : ".next",
  devIndicators: process.env.ANALYTICS_E2E ? false : undefined,
  experimental: {
    serverActions: {
      /** Evidence uploads are capped at MAX_EVIDENCE_BYTES (15 MB) plus form overhead. */
      bodySizeLimit: "16mb",
    },
    /** Same ceiling for the proxy layer (default 10 MB), which truncates the body before the action sees it. */
    proxyClientMaxBodySize: "16mb",
  },
  /** faiss-node is a native addon; it must be required, not bundled. */
  serverExternalPackages: ["faiss-node"],
  /**
   * The sample Project's renders are read from disk at signup, so the images have to travel
   * with the server bundle; file tracing cannot see a path built at runtime.
   */
  outputFileTracingIncludes: {
    "/api/auth/[...all]": ["./public/samples/renders/**"],
  },
};

export default nextConfig;
