import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Local dev resolves tenants from *.localtest.me subdomains (README's
  // Getting Started) — without this, cross-origin HMR requests from those
  // subdomains are blocked, which can prevent client-side hydration and
  // make forms fall back to a raw, non-hydrated POST.
  allowedDevOrigins: ["localtest.me", "*.localtest.me"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
