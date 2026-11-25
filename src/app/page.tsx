"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Calendar,
  Flame,
  Lock,
  LogIn,
  LogOut,
  MapPin,
  PlusCircle,
  RefreshCw,
  Ticket,
  Trash2,
  Users,
} from "lucide-react";
import { AuthModal } from "@/components/AuthModal";
import { RaceLab } from "@/components/RaceLab";
import type { BookingItem, EventItem, SessionUser } from "@/types/slotlock";

type ActiveTab = "marketplace" | "bookings" | "organizer" | "racelab";

function formatPrice(cents: number): string {
  return cents === 0 ? "Free" : `$${(cents / 100).toFixed(2)}`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

function defaultEventDateInput(): string {
  const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T18:00`;
}

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `slotlock-${crypto.randomUUID()}`;
  }
  return `slotlock-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function SlotLockPage() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [bookings, setBookings] = useState<BookingItem[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab>("marketplace");
  const [authOpen, setAuthOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Organizer create-event form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [venue, setVenue] = useState("");
 const [eventDate, setEventDate] = useState("");
  const [priceDollars, setPriceDollars] = useState("25");
  const [totalSeats, setTotalSeats] = useState("5");
  const [creatingEvent, setCreatingEvent] = useState(false);

  const loadEvents = useCallback(async () => {
    const res = await fetch("/api/events", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setEvents(data.events ?? []);
    }
  }, []);

  const loadBookings = useCallback(async () => {
    const res = await fetch("/api/bookings", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setBookings(data.bookings ?? []);
    } else {
      setBookings([]);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadEvents(), loadBookings()]);
  }, [loadEvents, loadBookings]);

  useEffect(() => {
  let active = true;
  setEventDate(defaultEventDateInput());
  void (async () => {
      try {
        const [meRes, evRes] = await Promise.all([
          fetch("/api/auth/me", { cache: "no-store" }),
          fetch("/api/events", { cache: "no-store" }),
        ]);

        if (!active) return;

        if (evRes.ok) {
          const evData = await evRes.json();
          setEvents(evData.events ?? []);
        }

        if (meRes.ok) {
          const meData = await meRes.json();
          setUser(meData.user ?? null);
          const bkRes = await fetch("/api/bookings", { cache: "no-store" });
          if (active && bkRes.ok) {
            const bkData = await bkRes.json();
            setBookings(bkData.bookings ?? []);
          }
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const notify = (type: "success" | "error", text: string) => {
    setToast({ type, text });
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setBookings([]);
    notify("success", "Signed out.");
  };

  const handleBookSeat = async (eventId: string, seatCount: number) => {
    if (!user) {
      setAuthOpen(true);
      return;
    }
    setBusyId(eventId);
    setToast(null);

    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": createIdempotencyKey(),
        },
        body: JSON.stringify({ eventId, seatCount }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Booking failed.");
      }
      notify(
        "success",
        `Booked ${seatCount} seat${seatCount > 1 ? "s" : ""} atomically (${data.availableSeats} remaining).`
      );
      await refreshAll();
    } catch (err) {
      notify(
        "error",
        err instanceof Error ? err.message : "Booking failed."
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleCancelBooking = async (bookingId: string) => {
    setBusyId(bookingId);
    setToast(null);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/cancel`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Cancellation failed.");
      }
      notify(
        "success",
        `Booking cancelled. Inventory restored (${data.availableSeats} seats now available).`
      );
      await refreshAll();
    } catch (err) {
      notify(
        "error",
        err instanceof Error ? err.message : "Cancellation failed."
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingEvent(true);
    setToast(null);

    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          venue,
          eventDate: new Date(eventDate).toISOString(),
          priceCents: Math.max(0, Math.round(Number(priceDollars) * 100)),
          totalSeats: Number(totalSeats),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const firstDetail = data.details?.[0]?.message;
        throw new Error(firstDetail || data.error || "Failed to create event.");
      }

      setTitle("");
      setDescription("");
      setVenue("");
      setTotalSeats("5");
      notify("success", `Published "${data.event.title}" with ${data.event.totalSeats} seats.`);
      await loadEvents();
      setActiveTab("marketplace");
    } catch (err) {
      notify(
        "error",
        err instanceof Error ? err.message : "Failed to create event."
      );
    } finally {
      setCreatingEvent(false);
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    setBusyId(eventId);
    setToast(null);
    try {
      const res = await fetch(`/api/events/${eventId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete event.");
      }
      notify("success", "Event deleted.");
      await refreshAll();
    } catch (err) {
      notify(
        "error",
        err instanceof Error ? err.message : "Failed to delete event."
      );
    } finally {
      setBusyId(null);
    }
  };

  const myEvents = user
    ? events.filter((ev) => ev.organizerId === user.id)
    : [];

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="flex flex-col gap-4 border-b border-zinc-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-emerald-400" />
              <h1 className="text-2xl font-bold tracking-tight text-white">
                SLOTLOCK
              </h1>
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                ACID Row Locking
              </span>
            </div>
            <p className="mt-1 text-sm text-zinc-400">
              High-concurrency event booking powered by PostgreSQL{" "}
              <code className="text-zinc-200">SELECT ... FOR UPDATE</code> &
              idempotent transactions
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={refreshAll}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:border-zinc-600"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>

            {user ? (
              <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs">
                <div>
                  <span className="font-semibold text-white">{user.name}</span>
                  <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                    {user.role}
                  </span>
                </div>
                <button
                  onClick={handleLogout}
                  title="Sign out"
                  className="ml-1 rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAuthOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-emerald-400"
              >
                <LogIn className="h-3.5 w-3.5" />
                Sign In / Register
              </button>
            )}
          </div>
        </header>

        {/* Navigation Tabs */}
        <nav className="flex flex-wrap gap-2">
          {(
            [
              ["marketplace", "Events Marketplace", Ticket],
              ["bookings", `My Bookings (${bookings.length})`, Users],
              ["organizer", "Organizer Console", PlusCircle],
              ["racelab", "10x Race Lab", Flame],
            ] as const
          ).map(([tabId, label, Icon]) => (
            <button
              key={tabId}
              onClick={() => setActiveTab(tabId)}
              className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold transition ${
                activeTab === tabId
                  ? "border-zinc-200 bg-zinc-100 text-zinc-950"
                  : "border-zinc-800 bg-zinc-900/70 text-zinc-300 hover:border-zinc-700 hover:text-white"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </nav>

        {toast && (
          <div
            className={`rounded-xl border px-4 py-3 text-xs font-medium ${
              toast.type === "success"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-rose-500/40 bg-rose-500/10 text-rose-300"
            }`}
          >
            {toast.text}
          </div>
        )}

        {/* TAB 1: MARKETPLACE */}
        {activeTab === "marketplace" && (
          <section>
            {loading ? (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-10 text-center text-sm text-zinc-400">
                Loading live inventory from Neon PostgreSQL...
              </div>
            ) : events.length === 0 ? (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-10 text-center">
                <p className="text-sm font-medium text-zinc-200">
                  No events published yet.
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  Register as an ORGANIZER and create your first event in the
                  Organizer Console.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
                {events.map((ev) => {
                  const pct =
                    ev.totalSeats > 0
                      ? Math.round((ev.availableSeats / ev.totalSeats) * 100)
                      : 0;
                  const soldOut = ev.availableSeats <= 0;

                  return (
                    <article
                      key={ev.id}
                      className="flex flex-col justify-between rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-3">
                          <h2 className="text-base font-bold text-white">
                            {ev.title}
                          </h2>
                          <span className="shrink-0 rounded-lg bg-zinc-800 px-2.5 py-1 font-mono text-xs font-semibold text-emerald-400">
                            {formatPrice(ev.priceCents)}
                          </span>
                        </div>

                        <p className="mt-2 line-clamp-2 text-xs text-zinc-400">
                          {ev.description}
                        </p>

                        <div className="mt-4 space-y-1.5 text-xs text-zinc-400">
                          <div className="flex items-center gap-2">
                            <MapPin className="h-3.5 w-3.5 text-zinc-500" />
                            <span>{ev.venue}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Calendar className="h-3.5 w-3.5 text-zinc-500" />
                            <span>{formatDate(ev.eventDate)}</span>
                          </div>
                        </div>

                        {/* Seat Bar */}
                        <div className="mt-4">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-zinc-400">
                              Available Seats
                            </span>
                            <span
                              className={`font-mono font-bold ${
                                soldOut ? "text-rose-400" : "text-emerald-400"
                              }`}
                            >
                              {ev.availableSeats} / {ev.totalSeats}
                            </span>
                          </div>
                          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                            <div
                              className={`h-full transition-all ${
                                soldOut ? "bg-rose-500" : "bg-emerald-500"
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 flex items-center gap-2 border-t border-zinc-800 pt-4">
                        <button
                          onClick={() => handleBookSeat(ev.id, 1)}
                          disabled={soldOut || busyId === ev.id}
                          className="flex-1 rounded-lg bg-emerald-500 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
                        >
                          {soldOut
                            ? "Sold Out"
                            : busyId === ev.id
                              ? "Locking..."
                              : "Book 1 Seat"}
                        </button>
                        <button
                          onClick={() => handleBookSeat(ev.id, 2)}
                          disabled={ev.availableSeats < 2 || busyId === ev.id}
                          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          +2
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* TAB 2: MY BOOKINGS */}
        {activeTab === "bookings" && (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
            <h2 className="text-lg font-bold text-white">My Bookings</h2>
            {!user ? (
              <p className="mt-3 text-xs text-zinc-400">
                Sign in to inspect your confirmed tickets and test atomic
                seat-restoring cancellations.
              </p>
            ) : bookings.length === 0 ? (
              <p className="mt-3 text-xs text-zinc-400">
                No bookings yet. Reserve a seat in the Events Marketplace or
                run the 10x Race Lab.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {bookings.map((bk) => (
                  <div
                    key={bk.id}
                    className="flex flex-col justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4 sm:flex-row sm:items-center"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white">
                          {bk.eventTitle}
                        </span>
                        <span
                          className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold ${
                            bk.status === "CONFIRMED"
                              ? "bg-emerald-500/15 text-emerald-400"
                              : "bg-zinc-800 text-zinc-400"
                          }`}
                        >
                          {bk.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-zinc-400">
                        {bk.seatCount} seat{bk.seatCount > 1 ? "s" : ""} •{" "}
                        {formatPrice(bk.totalCents)} • {bk.eventVenue}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-zinc-500">
                        Idempotency-Key: {bk.idempotencyKey}
                      </p>
                    </div>

                    {bk.status === "CONFIRMED" && (
                      <button
                        onClick={() => handleCancelBooking(bk.id)}
                        disabled={busyId === bk.id}
                        className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3.5 py-2 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-50"
                      >
                        {busyId === bk.id
                          ? "Cancelling..."
                          : "Cancel & Restore Seat"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* TAB 3: ORGANIZER CONSOLE */}
        {activeTab === "organizer" && (
          <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
              <h2 className="text-lg font-bold text-white">
                Publish New Event
              </h2>
              {!user || user.role !== "ORGANIZER" ? (
                <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200">
                  RBAC Guard: Only accounts with the{" "}
                  <span className="font-mono font-bold">ORGANIZER</span> role
                  can create or delete events.{" "}
                  {!user && (
                    <button
                      onClick={() => setAuthOpen(true)}
                      className="ml-1 underline"
                    >
                      Register an Organizer account.
                    </button>
                  )}
                </div>
              ) : (
                <form onSubmit={handleCreateEvent} className="mt-4 space-y-3.5">
                  <div>
                    <label className="mb-1 block text-xs text-zinc-300">
                      Event Title
                    </label>
                    <input
                      type="text"
                      required
                      minLength={3}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Distributed Systems Live Workshop"
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs text-zinc-300">
                      Description
                    </label>
                    <textarea
                      required
                      minLength={10}
                      rows={3}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Deep dive into PostgreSQL row-level locking, isolation levels, and idempotency keys."
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs text-zinc-300">
                        Venue
                      </label>
                      <input
                        type="text"
                        required
                        minLength={2}
                        value={venue}
                        onChange={(e) => setVenue(e.target.value)}
                        placeholder="Main Auditorium"
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-zinc-300">
                        Date & Time
                      </label>
                      <input
                        type="datetime-local"
                        required
                        value={eventDate}
                        onChange={(e) => setEventDate(e.target.value)}
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs text-zinc-300">
                        Ticket Price (USD)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        required
                        value={priceDollars}
                        onChange={(e) => setPriceDollars(e.target.value)}
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-zinc-300">
                        Total Seats
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={10000}
                        required
                        value={totalSeats}
                        onChange={(e) => setTotalSeats(e.target.value)}
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={creatingEvent}
                    className="w-full rounded-lg bg-emerald-500 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
                  >
                    {creatingEvent ? "Publishing..." : "Publish Event"}
                  </button>
                </form>
              )}
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
              <h2 className="text-lg font-bold text-white">
                Your Managed Events
              </h2>
              {myEvents.length === 0 ? (
                <p className="mt-4 text-xs text-zinc-400">
                  Events you publish as an organizer will appear here with
                  ownership-protected delete controls.
                </p>
              ) : (
                <div className="mt-4 space-y-3">
                  {myEvents.map((ev) => (
                    <div
                      key={ev.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4"
                    >
                      <div>
                        <div className="text-sm font-semibold text-white">
                          {ev.title}
                        </div>
                        <div className="mt-1 font-mono text-xs text-zinc-400">
                          {ev.availableSeats}/{ev.totalSeats} seats left •{" "}
                          {formatPrice(ev.priceCents)}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteEvent(ev.id)}
                        disabled={busyId === ev.id}
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* TAB 4: 10X RACE LAB */}
        {activeTab === "racelab" && (
          <RaceLab
            events={events}
            user={user}
            onRequireAuth={() => setAuthOpen(true)}
            onDataChanged={refreshAll}
          />
        )}
      </div>

      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onAuthenticated={(signedInUser) => {
          setUser(signedInUser);
          void refreshAll();
          notify(
            "success",
            `Signed in as ${signedInUser.name} (${signedInUser.role}).`
          );
        }}
      />
    </main>
  );
}