import { desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { bookings, events } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import {
  createBookingSchema,
  formatZodError,
  idempotencyKeySchema,
} from "@/lib/validators";

class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 }
    );
  }

  try {
    const rows = await db
      .select({
        id: bookings.id,
        eventId: bookings.eventId,
        seatCount: bookings.seatCount,
        totalCents: bookings.totalCents,
        status: bookings.status,
        idempotencyKey: bookings.idempotencyKey,
        createdAt: bookings.createdAt,
        eventTitle: events.title,
        eventVenue: events.venue,
        eventDate: events.eventDate,
      })
      .from(bookings)
      .innerJoin(events, eq(bookings.eventId, events.id))
      .where(eq(bookings.userId, user.id))
      .orderBy(desc(bookings.createdAt));

    return NextResponse.json({ bookings: rows }, { status: 200 });
  } catch (error) {
    console.error("[bookings GET] error:", error);
    return NextResponse.json(
      { error: "Failed to load bookings." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 }
    );
  }

  const keyCheck = idempotencyKeySchema.safeParse(
    request.headers.get("idempotency-key") ?? ""
  );
  if (!keyCheck.success) {
    return NextResponse.json(
      {
        error: "Missing or invalid Idempotency-Key header.",
        details: formatZodError(keyCheck.error),
      },
      { status: 400 }
    );
  }
  const idempotencyKey = keyCheck.data;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const parsed = createBookingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: formatZodError(parsed.error) },
      { status: 400 }
    );
  }

  const { eventId, seatCount } = parsed.data;

  try {
    const result = await db.transaction(async (tx) => {
      // 1. Check for an existing booking with the same idempotency key
      const [existing] = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.idempotencyKey, idempotencyKey))
        .limit(1);

      if (existing) {
        if (existing.userId !== user.id) {
          throw new HttpError(
            409,
            "Idempotency key is already bound to another account."
          );
        }
        return { booking: existing, idempotentReplay: true };
      }

      // 2. Lock the event row with SELECT ... FOR UPDATE so concurrent buyers wait
      const [lockedEvent] = await tx
        .select()
        .from(events)
        .where(eq(events.id, eventId))
        .for("update");

      if (!lockedEvent) {
        throw new HttpError(404, "Event not found.");
      }

      if (lockedEvent.availableSeats < seatCount) {
        throw new HttpError(
          409,
          `Sold out or insufficient seats (${lockedEvent.availableSeats} remaining).`
        );
      }

      // 3. Atomically decrement inventory and insert the confirmed booking
      const [updatedEvent] = await tx
        .update(events)
        .set({
          availableSeats: sql`${events.availableSeats} - ${seatCount}`,
        })
        .where(eq(events.id, eventId))
        .returning({ availableSeats: events.availableSeats });

      const [createdBooking] = await tx
        .insert(bookings)
        .values({
          eventId,
          userId: user.id,
          seatCount,
          totalCents: lockedEvent.priceCents * seatCount,
          status: "CONFIRMED",
          idempotencyKey,
        })
        .returning();

      return {
        booking: createdBooking,
        availableSeats: updatedEvent.availableSeats,
        idempotentReplay: false,
      };
    });

    return NextResponse.json(result, {
      status: result.idempotentReplay ? 200 : 201,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    // Handle simultaneous duplicate idempotency-key race (PostgreSQL 23505)
    const pgError = error as { code?: string; cause?: { code?: string } };
    const pgCode = pgError?.code ?? pgError?.cause?.code;
    if (pgCode === "23505") {
      const [replayed] = await db
        .select()
        .from(bookings)
        .where(eq(bookings.idempotencyKey, idempotencyKey))
        .limit(1);

      if (replayed && replayed.userId === user.id) {
        return NextResponse.json(
          { booking: replayed, idempotentReplay: true },
          { status: 200 }
        );
      }
    }

    console.error("[bookings POST] error:", error);
    return NextResponse.json(
      { error: "Booking transaction failed." },
      { status: 500 }
    );
  }
}