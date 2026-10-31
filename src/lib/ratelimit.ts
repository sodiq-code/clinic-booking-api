import { db } from "./db";

// Level 5: at most MAX_ATTEMPTS booking attempts per email per rolling WINDOW_MS.
// "Failed attempts included" — the attempt row is inserted BEFORE validation,
// so 400/404/409 responses count against the quota.
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;

export interface RateLimitResult {
  limited: boolean;
  /** Whole seconds until the oldest attempt ages out (only set when limited). */
  retryAfter: number | null;
}

/**
 * Check the per-email attempt quota and record this attempt atomically.
 * Call this BEFORE any other request processing (after auth).
 *
 * - Deletes aged rows (housekeeping).
 * - If >= MAX_ATTEMPTS rows exist in the window for this email -> limited,
 *   with Retry-After = whole seconds until the oldest attempt expires.
 * - Otherwise inserts an attempt row and returns { limited: false }.
 */
export async function checkAndRecord(email: string): Promise<RateLimitResult> {
  const normalized = (email ?? "").toString().toLowerCase();
  const now = Date.now();
  const windowStart = new Date(now - WINDOW_MS);

  return db.$transaction(async (tx) => {
    // Drop aged rows for this email.
    await tx.rateLimitAttempt.deleteMany({
      where: { email: normalized, createdAt: { lt: windowStart } },
    });

    // Rows still inside the window (oldest first).
    const inWindow = await tx.rateLimitAttempt.findMany({
      where: { email: normalized, createdAt: { gte: windowStart } },
      orderBy: { createdAt: "asc" },
      take: MAX_ATTEMPTS,
    });

    if (inWindow.length >= MAX_ATTEMPTS) {
      const oldest = inWindow[0].createdAt;
      const msRemaining = oldest.getTime() + WINDOW_MS - Date.now();
      const retryAfter = Math.max(1, Math.ceil(msRemaining / 1000));
      return { limited: true, retryAfter };
    }

    // Not yet over the limit — record this attempt.
    await tx.rateLimitAttempt.create({ data: { email: normalized } });
    return { limited: false, retryAfter: null };
  });
}
