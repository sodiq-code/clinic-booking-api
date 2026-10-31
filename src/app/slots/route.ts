import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { isAuthorized, UNAUTHORIZED_BODY } from "@/lib/auth";
import { json } from "@/lib/http";
import { slotWithAvailability } from "@/lib/slots";

// GET /slots — Level 1 — List slots (with availability).
// Optional query param: provider (string) — case-insensitive substring filter
// on the provider name (e.g. "bello" matches "Dr. Bello"). Filtered in app code
// so the behaviour is identical on SQLite (local) and Postgres (production),
// since Prisma's `mode: "insensitive"` is Postgres-only.
// Returns 200: { "slots": [SlotWithAvailability, ...] } ordered earliest start first.
// `available` is false while the slot has a confirmed booking claim; true otherwise.
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return json(UNAUTHORIZED_BODY, 401);
  }

  const provider = req.nextUrl.searchParams.get("provider")?.trim() ?? "";

  const all = await db.slot.findMany({ orderBy: { start: "asc" } });
  const filtered = provider
    ? all.filter((s) =>
        s.provider.toLowerCase().includes(provider.toLowerCase()),
      )
    : all;

  return json({ slots: filtered.map(slotWithAvailability) }, 200);
}
