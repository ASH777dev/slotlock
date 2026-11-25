export type UserRole = "ATTENDEE" | "ORGANIZER";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface EventItem {
  id: string;
  title: string;
  description: string;
  venue: string;
  eventDate: string;
  priceCents: number;
  totalSeats: number;
  availableSeats: number;
  createdAt: string;
  organizerId: string;
  organizerName: string;
}

export interface BookingItem {
  id: string;
  eventId: string;
  seatCount: number;
  totalCents: number;
  status: "CONFIRMED" | "CANCELLED";
  idempotencyKey: string;
  createdAt: string;
  eventTitle: string;
  eventVenue: string;
  eventDate: string;
}