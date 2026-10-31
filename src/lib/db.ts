import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";

// Prisma client singleton built on the libSQL driver adapter.
//
// One code path serves both environments via DATABASE_URL:
//   - local dev:  "file:./prisma/dev.db"                 (local SQLite file)
//   - production: "libsql://<host>.turso.io"             (Turso, with
//                  DATABASE_AUTH_TOKEN for the auth bearer)
//
// The adapter talks to Turso over HTTP/2 from Vercel's serverless functions,
// which avoids the ephemeral-filesystem problem of native SQLite on serverless
// and gives us real persistence + transactions for Level 3 concurrency safety.
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Set it to a libsql:// URL (Turso) or file:./path (local SQLite).",
    );
  }
  // For local file: URLs, authToken is not needed (and @libsql/client ignores it).
  // For libsql:// URLs (Turso), the authToken is the database auth token.
  const authToken = process.env.DATABASE_AUTH_TOKEN;
  // PrismaLibSQL (v6) takes a @libsql/client Config object directly — it creates
  // the underlying libsql client internally.
  const adapter = new PrismaLibSQL({ url, authToken });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
