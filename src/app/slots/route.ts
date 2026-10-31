import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { isAuthorized, UNAUTHORIZED_BODY } from "@/lib/auth";
import { json } from "@/lib/http";
import { slotWithAvailability } from "@/lib/slots";

// GET /slots — Level 1 — List slots (with availability).
// Optional query param: provider (string) — filter by provider.
// Returns 200: { "slots": [SlotWithAvailability, ...] } ordered earliest start first.
// `available` is false while the slot has a confirmed booking claim; true otherwise.
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return json(UNAUTHORIZED_BODY, 401);
  }

  const provider = req.nextUrl.searchParams.get("provider");

  const slots = await db.slot.findMany({
    where: provider ? { provider } : undefined,
    orderBy: { start: "asc" },
  });

  return json({ slots: slots.map(slotWithAvailability) }, 200);
}
