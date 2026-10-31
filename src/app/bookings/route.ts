import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { isAuthorized, UNAUTHORIZED_BODY } from "@/lib/auth";
import { json, rawJson } from "@/lib/http";
import {
  parseJsonBody,
  trim,
  normalizeEmail,
  isValidEmail,
  bodyHashOf,
  type ParsedBody,
} from "@/lib/validation";
import { checkAndRecord } from "@/lib/ratelimit";
import {
  findRecord,
  storeRecord,
  IDEMPOTENCY_CONFLICT_MSG,
} from "@/lib/idempotency";
import { bookingDtoJson, listBookingsByEmail } from "@/lib/bookings";

// ============================================================================
// POST /bookings — Levels 1–5 — Book a slot
// ============================================================================
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return json(UNAUTHORIZED_BODY, 401);
  }

  const raw = await req.text();
  const parsed = parseJsonBody(raw);

  // ---- Level 5: rate limit (before any other processing, after auth) ----
  // Extract email even from a malformed body; default to "" sentinel so
  // missing-email requests are still throttled per the empty string.
  let emailForRate = "";
  if (parsed.ok) {
    const v = parsed.value as { email?: unknown };
    if (typeof v?.email === "string") emailForRate = normalizeEmail(v.email);
  }
  const rl = await checkAndRecord(emailForRate);
  if (rl.limited) {
    return json(
      { error: "too many booking attempts for this email, slow down" },
      429,
      { "Retry-After": String(rl.retryAfter ?? 1) },
    );
  }

  // ---- Level 4: idempotency (optional header) ----
  const idempotencyKey = req.headers.get("idempotency-key");
  const bodyHash = bodyHashOf(parsed);

  if (idempotencyKey) {
    const found = await findRecord(idempotencyKey);
    if (found) {
      if (found.bodyHash === bodyHash) {
        // Same key + same body -> replay the exact prior status + body.
        return rawJson(found.responseBody, found.statusCode);
      }
      // Same key + different body -> 422.
      return json({ error: IDEMPOTENCY_CONFLICT_MSG }, 422);
    }

    // Miss -> process, then persist the result for future replays.
    const result = await processBooking(parsed, idempotencyKey, bodyHash);
    const outcome = await storeRecord(
      idempotencyKey,
      bodyHash,
      result.status,
      result.body,
      result.bookingId,
    );
    if (outcome.kind === "stored") {
      return rawJson(result.body, result.status);
    }
    if (outcome.kind === "replay") {
      // Lost the race to another same-key request -> replay its result.
      return rawJson(outcome.responseBody, outcome.statusCode);
    }
    // Lost the race to a different-body same-key request -> 422.
    return json({ error: IDEMPOTENCY_CONFLICT_MSG }, 422);
  }

  // ---- No idempotency key: process normally (not cached) ----
  const result = await processBooking(parsed, null, null);
  return rawJson(result.body, result.status);
}

// ----------------------------------------------------------------------------
// Booking creation pipeline (validation -> slot lookup -> atomic claim).
// Returns the exact status + serialized JSON body to return (and cache).
// ----------------------------------------------------------------------------
interface ProcessResult {
  status: number;
  body: string;
  bookingId: string | null;
}

class SlotConflictError extends Error {}

async function processBooking(
  parsed: ParsedBody,
  idempotencyKey: string | null,
  bodyHash: string | null,
): Promise<ProcessResult> {
  // Level 2: parse + field normalization.
  if (!parsed.ok) {
    return errResult(400, "invalid json body");
  }
  const v = (parsed.value as Record<string, unknown>) ?? {};
  const slotId = trim(v.slot_id);
  const name = trim(v.name);
  const email = normalizeEmail(v.email);

  if (!slotId) return errResult(400, "slot_id is required");
  if (!name) return errResult(400, "name is required");
  if (!email) return errResult(400, "email is required");
  if (!isValidEmail(email)) return errResult(400, "email is not valid");

  // Level 2: slot must exist.
  const slot = await db.slot.findUnique({ where: { id: slotId } });
  if (!slot) return errResult(404, "slot not found");

  // Level 2: slot must not have already started.
  if (slot.start.getTime() <= Date.now()) {
    return errResult(400, "slot has already started");
  }

  // Level 3: concurrency-safe claim.
  //
  // The guarantee is a SINGLE atomic conditional UPDATE:
  //   UPDATE Slot SET bookedBookingId = <id> WHERE id = <slot_id> AND bookedBookingId IS NULL
  // Only one concurrent caller can match (the rest see the row already claimed
  // -> count 0 -> 409). We deliberately do NOT wrap this in a Prisma
  // interactive `$transaction`: an interactive transaction holds the
  // connection (and the SQLite write lock) for the whole callback, and under
  // heavy concurrent write contention that exceeds Prisma's socket/transaction
  // timeouts (P1008 / P2028). A single `updateMany` statement holds the write
  // lock for microseconds and serializes naturally at the DB level, so it holds
  // under true concurrency without timing out.
  //
  // We then create the booking row separately. If that create fails we release
  // the claim so the slot isn't orphaned. The whole claim+create is wrapped in
  // a retry for transient Prisma lock/socket errors (P1008/P2024); retries are
  // safe because (a) the claim updateMany is idempotent w.r.t. who holds the
  // slot, and (b) we disambiguate count==0 between "someone else holds it" and
  // "I hold it from a timed-out prior attempt", and the booking create uses a
  // pre-generated id so a duplicate insert is caught (P2002) and replayed.
  const bookingId = crypto.randomUUID();
  try {
    const booking = await claimAndCreate(
      bookingId,
      slotId,
      name,
      email,
      idempotencyKey,
      bodyHash,
    );
    return { status: 201, body: bookingDtoJson(booking), bookingId: booking.id };
  } catch (e) {
    if (e instanceof SlotConflictError) {
      return errResult(409, "slot is already booked");
    }
    throw e;
  }
}

// Transient Prisma errors that are safe to retry (the query did NOT commit).
const RETRYABLE_PRISMA_CODES = new Set(["P1008", "P2024", "P2028"]);

async function claimAndCreate(
  bookingId: string,
  slotId: string,
  name: string,
  email: string,
  idempotencyKey: string | null,
  bodyHash: string | null,
) {
  const MAX_RETRIES = 5;
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // 1) Atomic conditional claim — single statement, the DB-level guarantee.
      const claim = await db.slot.updateMany({
        where: { id: slotId, bookedBookingId: null },
        data: { bookedBookingId: bookingId },
      });

      if (claim.count === 0) {
        // Either someone else claimed it, or WE claimed it in a prior attempt
        // whose response was lost (e.g. socket timeout after the UPDATE landed).
        // Distinguish so we never wrongly 409 our own successful claim.
        const held = await db.slot.findUnique({
          where: { id: slotId },
          select: { bookedBookingId: true },
        });
        if (held?.bookedBookingId !== bookingId) {
          throw new SlotConflictError(); // someone else genuinely holds it -> 409
        }
        // else: our own claim from a timed-out attempt — fall through to create.
      }

      // 2) Persist the booking row (idempotent on the PK).
      try {
        return await db.booking.create({
          data: {
            id: bookingId,
            slotId,
            name,
            email,
            status: "confirmed",
            idempotencyKey,
            bodyHash,
          },
        });
      } catch (createErr) {
        const code = (createErr as { code?: string })?.code;
        if (code === "P2002") {
          // Row already exists from a prior attempt — replay it.
          const existing = await db.booking.findUnique({ where: { id: bookingId } });
          if (existing) return existing;
        }
        // Create genuinely failed -> release our claim so the slot is reusable.
        await db.slot.updateMany({
          where: { id: slotId, bookedBookingId: bookingId },
          data: { bookedBookingId: null },
        });
        throw createErr;
      }
    } catch (e) {
      lastError = e;
      if (e instanceof SlotConflictError) throw e; // real 409, never retry
      const code = (e as { code?: string })?.code;
      if (code && RETRYABLE_PRISMA_CODES.has(code) && attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 10 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}

function errResult(status: number, message: string): ProcessResult {
  return { status, body: JSON.stringify({ error: message }), bookingId: null };
}

// ============================================================================
// GET /bookings — Level 4 — List a person's bookings (cursor pagination).
// ============================================================================
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return json(UNAUTHORIZED_BODY, 401);
  }

  const params = req.nextUrl.searchParams;
  const emailParam = params.get("email");
  if (!emailParam || !emailParam.trim()) {
    return json({ error: "email is required" }, 400);
  }

  const limitParam = params.get("limit");
  let limit = 10;
  if (limitParam !== null) {
    const n = Number(limitParam);
    if (!Number.isInteger(n) || n < 1 || n > 50) {
      return json({ error: "limit must be an integer between 1 and 50" }, 400);
    }
    limit = n;
  }

  const cursor = params.get("cursor");
  const page = await listBookingsByEmail(emailParam.trim(), limit, cursor);
  return json(page, 200);
}
