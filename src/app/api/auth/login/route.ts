import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  setSessionCookie,
  signSessionToken,
  verifyPassword,
} from "@/lib/auth";
import { formatZodError, loginSchema } from "@/lib/validators";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: formatZodError(parsed.error) },
        { status: 400 }
      );
    }

    const { email, password } = parsed.data;
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    const sessionUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };

    const token = await signSessionToken(sessionUser);
    await setSessionCookie(token);

    return NextResponse.json({ user: sessionUser }, { status: 200 });
  } catch (error) {
    console.error("[auth/login] error:", error);
    return NextResponse.json(
      { error: "Failed to log in." },
      { status: 500 }
    );
  }
}