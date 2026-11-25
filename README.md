# SlotLock — High-Concurrency Event & Seat Booking Platform

[![SlotLock CI](https://github.com/ASH777dev/slotlock/actions/workflows/ci.yml/badge.svg)](https://github.com/ASH777dev/slotlock/actions/workflows/ci.yml)

A full-stack event booking engine built with **Next.js (App Router)**, **TypeScript**, **Drizzle ORM**, and **Neon PostgreSQL**, engineered to prevent double-booking under burst concurrency using **PostgreSQL pessimistic row-level locking (`SELECT ... FOR UPDATE`)**, **idempotency keys**, and **RBAC**.

- **Live Application:** [https://slotlock-lovat.vercel.app](https://slotlock-lovat.vercel.app)
- **Health Endpoint:** [https://slotlock-lovat.vercel.app/api/health](https://slotlock-lovat.vercel.app/api/health)
- **Interactive Stress Test:** Open the **10x Race Lab** tab in the live app to fire 10 simultaneous booking requests against a live event directly from the browser.

---

## ACID Transaction & Locking Flow

```mermaid
sequenceDiagram
    participant C as 10x Concurrent Clients
    participant API as Next.js Route Handler
    participant PG as Neon PostgreSQL (pg.Pool)

    C->>API: POST /api/bookings (HttpOnly JWT + Idempotency-Key)
    API->>API: Verify HS256 JWT + Validate payload (Zod)
    API->>PG: BEGIN TRANSACTION
    API->>PG: Check bookings.idempotency_key (return cached row on retry)
    API->>PG: SELECT * FROM events WHERE id = $1 FOR UPDATE
    Note over PG: Row lock serializes concurrent buyers
    alt available_seats >= seat_count
        API->>PG: UPDATE events SET available_seats = available_seats - seat_count
        API->>PG: INSERT INTO bookings (status = 'CONFIRMED')
        API->>PG: COMMIT
        API-->>C: 201 Created
    else insufficient seats
        API->>PG: ROLLBACK
        API-->>C: 409 Conflict (Sold Out)
    end
```

---

## Key Engineering Decisions

| Challenge | Design Choice | Why It Matters |
| :--- | :--- | :--- |
| **Overselling under race conditions** | PostgreSQL `SELECT ... FOR UPDATE` inside `db.transaction()` via `pg.Pool` | Serializes competing writes on the target event row so remaining seat counts can never drop below zero. |
| **Duplicate bookings on retries** | Required `Idempotency-Key` header + `UNIQUE` DB constraint (`23505` handler) | Replays the original confirmed booking (`200 OK`) instead of double-charging or decrementing inventory twice. |
| **Double seat restoration on cancel** | Row locks on both `bookings` and parent `events` inside `/cancel` | Prevents concurrent cancellation clicks from restoring seats more than once. |
| **Session security & RBAC** | `bcryptjs` password hashing + `jose` HS256 JWT in `HttpOnly` cookies | Protects tokens from XSS while enforcing `ORGANIZER` vs. `ATTENDEE` permissions and event ownership checks. |

---

## Production Verification Results

Executed via `node scripts/race_test.mjs https://slotlock-lovat.vercel.app` against the live Vercel + Neon PostgreSQL deployment:

| Verification Check | Scenario | Production Result |
| :--- | :--- | :--- |
| **Idempotent Retry Safety** | Same `Idempotency-Key` submitted twice | **PASSED** (`201` created, `200` cached replay, same booking ID) |
| **10x Concurrent Booking Race** | 10 simultaneous requests competing for 2 remaining seats | **PASSED** (`201=2`, `409=8`, `5xx=0`, `seatsLeft=0`) |
| **Concurrent Double-Cancel** | 2 simultaneous cancel calls on the same booking | **PASSED** (`200=1`, `409=1`, `seatsLeft=1`) |

---

## API Reference

| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | Public | Verifies Neon PostgreSQL pool connectivity |
| `POST` | `/api/auth/register` | Public | Registers `ATTENDEE` or `ORGANIZER` and sets `HttpOnly` JWT cookie |
| `POST` | `/api/auth/login` | Public | Authenticates credentials via `bcryptjs` and issues session cookie |
| `POST` | `/api/auth/logout` | Public | Clears the session cookie |
| `GET` | `/api/auth/me` | Authenticated | Returns the active session user |
| `GET` / `POST` | `/api/events` | Public / `ORGANIZER` | Lists events or publishes a new event |
| `GET` / `PATCH` / `DELETE` | `/api/events/[id]` | Public / Owner | Fetches, updates, or deletes an organizer's event |
| `GET` / `POST` | `/api/bookings` | Authenticated | Lists user bookings or executes an ACID idempotent seat booking |
| `POST` | `/api/bookings/[id]/cancel` | Booking Owner | Atomically cancels a booking and restores seat inventory |

---

## Local Setup

```bash
git clone [https://github.com/ASH777dev/slotlock.git](https://github.com/ASH777dev/slotlock.git)
cd slotlock
npm install
```

Create `.env.local`:

```env
DATABASE_URL=postgresql://user:password@your-neon-pooler-host/neondb?sslmode=require
JWT_SECRET=your-64-character-hex-secret
```

Push schema, run locally, and execute the ACID concurrency suite:

```bash
npx drizzle-kit push
npm run dev
node scripts/race_test.mjs
```