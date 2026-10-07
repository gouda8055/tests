import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
