import { z } from "zod";

export const createInstituteSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  subdomain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      "Lowercase letters, digits and single hyphens only.",
    ),
  logoUrl: z
    .string()
    .trim()
    .url("Enter a valid URL.")
    .max(2048)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value === "" ? undefined : value)),
  primaryColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Enter a hex color, e.g. #1a73e8.")
    .optional()
    .or(z.literal(""))
    .transform((value) => (value === "" ? undefined : value)),
});

export const assignOwnerSchema = z.object({
  instituteId: z.string().uuid("Choose an institute."),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  fullName: z.string().trim().min(1, "Full name is required.").max(200),
});

export const setInstituteStatusSchema = z.object({
  instituteId: z.string().uuid(),
  status: z.enum(["active", "suspended"]),
});
