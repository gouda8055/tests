import { describe, expect, it } from "vitest";

import {
  sendPhoneOtpSchema,
  signInSchema,
  signUpSchema,
  verifyPhoneOtpSchema,
} from "@/lib/validation/auth";

describe("signUpSchema", () => {
  it("accepts a valid signup payload and normalizes the email", () => {
    const result = signUpSchema.safeParse({
      email: "Student@Example.com",
      password: "correctHorse1",
      fullName: "Jane Student",
      phone: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("student@example.com");
      expect(result.data.phone).toBeUndefined();
    }
  });

  it("rejects a password with no digit", () => {
    const result = signUpSchema.safeParse({
      email: "a@b.com",
      password: "onlyletters",
      fullName: "A",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a password with no letter", () => {
    const result = signUpSchema.safeParse({
      email: "a@b.com",
      password: "12345678",
      fullName: "A",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a password shorter than 8 characters", () => {
    const result = signUpSchema.safeParse({
      email: "a@b.com",
      password: "abc123",
      fullName: "A",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing full name", () => {
    const result = signUpSchema.safeParse({
      email: "a@b.com",
      password: "correctHorse1",
      fullName: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid email", () => {
    const result = signUpSchema.safeParse({
      email: "not-an-email",
      password: "correctHorse1",
      fullName: "A",
    });
    expect(result.success).toBe(false);
  });
});

describe("signInSchema", () => {
  it("accepts any non-empty password (no strength check on sign-in)", () => {
    const result = signInSchema.safeParse({ email: "a@b.com", password: "x" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty password", () => {
    const result = signInSchema.safeParse({ email: "a@b.com", password: "" });
    expect(result.success).toBe(false);
  });
});

describe("sendPhoneOtpSchema / verifyPhoneOtpSchema", () => {
  it("accepts E.164-format phone numbers", () => {
    expect(sendPhoneOtpSchema.safeParse({ phone: "+919876543210" }).success).toBe(true);
  });

  it("rejects a phone number without a country code", () => {
    expect(sendPhoneOtpSchema.safeParse({ phone: "9876543210" }).success).toBe(false);
  });

  it("rejects a non-numeric OTP token", () => {
    const result = verifyPhoneOtpSchema.safeParse({
      phone: "+919876543210",
      token: "abcdef",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a numeric OTP token", () => {
    const result = verifyPhoneOtpSchema.safeParse({
      phone: "+919876543210",
      token: "123456",
    });
    expect(result.success).toBe(true);
  });
});
