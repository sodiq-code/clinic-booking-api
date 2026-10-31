import { NextRequest } from "next/server";

// Level 2 auth: every request must carry X-API-Key matching env API_KEY.
const EXPECTED_KEY = process.env.API_KEY ?? "";

export function apiKeyFromRequest(req: NextRequest): string | null {
  return req.headers.get("x-api-key");
}

/**
 * Returns true if the request carries a valid X-API-Key.
 */
export function isAuthorized(req: NextRequest): boolean {
  if (!EXPECTED_KEY) return false; // no key configured -> deny all
  const provided = req.headers.get("x-api-key");
  return provided !== null && provided === EXPECTED_KEY;
}

export const UNAUTHORIZED_BODY = { error: "missing or invalid api key" };
