"use client";

import { useEffect, useState } from "react";

// ---- Wire types (mirror the API shapes) ----
interface SlotWithAvailability {
  id: string;
  provider: string;
  start: string;
  end: string;
  available: boolean;
}

interface Booking {
  id: string;
  slot_id: string;
  name: string;
  email: string;
  status: "confirmed" | "cancelled";
  created_at: string;
}

type Tab = "book" | "lookup";

const LS_KEY = "clinic_booking_api_key";

export default function Page() {
  const [apiKey, setApiKey] = useState("");
  const [tab, setTab] = useState<Tab>("book");

  // slots
  const [slots, setSlots] = useState<SlotWithAvailability[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [providerFilter, setProviderFilter] = useState("");

  // booking form
  const [selected, setSelected] = useState<SlotWithAvailability | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<Booking | null>(null);
  const [bookingError, setBookingError] = useState<string | null>(null);

  // lookup
  const [lookupId, setLookupId] = useState("");
  const [lookupResult, setLookupResult] = useState<Booking | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null;
    if (saved) setApiKey(saved);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem(LS_KEY, apiKey);
  }, [apiKey]);

  function authHeaders(): HeadersInit {
    return { "content-type": "application/json", "x-api-key": apiKey };
  }

  async function loadSlots() {
    if (!apiKey) {
      setSlotsError("Enter your API key first.");
      return;
    }
    setSlotsLoading(true);
    setSlotsError(null);
    setConfirmation(null);
    try {
      const url = providerFilter
        ? `/slots?provider=${encodeURIComponent(providerFilter)}`
        : `/slots`;
      const res = await fetch(url, { headers: { "x-api-key": apiKey } });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`);
      setSlots(data.slots ?? []);
    } catch (e) {
      setSlotsError(e instanceof Error ? e.message : "Failed to load slots");
      setSlots(null);
    } finally {
      setSlotsLoading(false);
    }
  }

  async function submitBooking(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    setBookingError(null);
    setConfirmation(null);
    try {
      const res = await fetch("/bookings", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          slot_id: selected.id,
          name: name.trim(),
          email: email.trim(),
        }),
      });
      const data = await res.json();
      if (res.status === 201) {
        setConfirmation(data as Booking);
        setSelected(null);
        setName("");
        setEmail("");
        // refresh availability
        loadSlots();
      } else {
        throw new Error(data?.error ?? `Booking failed (${res.status})`);
      }
    } catch (e) {
      setBookingError(e instanceof Error ? e.message : "Booking failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function lookupBooking(e: React.FormEvent) {
    e.preventDefault();
    if (!lookupId.trim()) return;
    setLookupLoading(true);
    setLookupError(null);
    setLookupResult(null);
    try {
      const res = await fetch(`/bookings/${encodeURIComponent(lookupId.trim())}`, {
        headers: { "x-api-key": apiKey },
      });
      const data = await res.json();
      if (res.ok) {
        setLookupResult(data as Booking);
      } else {
        throw new Error(data?.error ?? `Not found (${res.status})`);
      }
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setLookupLoading(false);
    }
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="max-w-3xl mx-auto px-4 py-5">
          <h1 className="text-2xl font-bold tracking-tight">Clinic Booking</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Browse available appointment slots and book in seconds.
          </p>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6 space-y-6">
        {/* API key */}
        <section
          aria-label="API key"
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4"
        >
          <label
            htmlFor="apikey"
            className="block text-sm font-medium mb-2"
          >
            API Key
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              id="apikey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="paste your X-API-Key here"
              className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <button
              onClick={loadSlots}
              disabled={slotsLoading}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {slotsLoading ? "Loading…" : "Load slots"}
            </button>
          </div>
          <div className="mt-2">
            <input
              type="text"
              value={providerFilter}
              onChange={(e) => setProviderFilter(e.target.value)}
              placeholder="filter by provider (optional)"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </section>

        {/* Tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setTab("book")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === "book"
                ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
            }`}
          >
            Book a slot
          </button>
          <button
            onClick={() => setTab("lookup")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === "lookup"
                ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
            }`}
          >
            Look up a booking
          </button>
        </div>

        {tab === "book" && (
          <>
            {/* Slots */}
            {slotsError && (
              <div className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 px-4 py-3 text-sm">
                {slotsError}
              </div>
            )}

            {slots && slots.length === 0 && (
              <div className="text-sm text-slate-500 px-1">
                No slots configured. POST some slots to{" "}
                <code>/reset</code> first.
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              {slots?.map((s) => (
                <article
                  key={s.id}
                  className={`rounded-xl border p-4 transition-shadow hover:shadow-md ${
                    s.available
                      ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20"
                      : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 opacity-70"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold">{s.provider}</h3>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        s.available
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200"
                          : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                      }`}
                    >
                      {s.available ? "available" : "booked"}
                    </span>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
                    {fmt(s.start)} — {fmt(s.end)}
                  </p>
                  {s.available && (
                    <button
                      onClick={() => {
                        setSelected(s);
                        setConfirmation(null);
                        setBookingError(null);
                      }}
                      className="mt-3 w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors"
                    >
                      Book this slot
                    </button>
                  )}
                </article>
              ))}
            </div>

            {/* Booking form modal-ish panel */}
            {selected && (
              <section
                aria-label="Booking form"
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="font-semibold">Book with {selected.provider}</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {fmt(selected.start)} — {fmt(selected.end)}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelected(null)}
                    className="text-sm text-slate-400 hover:text-slate-700"
                    aria-label="Close booking form"
                  >
                    ✕
                  </button>
                </div>
                <form onSubmit={submitBooking} className="mt-4 space-y-3">
                  <div>
                    <label htmlFor="name" className="block text-sm font-medium mb-1">
                      Name
                    </label>
                    <input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium mb-1">
                      Email
                    </label>
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  {bookingError && (
                    <div className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 px-3 py-2 text-sm">
                      {bookingError}
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                  >
                    {submitting ? "Booking…" : "Confirm booking"}
                  </button>
                </form>
              </section>
            )}

            {/* Confirmation */}
            {confirmation && (
              <section
                aria-label="Booking confirmation"
                className="rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-4"
              >
                <h2 className="font-semibold text-emerald-800 dark:text-emerald-200">
                  Booking confirmed
                </h2>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <dt className="text-slate-500">ID</dt>
                  <dd className="col-span-2 font-mono break-all">{confirmation.id}</dd>
                  <dt className="text-slate-500">Provider</dt>
                  <dd className="col-span-2">
                    {slots?.find((s) => s.id === confirmation.slot_id)?.provider ??
                      confirmation.slot_id}
                  </dd>
                  <dt className="text-slate-500">Name</dt>
                  <dd className="col-span-2">{confirmation.name}</dd>
                  <dt className="text-slate-500">Email</dt>
                  <dd className="col-span-2">{confirmation.email}</dd>
                  <dt className="text-slate-500">Status</dt>
                  <dd className="col-span-2">{confirmation.status}</dd>
                  <dt className="text-slate-500">Created</dt>
                  <dd className="col-span-2">{fmt(confirmation.created_at)}</dd>
                </dl>
              </section>
            )}
          </>
        )}

        {tab === "lookup" && (
          <section
            aria-label="Look up booking"
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4"
          >
            <form onSubmit={lookupBooking} className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={lookupId}
                onChange={(e) => setLookupId(e.target.value)}
                placeholder="booking id"
                className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="submit"
                disabled={lookupLoading}
                className="rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 px-4 py-2 text-sm font-semibold disabled:opacity-50 transition-colors"
              >
                {lookupLoading ? "Searching…" : "Find"}
              </button>
            </form>

            {lookupError && (
              <div className="mt-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 px-3 py-2 text-sm">
                {lookupError}
              </div>
            )}

            {lookupResult && (
              <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
                <dt className="text-slate-500">ID</dt>
                <dd className="col-span-2 font-mono break-all">{lookupResult.id}</dd>
                <dt className="text-slate-500">Slot</dt>
                <dd className="col-span-2 font-mono break-all">{lookupResult.slot_id}</dd>
                <dt className="text-slate-500">Name</dt>
                <dd className="col-span-2">{lookupResult.name}</dd>
                <dt className="text-slate-500">Email</dt>
                <dd className="col-span-2">{lookupResult.email}</dd>
                <dt className="text-slate-500">Status</dt>
                <dd className="col-span-2">{lookupResult.status}</dd>
                <dt className="text-slate-500">Created</dt>
                <dd className="col-span-2">{fmt(lookupResult.created_at)}</dd>
              </dl>
            )}
          </section>
        )}
      </main>

      <footer className="mt-auto border-t border-slate-200 dark:border-slate-800">
        <div className="max-w-3xl mx-auto px-4 py-4 text-xs text-slate-500 dark:text-slate-400">
          Clinic Booking API · Next.js 16 · Prisma · Koya Cohort 4 Task BUILD-1
        </div>
      </footer>
    </div>
  );
}
