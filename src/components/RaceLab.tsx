"use client";

import { useState } from "react";
import { CheckCircle2, Flame, RefreshCw, ShieldAlert } from "lucide-react";
import type { EventItem, SessionUser } from "@/types/slotlock";

interface RaceLabProps {
  events: EventItem[];
  user: SessionUser | null;
  onRequireAuth: () => void;
  onDataChanged: () => Promise<void>;
}

interface WorkerOutcome {
  worker: number;
  status: number;
  detail: string;
}

function createKey(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function RaceLab({
  events,
  user,
  onRequireAuth,
  onDataChanged,
}: RaceLabProps) {
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<{
    mode: "race" | "idempotency";
    elapsedMs: number;
    booked: number;
    conflicts: number;
    replays: number;
    errors: number;
    outcomes: WorkerOutcome[];
  } | null>(null);

  const effectiveEventId =
    selectedEventId && events.some((e) => e.id === selectedEventId)
      ? selectedEventId
      : (events[0]?.id ?? "");

  const selectedEvent = events.find((e) => e.id === effectiveEventId);

  const runConcurrentRace = async () => {
    if (!user) {
      onRequireAuth();
      return;
    }
    if (!effectiveEventId) return;

    setRunning(true);
    const started = performance.now();

    try {
      const requests = Array.from({ length: 10 }, async (_, idx) => {
        const res = await fetch("/api/bookings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": createKey(`web-race-${idx}`),
          },
          body: JSON.stringify({ eventId: effectiveEventId, seatCount: 1 }),
        });
        const data = await res.json().catch(() => ({}));
        return {
          worker: idx + 1,
          status: res.status,
          detail:
            res.status === 201
              ? `Booked (left: ${data.availableSeats ?? "?"})`
              : data.error || `HTTP ${res.status}`,
        };
      });

      const outcomes = await Promise.all(requests);
      const elapsedMs = Math.round(performance.now() - started);

      setSummary({
        mode: "race",
        elapsedMs,
        booked: outcomes.filter((o) => o.status === 201).length,
        conflicts: outcomes.filter((o) => o.status === 409).length,
        replays: 0,
        errors: outcomes.filter((o) => o.status >= 500).length,
        outcomes,
      });

      await onDataChanged();
    } finally {
      setRunning(false);
    }
  };

  const runIdempotencyReplay = async () => {
    if (!user) {
      onRequireAuth();
      return;
    }
    if (!effectiveEventId) return;

    setRunning(true);
    const started = performance.now();
    const sharedKey = createKey("web-idem");

    try {
      const outcomes: WorkerOutcome[] = [];
      let replays = 0;

      for (let attempt = 1; attempt <= 2; attempt++) {
        const res = await fetch("/api/bookings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": sharedKey,
          },
          body: JSON.stringify({ eventId: effectiveEventId, seatCount: 1 }),
        });
        const data = await res.json().catch(() => ({}));
        if (data.idempotentReplay) replays += 1;

        outcomes.push({
          worker: attempt,
          status: res.status,
          detail: data.idempotentReplay
            ? `Replayed cached booking ${String(data.booking?.id ?? "").slice(0, 8)} (no double charge)`
            : res.status === 201
              ? `Created booking ${String(data.booking?.id ?? "").slice(0, 8)}`
              : data.error || `HTTP ${res.status}`,
        });
      }

      setSummary({
        mode: "idempotency",
        elapsedMs: Math.round(performance.now() - started),
        booked: outcomes.filter((o) => o.status === 201).length,
        conflicts: outcomes.filter((o) => o.status === 409).length,
        replays,
        errors: outcomes.filter((o) => o.status >= 500).length,
        outcomes,
      });

      await onDataChanged();
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">
            ACID Concurrency & Idempotency Lab
          </h2>
          <p className="mt-1 text-xs text-zinc-400">
            Fire 10 simultaneous booking requests via{" "}
            <code className="text-emerald-400">Promise.all()</code> against
            PostgreSQL{" "}
            <code className="text-emerald-400">SELECT ... FOR UPDATE</code>{" "}
            row locks to prove zero overselling.
          </p>
        </div>
        {selectedEvent && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2 text-xs">
            <span className="text-zinc-400">Current Inventory: </span>
            <span className="font-mono text-base font-bold text-emerald-400">
              {selectedEvent.availableSeats} / {selectedEvent.totalSeats}
            </span>
            <span className="text-zinc-400"> seats</span>
          </div>
        )}
      </div>

      {events.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-6 text-center text-xs text-zinc-400">
          Create an event in the Organizer Console first (try 2 or 3 seats) to
          stress-test row-level locking.
        </div>
      ) : (
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <select
            value={effectiveEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
            disabled={running}
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
          >
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.title} — {ev.availableSeats}/{ev.totalSeats} seats left
              </option>
            ))}
          </select>

          <button
            onClick={runConcurrentRace}
            disabled={running}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-rose-500 disabled:opacity-50"
          >
            <Flame className="h-4 w-4" />
            {running ? "Running..." : "Fire 10x Concurrent Race"}
          </button>

          <button
            onClick={runIdempotencyReplay}
            disabled={running}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-2.5 text-xs font-semibold text-zinc-100 transition hover:border-zinc-500 disabled:opacity-50"
          >
            <RefreshCw className="h-4 w-4" />
            Test 2x Idempotent Retry
          </button>
        </div>
      )}

      {summary && (
        <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
              <div className="text-[11px] text-emerald-300">201 Booked</div>
              <div className="mt-1 font-mono text-2xl font-bold text-emerald-400">
                {summary.booked}
              </div>
            </div>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <div className="text-[11px] text-amber-300">
                {summary.mode === "race" ? "409 Blocked (Sold Out)" : "200 Replayed"}
              </div>
              <div className="mt-1 font-mono text-2xl font-bold text-amber-300">
                {summary.mode === "race" ? summary.conflicts : summary.replays}
              </div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
              <div className="text-[11px] text-zinc-400">5xx Errors</div>
              <div className="mt-1 font-mono text-2xl font-bold text-white">
                {summary.errors}
              </div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
              <div className="text-[11px] text-zinc-400">Total Elapsed</div>
              <div className="mt-1 font-mono text-2xl font-bold text-white">
                {summary.elapsedMs} ms
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {summary.outcomes.map((item) => {
              const ok = item.status === 201 || item.status === 200;
              return (
                <div
                  key={item.worker}
                  className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800/80 bg-zinc-900/50 px-3 py-2 font-mono text-xs"
                >
                  <span className="flex items-center gap-2 text-zinc-300">
                    {ok ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
                    )}
                    Req #{item.worker}
                  </span>
                  <span
                    className={
                      ok ? "text-emerald-400" : "text-amber-300"
                    }
                  >
                    [{item.status}] {item.detail}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}