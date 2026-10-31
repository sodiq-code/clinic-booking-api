/// <summary>
/// scripts/migrate.ts — idempotent table creation for the Clinic Booking API.
///
/// Uses @libsql/client directly (the same client the Prisma adapter wraps) so
/// path/URL resolution matches the runtime adapter exactly:
///   - local dev:  DATABASE_URL="file:./prisma/dev.db"  -> creates tables in that file
///   - production: DATABASE_URL="libsql://<turso-host>"  -> creates tables in Turso
///                 (DATABASE_AUTH_TOKEN is read for auth)
///
/// The statements are CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS,
/// so this is safe to run on every build — it only creates what's missing and
/// never drops or alters existing data.
///
/// This runs as part of the Vercel build (see package.json "build" script) so
/// the Turso database has the schema in place before the app serves traffic,
/// without relying on `prisma db push` connecting through the driver adapter
/// from the CLI (which has uncertain libsql:// support across Prisma versions).
/// </summary>
import { createClient } from "@libsql/client";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("MIGRATE: DATABASE_URL is not set.");
    process.exit(1);
  }
  const authToken = process.env.DATABASE_AUTH_TOKEN;
  const client = createClient({ url, authToken });

  console.log(`MIGRATE: connecting to ${url.replace(/\/\/.*@/, "//***@")}`);

  const statements = [
    // ---- Slot ----
    `CREATE TABLE IF NOT EXISTS "Slot" (
      "id" TEXT NOT NULL,
      "provider" TEXT NOT NULL,
      "start" DATETIME NOT NULL,
      "end" DATETIME NOT NULL,
      "bookedBookingId" TEXT,
      CONSTRAINT "Slot_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX IF NOT EXISTS "Slot_provider_idx" ON "Slot"("provider")`,
    `CREATE INDEX IF NOT EXISTS "Slot_start_idx" ON "Slot"("start")`,

    // ---- Booking ----
    `CREATE TABLE IF NOT EXISTS "Booking" (
      "id" TEXT NOT NULL,
      "slotId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "email" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "idempotencyKey" TEXT,
      "bodyHash" TEXT,
      CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX IF NOT EXISTS "Booking_email_createdAt_idx" ON "Booking"("email", "createdAt")`,
    `CREATE INDEX IF NOT EXISTS "Booking_email_idx" ON "Booking"("email")`,
    `CREATE INDEX IF NOT EXISTS "Booking_slotId_idx" ON "Booking"("slotId")`,

    // ---- IdempotencyRecord ----
    `CREATE TABLE IF NOT EXISTS "IdempotencyRecord" (
      "key" TEXT NOT NULL,
      "bodyHash" TEXT NOT NULL,
      "statusCode" INTEGER NOT NULL,
      "responseBody" TEXT NOT NULL,
      "bookingId" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("key")
    )`,

    // ---- RateLimitAttempt ----
    `CREATE TABLE IF NOT EXISTS "RateLimitAttempt" (
      "id" TEXT NOT NULL,
      "email" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "RateLimitAttempt_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX IF NOT EXISTS "RateLimitAttempt_email_createdAt_idx" ON "RateLimitAttempt"("email", "createdAt")`,
  ];

  for (const sql of statements) {
    await client.execute(sql);
  }
  console.log(`MIGRATE: applied ${statements.length} statements OK`);

  // Quick sanity check: count tables.
  const res = await client.execute(
    `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
  );
  console.log(
    "MIGRATE: tables present:",
    res.rows.map((r) => r.name).join(", "),
  );

  client.close();
}

main().catch((e) => {
  console.error("MIGRATE FAILED:", e);
  process.exit(1);
});
