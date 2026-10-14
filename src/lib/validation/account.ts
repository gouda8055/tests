import { z } from "zod";

import { passwordSchema } from "@/lib/validation/auth";

export const updateFullNameSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required.").max(200),
});

export const changePasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords don't match.",
    path: ["confirmPassword"],
  });
