import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["ATTENDEE", "ORGANIZER"]);
export const bookingStatusEnum = pgEnum("booking_status", [
  "CONFIRMED",
  "CANCELLED",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").default("ATTENDEE").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizerId: uuid("organizer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    venue: text("venue").notNull(),
    eventDate: timestamp("event_date", { withTimezone: true }).notNull(),
    priceCents: integer("price_cents").notNull(),
    totalSeats: integer("total_seats").notNull(),
    availableSeats: integer("available_seats").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("events_organizer_idx").on(table.organizerId),
    index("events_date_idx").on(table.eventDate),
  ]
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seatCount: integer("seat_count").notNull(),
    totalCents: integer("total_cents").notNull(),
    status: bookingStatusEnum("status").default("CONFIRMED").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("bookings_user_idx").on(table.userId),
    index("bookings_event_idx").on(table.eventId),
  ]
);

export type User = typeof users.$inferSelect;
export type Event = typeof events.$inferSelect;
export type Booking = typeof bookings.$inferSelect;