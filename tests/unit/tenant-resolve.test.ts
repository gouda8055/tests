import { describe, expect, it } from "vitest";

import { extractSubdomain } from "@/lib/tenant/host";
import {
  isValidSubdomainFormat,
  RESERVED_SUBDOMAINS,
} from "@/lib/tenant/reserved-subdomains";

const APP_DOMAIN = "yourapp.com";

describe("extractSubdomain", () => {
  it("returns null for the base domain itself (no tenant)", () => {
    expect(extractSubdomain("yourapp.com", APP_DOMAIN)).toBeNull();
    expect(extractSubdomain("yourapp.com:3000", APP_DOMAIN)).toBeNull();
  });

  it("returns the single-label subdomain for a tenant host", () => {
    expect(extractSubdomain("acme.yourapp.com", APP_DOMAIN)).toBe("acme");
    expect(extractSubdomain("acme.yourapp.com:3000", APP_DOMAIN)).toBe("acme");
  });

  it("returns null for a host under a different domain entirely", () => {
    expect(extractSubdomain("acme.otherapp.com", APP_DOMAIN)).toBeNull();
    expect(extractSubdomain("evil.com", APP_DOMAIN)).toBeNull();
  });

  it("returns empty string for a multi-label prefix rather than guessing", () => {
    expect(extractSubdomain("a.b.yourapp.com", APP_DOMAIN)).toBe("");
  });

  it("is case-insensitive", () => {
    expect(extractSubdomain("ACME.YourApp.com", APP_DOMAIN)).toBe("acme");
  });
});

describe("isValidSubdomainFormat", () => {
  it("accepts lowercase letters, digits, and single internal hyphens", () => {
    expect(isValidSubdomainFormat("acme")).toBe(true);
    expect(isValidSubdomainFormat("acme-coaching-123")).toBe(true);
  });

  it("rejects uppercase, leading/trailing hyphens, and empty strings", () => {
    expect(isValidSubdomainFormat("Acme")).toBe(false);
    expect(isValidSubdomainFormat("-acme")).toBe(false);
    expect(isValidSubdomainFormat("acme-")).toBe(false);
    expect(isValidSubdomainFormat("")).toBe(false);
    expect(isValidSubdomainFormat("acme_coaching")).toBe(false);
  });
});

describe("RESERVED_SUBDOMAINS", () => {
  it("matches the reserved list required by SECURITY.md §8", () => {
    for (const name of [
      "admin",
      "api",
      "www",
      "app",
      "login",
      "auth",
      "support",
      "mail",
      "static",
      "billing",
      "security",
    ]) {
      expect(RESERVED_SUBDOMAINS.has(name)).toBe(true);
    }
  });
});
