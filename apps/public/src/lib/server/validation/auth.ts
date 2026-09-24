// Plain Zod (not drizzle-zod) — none of these have a 1:1 shape with a table row
// (`password` here, `passwordHash` in `members`).
import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

// The floor, not the policy. Length is the only rule that reliably helps; composition rules push
// people towards predictable substitutions, and NIST dropped them years ago. The upper bound is
// there because PBKDF2 hashes the whole input and a megabyte-long password is a cheap way to burn
// CPU (DEV-01 §2).
const password = z.string().min(12, "パスワードは 12 文字以上で設定してください。").max(256);

export const activateSchema = z.object({
  token: z.string().min(1).max(512),
  password,
});

export const forgotPasswordSchema = z.object({
  email: z.email().max(255),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1).max(512),
  password,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ActivateInput = z.infer<typeof activateSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
