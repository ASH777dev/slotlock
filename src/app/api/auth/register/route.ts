import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  hashPassword,
  setSessionCookie,
  signSessionToken,
} from "@/lib/auth";
import { formatZodError, registerSchema } from "@/lib/validators";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: formatZodError(parsed.error) },
        { status: 400 }
      );
    }

    const { name, email, password, role } = parsed.data;

    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(password);
    const [created] = await db
      .insert(users)
      .values({ name, email, passwordHash, role })
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
      });

    const token = await signSessionToken(created);
    await setSessionCookie(token);

    return NextResponse.json({ user: created }, { status: 201 });
  } catch (error) {
    console.error("[auth/register] error:", error);
    return NextResponse.json(
      { error: "Failed to register user." },
      { status: 500 }
    );
  }
}