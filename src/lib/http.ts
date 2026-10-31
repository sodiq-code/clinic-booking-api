import { NextResponse } from "next/server";

/** Build a JSON Response with the given status. */
export function json(body: unknown, status: number, headers?: HeadersInit): Response {
  return NextResponse.json(body, { status, headers });
}

/** Build a Response from an already-serialized JSON string. */
export function rawJson(
  body: string,
  status: number,
  headers?: Record<string, string>,
): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(headers ?? {}),
    },
  });
}

export const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
