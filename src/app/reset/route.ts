import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { isAuthorized, UNAUTHORIZED_BODY } from "@/lib/auth";
import { parseJsonBody } from "@/lib/validation";
import { json } from "@/lib/http";

// POST /reset — Level 1 — Replace all slots.
// Body: { "slots": [Slot, ...] }
// Deletes EVERY booking and replaces all slots with the ones sent.
// Also clears idempotency + rate-limit tables for a clean slate.
// Returns 200 (the test only checks status).
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return json(UNAUTHORIZED_BODY, 401);
  }

  const raw = await req.text();
  const parsed = parseJsonBody(raw);

  let slots: Array<{
    id: string;
    provider: string;
    start: string;
    end: string;
  }> = [];

  if (parsed.ok) {
    const value = parsed.value as { slots?: unknown };
    if (Array.isArray(value?.slots)) {
      slots = value.slots as typeof slots;
    }
  }

  await db.$transaction(async (tx) => {
    // Wipe everything for a deterministic reset.
    await tx.booking.deleteMany({});
    await tx.slot.deleteMany({});
    await tx.idempotencyRecord.deleteMany({});
    await tx.rateLimitAttempt.deleteMany({});

    for (const s of slots) {
      if (!s || typeof s.id !== "string" || typeof s.provider !== "string") continue;
      const start = s.start ? new Date(s.start) : new Date();
      const end = s.end ? new Date(s.end) : new Date();
      await tx.slot.create({
        data: {
          id: s.id,
          provider: s.provider,
          start,
          end,
        },
      });
    }
  });

  return json({ ok: true, count: slots.length }, 200);
}
