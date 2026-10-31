import type { Booking } from "@prisma/client";
import { db } from "./db";
import { toIsoUtc } from "./time";

// Wire shape for a Booking (snake_case on the wire, camelCase in the DB).
export interface BookingDto {
  id: string;
  slot_id: string;
  name: string;
  email: string;
  status: "confirmed" | "cancelled";
  created_at: string;
}

export function bookingDto(b: Booking): BookingDto {
  return {
    id: b.id,
    slot_id: b.slotId,
    name: b.name,
    email: b.email,
    status: b.status as "confirmed" | "cancelled",
    created_at: toIsoUtc(b.createdAt) as string,
  };
}

export function bookingDtoJson(b: Booking): string {
  return JSON.stringify(bookingDto(b));
}

// ---- Level 4 cursor pagination ----
// Cursor is base64url(JSON({c: createdAtIso, i: id})). We paginate in
// (createdAt asc, id asc) order using a composite tiebreaker so equal
// timestamps (possible when bookings are created in the same millisecond)
// are still ordered deterministically.

interface CursorPayload {
  c: string; // createdAt ISO
  i: string; // id
}

export function encodeCursor(createdAt: Date, id: string): string {
  const payload: CursorPayload = { c: createdAt.toISOString(), i: id };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as Partial<CursorPayload>;
    if (typeof parsed.c === "string" && typeof parsed.i === "string") {
      return { c: parsed.c, i: parsed.i };
    }
    return null;
  } catch {
    return null;
  }
}

export interface PaginatedBookings {
  bookings: BookingDto[];
  next_cursor: string | null;
}

/**
 * Fetch one page of a person's bookings (oldest first), case-insensitive
 * email match (email is stored lowercased).
 */
export async function listBookingsByEmail(
  email: string,
  limit: number,
  cursor: string | null,
): Promise<PaginatedBookings> {
  const lowerEmail = email.toLowerCase();

  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (!decoded) {
      // Invalid cursor -> treat as empty result (no next page).
      return { bookings: [], next_cursor: null };
    }
    const cursorDate = new Date(decoded.c);
    const cursorId = decoded.i;

    const rows = await db.booking.findMany({
      where: {
        email: lowerEmail,
        OR: [
          { createdAt: { gt: cursorDate } },
          { createdAt: { equals: cursorDate }, id: { gt: cursorId } },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
    });
    return buildPage(rows, limit);
  }

  const rows = await db.booking.findMany({
    where: { email: lowerEmail },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit + 1,
  });
  return buildPage(rows, limit);
}

function buildPage(rows: Booking[], limit: number): PaginatedBookings {
  const hasNext = rows.length > limit;
  const slice = hasNext ? rows.slice(0, limit) : rows;
  const last = slice[slice.length - 1];
  const next_cursor = hasNext && last ? encodeCursor(last.createdAt, last.id) : null;
  return {
    bookings: slice.map(bookingDto),
    next_cursor,
  };
}
