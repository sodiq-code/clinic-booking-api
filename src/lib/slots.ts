import type { Slot } from "@prisma/client";
import { toIsoUtc } from "./time";

// Wire shapes (kept here so route handlers stay thin).
export interface SlotDto {
  id: string;
  provider: string;
  start: string;
  end: string;
}

export interface SlotWithAvailabilityDto extends SlotDto {
  available: boolean;
}

/**
 * Serialize a Prisma Slot row to the public SlotWithAvailability shape.
 * `available` is false while the slot has a confirmed booking claim
 * (bookedBookingId is set); true otherwise (including cancelled bookings,
 * because cancelling frees the slot by clearing bookedBookingId).
 */
export function slotWithAvailability(slot: Slot): SlotWithAvailabilityDto {
  return {
    id: slot.id,
    provider: slot.provider,
    start: toIsoUtc(slot.start) as string,
    end: toIsoUtc(slot.end) as string,
    available: slot.bookedBookingId === null,
  };
}

/** Serialize a slot for the raw Slot shape (used by /reset input echo, etc). */
export function slotDto(slot: Slot): SlotDto {
  return {
    id: slot.id,
    provider: slot.provider,
    start: toIsoUtc(slot.start) as string,
    end: toIsoUtc(slot.end) as string,
  };
}
