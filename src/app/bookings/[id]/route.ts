import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { isAuthorized, UNAUTHORIZED_BODY } from "@/lib/auth";
import { json } from "@/lib/http";
import { bookingDto } from "@/lib/bookings";

// GET /bookings/{id} — Level 1 — Get a booking.
// 200 Booking, or 404.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isAuthorized(req)) {
    return json(UNAUTHORIZED_BODY, 401);
  }
  const { id } = await params;

  const booking = await db.booking.findUnique({ where: { id } });
  if (!booking) {
    return json({ error: "booking not found" }, 404);
  }
  return json(bookingDto(booking), 200);
}

// DELETE /bookings/{id} — Level 3 — Cancel a booking.
// Sets status to "cancelled" and frees the slot (clears the claim) so it can
// be booked again. 200 Booking, or 404, or 409 if already cancelled.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isAuthorized(req)) {
    return json(UNAUTHORIZED_BODY, 401);
  }
  const { id } = await params;

  const booking = await db.booking.findUnique({ where: { id } });
  if (!booking) {
    return json({ error: "booking not found" }, 404);
  }
  if (booking.status === "cancelled") {
    return json({ error: "booking is already cancelled" }, 409);
  }

  const cancelled = await db.$transaction(async (tx) => {
    const updated = await tx.booking.update({
      where: { id },
      data: { status: "cancelled" },
    });
    // Free the slot — only clear the claim that belongs to THIS booking.
    await tx.slot.updateMany({
      where: { id: booking.slotId, bookedBookingId: id },
      data: { bookedBookingId: null },
    });
    return updated;
  });

  return json(bookingDto(cancelled), 200);
}
