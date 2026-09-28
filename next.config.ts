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
   * Files the trace cannot discover by following imports, so they have to be named.
   *
   * The sample Project's renders are read from disk at signup, from a path built at runtime.
   *
   * faiss-node loads its addon through `bindings`, which tries a list of candidate paths at
   * runtime rather than requiring the file, so the trace never sees `faiss-node.node` and the
   * deployed function fails module evaluation on first import - taking every page that reaches
   * the Assistant with it. The whole `Release` directory goes along because the Linux prebuild
   * puts OpenMP and BLAS shared objects beside the addon.
   */
  outputFileTracingIncludes: {
    "/api/auth/[...all]": ["./public/samples/renders/**"],
    "/**": ["./node_modules/faiss-node/build/Release/**/*"],
  },
};

export default nextConfig;
