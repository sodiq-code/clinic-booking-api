# Clinic Booking API

A production-ready Clinic Booking API + simple web page, built for the
**Koya Cohort 4 — Task BUILD-1** assessment. Implements all 5 levels of the
OpenAPI contract: slot management, booking, auth + validation, concurrency-safe
booking, idempotency + pagination, and per-email rate limiting.

- **Framework:** Next.js 16 (App Router, route handlers)
- **Language:** TypeScript 5 (strict)
- **ORM:** Prisma (SQLite for local dev/testing, Postgres for production)
- **Styling:** Tailwind CSS v4
- **Auth:** simple `X-API-Key` header checked against the `API_KEY` env var

---

## Quick start (local, SQLite)

```bash
# 1. Install deps
bun install

# 2. Configure env
cp .env.example .env
# then edit .env:
#   DATABASE_URL="file:./dev.db"      # SQLite, resolved to prisma/dev.db
#   API_KEY="test-key-123"            # any secret you like

# 3. Generate the Prisma client + create the local SQLite DB
bun run db:generate:local
bun run db:push:local

# 4. Run the dev server (port 3001 by default; 3000 is used by the host project)
bun run dev

# 5. (optional) seed some sample slots
bun run seed

# 6. verify every level end-to-end
bash scripts/test.sh
```

Open the web page at the dev server root (`http://localhost:3001/` in local
dev — in this sandbox use the Preview Panel). Paste your API key, load slots,
and book.

## Production (Postgres on Vercel)

```bash
bun run db:generate   # uses prisma/schema.prisma (provider postgresql)
bun run db:push       # create/apply tables
```

Set `DATABASE_URL` (Vercel Postgres) and `API_KEY` in your Vercel project env.
Next.js builds natively on Vercel — no `output: 'standalone'` needed.

## Endpoints

All endpoints live at the root (e.g. `POST /reset`, **not** `/api/reset`).
Every request requires `X-API-Key`.

| Method & path            | Level   | Purpose                                            |
|--------------------------|---------|----------------------------------------------------|
| `POST /reset`            | L1      | Replace all slots (wipes bookings + cache tables)  |
| `GET /slots`             | L1      | List slots (earliest first) with `available` flag  |
| `POST /bookings`         | L1–L5   | Book a slot                                         |
| `GET /bookings`          | L4      | List a person's bookings (cursor pagination)        |
| `GET /bookings/{id}`     | L1      | Get a booking                                       |
| `DELETE /bookings/{id}`  | L3      | Cancel a booking (frees the slot)                   |

### Schemas

```
Slot                  { id, provider, start, end }
SlotWithAvailability  Slot + { available: boolean }   // false while slot has a confirmed booking
NewBooking            { slot_id, name, email }
Booking               { id, slot_id, name, email, status:"confirmed"|"cancelled", created_at }
Error                 { error: string }
```

### POST /bookings response codes

| Code | When                                                                     |
|------|--------------------------------------------------------------------------|
| 201  | Booking created (`status: confirmed`)                                    |
| 400  | Invalid JSON / missing or empty `slot_id`/`name`/`email` / bad email / slot already started |
| 404  | `slot_id` not found                                                       |
| 409  | Slot already has a confirmed booking                                      |
| 422  | `Idempotency-Key` reused with a different body                            |
| 429  | > 5 attempts for this email in the last 60s (+ `Retry-After: <seconds>`)  |

Optional headers / params:

- `POST /bookings`: `Idempotency-Key: <string>` (Level 4)
- `GET /slots?provider=<name>`
- `GET /bookings?email=<required>&limit=<1..50>&cursor=<string>`

---

## Architecture notes (level by level)

### Level 3 — concurrency (the critical correctness requirement)

Double-booking is prevented with an **atomic conditional UPDATE**, identical
on SQLite and Postgres. Inside a transaction:

1. `INSERT` the booking row (`status = confirmed`).
2. `UPDATE Slot SET bookedBookingId = <new booking id>
   WHERE id = <slot_id> AND bookedBookingId IS NULL` (Prisma `updateMany`).
3. If `count === 0`, **rollback** (the INSERT is undone) → `409`.

`UPDATE … WHERE bookedBookingId IS NULL` is a single statement, so under
concurrent transactions only one of them can match (the rest see the row already
claimed, even in Postgres `READ COMMITTED` because the row is re-checked after
the row lock is acquired). This holds for the 20-concurrent-booking test:
exactly one `201`, the rest `409`.

`DELETE /bookings/{id}` sets `status = cancelled` **and** clears
`Slot.bookedBookingId = null` in the same transaction, so the slot becomes
bookable again. Deleting an already-cancelled booking returns `409`.

### Level 4 — idempotency

If `Idempotency-Key` is present:

1. `bodyHash = sha256(stableStringify(parsedBody))` — canonical JSON with keys
   sorted recursively, so key order / whitespace don't matter.
2. Look the key up in `IdempotencyRecord`.
   - Same `bodyHash` → replay the **exact** stored `statusCode` + `responseBody`
     (this includes 400/404/409/429 — the spec requires the same status code on
     retry, not just 201).
   - Different `bodyHash` → `422 idempotency key reused with a different body`.
3. On a miss: process normally, then store the result. The unique PK on `key`
   makes the INSERT a claim — the loser of a race catches `P2002`, re-reads the
   winner's record, and replays it (or returns 422). No second booking is
   created for the same-key-same-body case (the loser's transaction rolls back
   its slot claim with a 409, then replays the winner's 201).

Requests **without** the header are not idempotent.

**Rate-limit interaction:** every `POST /bookings` counts as an attempt for its
email, *including idempotent retries* (rate-limit check runs before the
idempotency lookup). The interpretation: a retried idempotent request is still
an "attempt" per the spec ("at most 5 attempts per email per minute, failed
attempts included"). If a same-key request is retried more than 5 times in a
minute, the 6th returns 429 rather than the cached 201.

### Level 5 — rate limiting

- At most **5** `POST /bookings` attempts per email per rolling **60s** window.
- The attempt row is inserted **before** validation, so failed (400/404/409)
  attempts count.
- The 6th attempt returns `429` with a `Retry-After` header in **whole seconds**
  (until the oldest in-window attempt ages out, clamped to ≥ 1).
- Per-email: other emails are unaffected.
- Email is lowercased + trimmed from the request body (default `""` if missing,
  so missing-email requests are still throttled per the empty string).
- `/reset` clears the rate-limit table, so tests always start clean.

### Level 2 — validation order (in `POST /bookings`, after rate-limit)

1. Parse JSON → invalid → `400 invalid json body`.
2. Trim `name` and `email`; lowercase `email`.
3. Missing/empty `slot_id` / `name` / `email` → `400 <field> is required`.
4. Invalid email → `400 email is not valid`.
5. Slot not found → `404 slot not found`.
6. `slot.start <= now` → `400 slot has already started`.
7. Atomic claim (Level 3) → `409` on conflict, else `201`.

### Response formatting

- `created_at`, `start`, `end` are ISO-8601 UTC with a trailing `Z`
  (e.g. `2026-12-10T09:00:00.000Z`).
- Booking ids are Prisma `cuid()` defaults.
- Errors are always `{"error": "<message>"}`.

---

## Scripts

| Script                  | What it does                                              |
|-------------------------|-----------------------------------------------------------|
| `bun run dev`           | Next dev server on port 3001                              |
| `bun run build`         | Production build                                          |
| `bun run start`         | Start the production server                               |
| `bun run lint`          | ESLint (next/core-web-vitals + next/typescript)           |
| `bun run db:generate`   | Generate Prisma client (Postgres, `schema.prisma`)        |
| `bun run db:push`       | Push schema to Postgres                                   |
| `bun run db:generate:local` | Generate Prisma client (SQLite, `schema.local.prisma`) |
| `bun run db:push:local` | Push schema to local SQLite                               |
| `bun run seed`          | Insert a few sample slots                                 |
| `bash scripts/test.sh`  | End-to-end verification of all 5 levels (curl)            |

## Project layout

```
clinic-booking-api/
├── prisma/
│   ├── schema.prisma          # postgresql (production)
│   └── schema.local.prisma    # sqlite (local dev/testing) — identical models
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx           # booking web page (client component)
│   │   ├── globals.css
│   │   ├── reset/route.ts     # POST /reset
│   │   ├── slots/route.ts     # GET /slots
│   │   ├── bookings/route.ts  # POST /bookings  +  GET /bookings
│   │   └── bookings/[id]/route.ts  # GET /bookings/{id} + DELETE /bookings/{id}
│   └── lib/
│       ├── db.ts              # Prisma client singleton
│       ├── auth.ts            # X-API-Key check
│       ├── validation.ts      # JSON parse, trim/lowercase, email regex, stable hashing
│       ├── idempotency.ts     # findRecord / storeRecord (race-safe)
│       ├── ratelimit.ts       # checkAndRecord (5/min/email)
│       ├── bookings.ts        # booking DTO + cursor pagination
│       ├── slots.ts           # slot DTO + availability
│       ├── http.ts            # JSON response helpers
│       └── time.ts            # ISO-8601 UTC formatting
├── scripts/
│   ├── seed.ts
│   └── test.sh
├── package.json
├── tsconfig.json
├── next.config.mjs
├── postcss.config.mjs
├── eslint.config.mjs
├── .env.example
└── README.md
```

## Deviations from the suggested architecture

- **`.env` `DATABASE_URL` for local SQLite** is set to `file:./dev.db` (not
  `file:./prisma/dev.db`). Prisma resolves SQLite `file:` paths relative to the
  schema file, so `file:./dev.db` lands at `prisma/dev.db` for both `db push`
  and the runtime client. `file:./prisma/dev.db` would nest to
  `prisma/prisma/dev.db`. The resulting file location is exactly what the task
  asked for (`prisma/dev.db`).
- **Dev port is 3001** (the host project already occupies 3000).
- **Rate limit counts idempotent retries** (documented above) — every
  `POST /bookings` is an attempt for its email.
- **`/reset` also clears `IdempotencyRecord` and `RateLimitAttempt`** (in
  addition to bookings + slots) so every test starts from a truly clean slate.
