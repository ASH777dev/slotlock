import crypto from "node:crypto";

const BASE_URL = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const ts = Date.now();

function extractCookie(res) {
  const cookies = res.headers.getSetCookie?.() ?? [];
  if (cookies.length > 0) return cookies[0].split(";")[0];
  const raw = res.headers.get("set-cookie");
  return raw ? raw.split(";")[0] : "";
}

async function jsonFetch(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, options);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, cookie: extractCookie(res) };
}

async function main() {
  console.log(`\n=== SlotLock ACID Concurrency & Idempotency Test (${BASE_URL}) ===`);

  // 1. Register Organizer & create a 3-seat event
  const orgReg = await jsonFetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Race Organizer",
      email: `race_org_${ts}@slotlock.dev`,
      password: "Password123!",
      role: "ORGANIZER",
    }),
  });
  if (orgReg.status !== 201) throw new Error(`Org register failed: ${JSON.stringify(orgReg.data)}`);

  const evRes = await jsonFetch("/api/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: orgReg.cookie,
    },
    body: JSON.stringify({
      title: `Concurrency Stress Concert ${ts}`,
      description: "Automated test proving SELECT FOR UPDATE prevents double-booking.",
      venue: "Test Arena",
      eventDate: "2026-12-30T18:00:00Z",
      priceCents: 2500,
      totalSeats: 3,
    }),
  });
  if (evRes.status !== 201) throw new Error(`Event create failed: ${JSON.stringify(evRes.data)}`);
  const eventId = evRes.data.event.id;
  console.log(`1. Created 3-seat event: ${eventId}`);

  // 2. Register Attendee
  const attReg = await jsonFetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Race Attendee",
      email: `race_att_${ts}@slotlock.dev`,
      password: "Password123!",
      role: "ATTENDEE",
    }),
  });
  if (attReg.status !== 201) throw new Error(`Attendee register failed: ${JSON.stringify(attReg.data)}`);
  const attCookie = attReg.cookie;

  // 3. Test Idempotency (same key twice should book only 1 seat)
  const sharedKey = `idem-test-${crypto.randomUUID()}`;
  const firstBook = await jsonFetch("/api/bookings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: attCookie,
      "Idempotency-Key": sharedKey,
    },
    body: JSON.stringify({ eventId, seatCount: 1 }),
  });
  const replayBook = await jsonFetch("/api/bookings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: attCookie,
      "Idempotency-Key": sharedKey,
    },
    body: JSON.stringify({ eventId, seatCount: 1 }),
  });

  const idempotencyPassed =
    firstBook.status === 201 &&
    replayBook.status === 200 &&
    replayBook.data.idempotentReplay === true &&
    firstBook.data.booking.id === replayBook.data.booking.id;
  console.log(
    `2. Idempotency Test : ${idempotencyPassed ? "PASSED" : "FAILED"} (first=${firstBook.status}, replay=${replayBook.status})`
  );

  // 4. Test 10x Race Condition against the 2 remaining seats
  const raceCalls = Array.from({ length: 10 }, (_, idx) =>
    jsonFetch("/api/bookings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: attCookie,
        "Idempotency-Key": `race-${ts}-${idx}-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({ eventId, seatCount: 1 }),
    })
  );
  const raceResults = await Promise.all(raceCalls);
  const created = raceResults.filter((r) => r.status === 201).length;
  const conflicts = raceResults.filter((r) => r.status === 409).length;
  const errors = raceResults.filter((r) => r.status >= 500).length;

  const afterRace = await jsonFetch(`/api/events/${eventId}`);
  const seatsAfterRace = afterRace.data.event.availableSeats;
  const racePassed =
    created === 2 && conflicts === 8 && errors === 0 && seatsAfterRace === 0;
  console.log(
    `3. 10x Race Test    : ${racePassed ? "PASSED" : "FAILED"} (201=${created}, 409=${conflicts}, 5xx=${errors}, seatsLeft=${seatsAfterRace})`
  );

  // 5. Test Concurrent Double-Cancellation (should restore exactly 1 seat, not 2)
  const bookingId = firstBook.data.booking.id;
  const cancelResults = await Promise.all([
    jsonFetch(`/api/bookings/${bookingId}/cancel`, {
      method: "POST",
      headers: { Cookie: attCookie },
    }),
    jsonFetch(`/api/bookings/${bookingId}/cancel`, {
      method: "POST",
      headers: { Cookie: attCookie },
    }),
  ]);
  const cancelOk = cancelResults.filter((r) => r.status === 200).length;
  const cancelConflict = cancelResults.filter((r) => r.status === 409).length;

  const afterCancel = await jsonFetch(`/api/events/${eventId}`);
  const seatsAfterCancel = afterCancel.data.event.availableSeats;
  const cancelPassed =
    cancelOk === 1 && cancelConflict === 1 && seatsAfterCancel === 1;
  console.log(
    `4. Double-Cancel    : ${cancelPassed ? "PASSED" : "FAILED"} (200=${cancelOk}, 409=${cancelConflict}, seatsLeft=${seatsAfterCancel})`
  );

  const allPassed = idempotencyPassed && racePassed && cancelPassed;
  console.log(`\nOVERALL ACID VERIFICATION: ${allPassed ? "ALL PASSED" : "CHECK FAILURES"}\n`);
  if (!allPassed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});