import { db } from "./db";
import type { IdempotencyRecord } from "@prisma/client";

// Level 4: idempotency via a dedicated IdempotencyRecord table so we can
// replay the EXACT status code + body of any prior request (including
// 400/404/409/429 — the spec requires the same status code on retry).

export const IDEMPOTENCY_CONFLICT_MSG = "idempotency key reused with a different body";

/** Look up a cached idempotency record by key. */
export async function findRecord(key: string): Promise<IdempotencyRecord | null> {
  return db.idempotencyRecord.findUnique({ where: { key } });
}

export type StoreOutcome =
  | { kind: "stored" }
  | { kind: "replay"; statusCode: number; responseBody: string }
  | { kind: "conflict" };

/**
 * Persist the result of an idempotent request.
 *
 * On the happy path, inserts the record and returns { kind: "stored" } so the
 * caller can return its own processed response.
 *
 * Race handling: two concurrent same-key requests can both miss the initial
 * lookup. The unique PK on `key` guarantees only one INSERT wins; the loser
 * throws P2002. We then re-read the winning record and either replay it
 * (same body) or signal a 422 conflict (different body), so the loser never
 * surfaces its own — possibly duplicated — side effects.
 */
export async function storeRecord(
  key: string,
  bodyHash: string,
  statusCode: number,
  responseBody: string,
  bookingId: string | null,
): Promise<StoreOutcome> {
  try {
    await db.idempotencyRecord.create({
      data: { key, bodyHash, statusCode, responseBody, bookingId },
    });
    return { kind: "stored" };
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === "P2002") {
      // Lost the race — replay the winner's cached response (or 422).
      const existing = await db.idempotencyRecord.findUnique({ where: { key } });
      if (existing) {
        if (existing.bodyHash === bodyHash) {
          return {
            kind: "replay",
            statusCode: existing.statusCode,
            responseBody: existing.responseBody,
          };
        }
        return { kind: "conflict" };
      }
      // Record vanished between insert and re-read — extremely unlikely.
      // Treat as stored so we don't lose the caller's response.
      return { kind: "stored" };
    }
    throw e;
  }
}
