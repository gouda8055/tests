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
  // Stage 9 (production readiness, SECURITY.md §11): a baseline security
  // header set. Deliberately no CSP here — Razorpay's Checkout.js is
  // loaded from their CDN at runtime (checkout-button.tsx), and getting a
  // CSP right for that (plus any other third-party script origin) needs
  // its own dedicated pass rather than shipping one that's either broken
  // or too loose to mean anything.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Nothing in this app embeds itself (or is embedded) in an
          // iframe anywhere.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
