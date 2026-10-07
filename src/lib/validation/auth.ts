import { z } from "zod";

// Length over complexity rules (NIST-aligned): require a minimum length
// plus a mix of letters and digits, but not mandatory special characters.
// SECURITY.md §3: "Require strong passwords." Supabase Auth's own default
// minimum is 6 — this is deliberately stronger.
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(72, "Password must be at most 72 characters.")
  .regex(/[a-zA-Z]/, "Password must include at least one letter.")
  .regex(/[0-9]/, "Password must include at least one number.");

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address.")
  .max(254);

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: z.string().trim().min(1, "Full name is required.").max(200),
  phone: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((value) => (value === "" ? undefined : value)),
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required.").max(72),
});

const phoneSchema = z
  .string()
  .trim()
  .regex(
    /^\+[1-9]\d{6,14}$/,
    "Enter the phone number in international format, e.g. +919876543210.",
  );

export const sendPhoneOtpSchema = z.object({
  phone: phoneSchema,
});

export const verifyPhoneOtpSchema = z.object({
  phone: phoneSchema,
  token: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, "Enter the code you received."),
});
