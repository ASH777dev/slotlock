import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { events, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import {
  formatZodError,
  updateEventSchema,
  uuidSchema,
} from "@/lib/validators";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid event ID." }, { status: 400 });
  }

  const [event] = await db
    .select({
      id: events.id,
      title: events.title,
      description: events.description,
      venue: events.venue,
      eventDate: events.eventDate,
      priceCents: events.priceCents,
      totalSeats: events.totalSeats,
      availableSeats: events.availableSeats,
      createdAt: events.createdAt,
      organizerId: events.organizerId,
      organizerName: users.name,
    })
    .from(events)
    .innerJoin(users, eq(events.organizerId, users.id))
    .where(eq(events.id, id))
    .limit(1);

  if (!event) {
    return NextResponse.json({ error: "Event not found." }, { status: 404 });
  }

  return NextResponse.json({ event }, { status: 200 });
}

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (user.role !== "ORGANIZER") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid event ID." }, { status: 400 });
  }

  const [existing] = await db
    .select()
    .from(events)
    .where(eq(events.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Event not found." }, { status: 404 });
  }
  if (existing.organizerId !== user.id) {
    return NextResponse.json(
      { error: "Forbidden: you can only edit events you created." },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const parsed = updateEventSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: formatZodError(parsed.error) },
        { status: 400 }
      );
    }

    const [updated] = await db
      .update(events)
      .set(parsed.data)
      .where(eq(events.id, id))
      .returning();

    return NextResponse.json({ event: updated }, { status: 200 });
  } catch (error) {
    console.error("[events PATCH] error:", error);
    return NextResponse.json(
      { error: "Failed to update event." },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (user.role !== "ORGANIZER") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid event ID." }, { status: 400 });
  }

  const [existing] = await db
    .select({ id: events.id, organizerId: events.organizerId })
    .from(events)
    .where(eq(events.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Event not found." }, { status: 404 });
  }
  if (existing.organizerId !== user.id) {
    return NextResponse.json(
      { error: "Forbidden: you can only delete events you created." },
      { status: 403 }
    );
  }

  await db.delete(events).where(eq(events.id, id));
  return NextResponse.json({ deletedId: id }, { status: 200 });
}