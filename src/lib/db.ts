import { PrismaClient } from "@prisma/client";

// Prisma client singleton — avoids exhausting DB connections when Next.js
// hot-reloads route handlers in dev.
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
