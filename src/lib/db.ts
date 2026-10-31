import { PrismaClient } from "@prisma/client";

// Prisma client singleton — avoids exhausting DB connections when Next.js
// hot-reloads route handlers in dev.
//
// Production: connects to Neon Postgres via DATABASE_URL (provider postgresql,
// generated from prisma/schema.prisma).
// Local dev: connects to a local SQLite file (generated from
// prisma/schema.local.prisma). The generated client used at runtime matches
// whichever schema was last passed to `prisma generate`.
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
