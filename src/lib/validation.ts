import crypto from "node:crypto";

// ---- Body parsing ----

export interface ParsedBody {
  ok: boolean;
  value: unknown;
  raw: string;
}

/**
 * Parse the raw request body string as JSON.
 * Returns { ok: false } on invalid JSON.
 */
export function parseJsonBody(raw: string): ParsedBody {
  if (raw === null || raw === undefined || raw === "") {
    // Empty body — treat as invalid JSON (no object to read fields from).
    return { ok: false, value: null, raw: raw ?? "" };
  }
  try {
    return { ok: true, value: JSON.parse(raw), raw };
  } catch {
    return { ok: false, value: null, raw };
  }
}

// ---- Field helpers ----

export function trim(s: unknown): string {
  return typeof s === "string" ? s.trim() : "";
}

/** Trim + lowercase (Level 2 email normalization). */
export function normalizeEmail(s: unknown): string {
  return trim(s).toLowerCase();
}

// Basic, pragmatic email regex (Level 2 only needs "basic").
// Requires: local@domain.tld, no spaces, a single @, a dot in the domain.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

// ---- Canonical JSON (for idempotency body hashing) ----

/**
 * Deterministic JSON serialization: object keys sorted recursively.
 * This makes the idempotency body hash independent of key order / whitespace
 * so that "same body" (same logical content) hashes identically.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]))
      .join(",") +
    "}"
  );
}

/**
 * SHA-256 hex digest of the canonical form of a parsed body.
 * Falls back to hashing the raw body string when the body is not valid JSON,
 * so idempotency still works (and is consistent) for malformed payloads.
 */
export function bodyHashOf(parsed: ParsedBody): string {
  const input = parsed.ok ? stableStringify(parsed.value) : parsed.raw;
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}
