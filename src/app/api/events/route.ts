import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { events, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { createEventSchema, formatZodError } from "@/lib/validators";

export async function GET() {
  try {
    const rows = await db
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
      .orderBy(asc(events.eventDate));

    return NextResponse.json({ events: rows }, { status: 200 });
  } catch (error) {
    console.error("[events GET] error:", error);
    return NextResponse.json(
      { error: "Failed to load events." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (user.role !== "ORGANIZER") {
    return NextResponse.json(
      { error: "Forbidden: only ORGANIZER accounts can create events." },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const parsed = createEventSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: formatZodError(parsed.error) },
        { status: 400 }
      );
    }

    const { title, description, venue, eventDate, priceCents, totalSeats } =
      parsed.data;

    const [created] = await db
      .insert(events)
      .values({
        organizerId: user.id,
        title,
        description,
        venue,
        eventDate,
        priceCents,
        totalSeats,
        availableSeats: totalSeats,
      })
      .returning();

    return NextResponse.json({ event: created }, { status: 201 });
  } catch (error) {
    console.error("[events POST] error:", error);
    return NextResponse.json(
      { error: "Failed to create event." },
      { status: 500 }
    );
  }
}