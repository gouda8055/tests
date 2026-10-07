import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { getCurrentTenant } from "@/lib/tenant/current";
import { TenantHeader } from "@/components/tenant/tenant-header";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LMS & Exam Platform",
  description: "Multi-tenant learning and exam platform",
};

// This app is session- and tenant-driven on nearly every route (auth,
// role-scoped dashboards) — there's no meaningful static shell to
// prerender for Stage 1, so we opt out of Cache Components' static-shell
// validation at the root rather than add Suspense/`use cache: private`
// boundaries for a performance optimization that isn't in scope yet. See
// https://nextjs.org/docs/app/guides/authentication-with-cache-components
// for the streaming pattern to adopt later, one route at a time.
export const instant = false;

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const tenant = await getCurrentTenant();

  // Overrides the --tenant-primary token defined in globals.css (which
  // --color-primary reads from), so an institute's brand color flows
  // through every shadcn/ui component that uses `primary` without each
  // one needing to know about tenancy. React's style prop sets this via
  // the DOM style API, not string interpolation into markup, so this is
  // not an injection vector even before the hex-format validation at
  // write time (src/lib/validation/platform.ts).
  const themeStyle = tenant?.primaryColor
    ? ({ "--tenant-primary": tenant.primaryColor } as CSSProperties)
    : undefined;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      style={themeStyle}
    >
      <body className="flex min-h-full flex-col">
        {tenant ? <TenantHeader tenant={tenant} /> : null}
        {children}
      </body>
    </html>
  );
}
