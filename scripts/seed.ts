// Seed a handful of sample slots directly via Prisma (no server needed).
// Run with: bun run scripts/seed.ts
//
// Creates a mix of future slots (bookable) and one past slot (to demonstrate
// the "slot has already started" validation), across two providers.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.booking.deleteMany();
  await prisma.slot.deleteMany();
  await prisma.idempotencyRecord.deleteMany();
  await prisma.rateLimitAttempt.deleteMany();

  const now = Date.now();
  const DAY = 86_400_000;
  const HALF_HR = 1_800_000;

  const slots = [
    // Past slot (already started) — booking it returns 400.
    { id: "seed-past", provider: "Dr. Alice", start: new Date(now - DAY), end: new Date(now - DAY + HALF_HR) },
    // Future slots.
    { id: "seed-1", provider: "Dr. Alice", start: new Date(now + DAY), end: new Date(now + DAY + HALF_HR) },
    { id: "seed-2", provider: "Dr. Alice", start: new Date(now + DAY + HALF_HR), end: new Date(now + DAY + 2 * HALF_HR) },
    { id: "seed-3", provider: "Dr. Alice", start: new Date(now + 2 * DAY), end: new Date(now + 2 * DAY + HALF_HR) },
    { id: "seed-4", provider: "Dr. Bob", start: new Date(now + DAY), end: new Date(now + DAY + HALF_HR) },
    { id: "seed-5", provider: "Dr. Bob", start: new Date(now + 3 * DAY), end: new Date(now + 3 * DAY + HALF_HR) },
  ];

  for (const s of slots) {
    await prisma.slot.create({ data: s });
  }

  console.log(`Seeded ${slots.length} slots:`);
  for (const s of slots) {
    console.log(`  ${s.id}  ${s.provider}  ${s.start.toISOString()}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
