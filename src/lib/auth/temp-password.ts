import "server-only";
import { randomInt } from "node:crypto";

// Excludes visually ambiguous characters (0/O, 1/l/I).
const LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const ALL = LETTERS + DIGITS;

/**
 * Generates a random temporary password that deterministically satisfies
 * our own password policy (at least one letter, one digit — see
 * src/lib/validation/auth.ts), rather than relying on a long-enough
 * random string to make that overwhelmingly likely.
 */
export function generateTemporaryPassword(length = 16): string {
  const chars = [LETTERS[randomInt(LETTERS.length)]!, DIGITS[randomInt(DIGITS.length)]!];
  for (let i = chars.length; i < length; i++) {
    chars.push(ALL[randomInt(ALL.length)]!);
  }

  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }

  return chars.join("");
}
