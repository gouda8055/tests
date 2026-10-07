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
