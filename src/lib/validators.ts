import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  email: z.string().trim().email("Invalid email address").toLowerCase(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be at most 72 characters"),
  role: z.enum(["ATTENDEE", "ORGANIZER"]).default("ATTENDEE"),
});

export const loginSchema = z.object({
  email: z.string().trim().email("Invalid email address").toLowerCase(),
  password: z.string().min(1, "Password is required"),
});

export const createEventSchema = z.object({
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(120),
  description: z
    .string()
    .trim()
    .min(10, "Description must be at least 10 characters")
    .max(2000),
  venue: z.string().trim().min(2, "Venue is required").max(160),
  eventDate: z.coerce.date().refine((d) => !Number.isNaN(d.getTime()), {
    message: "Valid ISO date string is required",
  }),
  priceCents: z.number().int().min(0, "Price cannot be negative").max(10_000_000),
  totalSeats: z.number().int().min(1, "Must have at least 1 seat").max(10_000),
});

export const updateEventSchema = z
  .object({
    title: z.string().trim().min(3).max(120).optional(),
    description: z.string().trim().min(10).max(2000).optional(),
    venue: z.string().trim().min(2).max(160).optional(),
    eventDate: z.coerce
      .date()
      .refine((d) => !Number.isNaN(d.getTime()), {
        message: "Valid ISO date string is required",
      })
      .optional(),
    priceCents: z.number().int().min(0).max(10_000_000).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update",
  });

export const uuidSchema = z.string().uuid("Invalid event ID format");

export function formatZodError(error: z.ZodError) {
  return error.issues.map((issue) => ({
    field: issue.path.join(".") || "body",
    message: issue.message,
  }));
}