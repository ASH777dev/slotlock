import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { bookings, events } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { uuidSchema } from "@/lib/validators";

class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 }
    );
  }

  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json(
      { error: "Invalid booking ID." },
      { status: 400 }
    );
  }

  try {
    const result = await db.transaction(async (tx) => {
      // 1. Lock the booking row to prevent concurrent double-cancellations
      const [lockedBooking] = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.id, id))
        .for("update");

      if (!lockedBooking) {
        throw new HttpError(404, "Booking not found.");
      }

      if (lockedBooking.userId !== user.id) {
        throw new HttpError(
          403,
          "Forbidden: you can only cancel your own bookings."
        );
      }

      if (lockedBooking.status === "CANCELLED") {
        throw new HttpError(409, "Booking is already cancelled.");
      }

      // 2. Lock the parent event row and restore seats atomically
      const [lockedEvent] = await tx
        .select()
        .from(events)
        .where(eq(events.id, lockedBooking.eventId))
        .for("update");

      const [cancelledBooking] = await tx
        .update(bookings)
        .set({ status: "CANCELLED" })
        .where(eq(bookings.id, id))
        .returning();

      let updatedSeats: number | null = null;
      if (lockedEvent) {
        const [updatedEvent] = await tx
          .update(events)
          .set({
            availableSeats: sql`${events.availableSeats} + ${lockedBooking.seatCount}`,
          })
          .where(eq(events.id, lockedBooking.eventId))
          .returning({ availableSeats: events.availableSeats });
        updatedSeats = updatedEvent.availableSeats;
      }

      return {
        booking: cancelledBooking,
        availableSeats: updatedSeats,
      };
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    console.error("[bookings cancel] error:", error);
    return NextResponse.json(
      { error: "Failed to cancel booking." },
      { status: 500 }
    );
  }
}