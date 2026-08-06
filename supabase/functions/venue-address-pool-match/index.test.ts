// Issue #1648 — a venue we already hold must not be able to duplicate itself
// when the NAME search missed.
//
// THE GAP. Venue onboarding's gate searches the directory by NAME. When that
// misses — a trading name, a rename, a chain branch, or the brand pressing
// "Continue without a match" — they land in create-from-scratch, type the exact
// street address of a place we hold, and we ignore it. The strongest identity
// signal is collected AFTER the only moment it was used.
//
// WHY AN EXACT KEY. Measured on production: every existing venue has 2-18 active
// pool rows within ~130 m. Proximity returns a shortlist, never an identity.
// place_pool is already ~100% Google-keyed (88,362 of 88,367 active rows), so
// the key already existed on OUR side — it was missing on the brand's.
//
// FAILS-ON-REVERT: make resolveGooglePlaceId swallow a non-2xx and return null
// and T-05 fails. Drop the 0,0 guard and T-02 fails. Widen the field mask past
// `places.id` and T-06 fails.
//
// Run: deno test --allow-none supabase/functions/venue-address-pool-match/index.test.ts

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  checkRateLimit,
  matchResponseForRows,
  parseResolveInput,
  resolveGooglePlaceId,
} from "./index.ts";

const GOOD = {
  formatted_address: "2526 Hillsborough St #301, Raleigh, NC 27607, USA",
  lat: 35.7847,
  lng: -78.6821,
};

// ─── T-01 — a real pick parses ───────────────────────────────────────────────
Deno.test("T-01 #1648: a validated pick parses", () => {
  const r = parseResolveInput(GOOD);
  assert(!("error" in r), "a real picked address must parse");
  if ("error" in r) return;
  assertEquals(r.lat, 35.7847);
  assertEquals(r.lng, -78.6821);
});

// ─── T-02 — ADVERSARIAL: junk must never reach Google ─────────────────────────
// Every rejected shape here is one that would cost money and could return a
// same-named venue in ANOTHER CITY — the exact ambiguity this endpoint exists
// to remove. 0,0 is the null-island sentinel a failed geocode produces; it is
// never a real pick, and without the guard it would bias the search to the
// Atlantic and match nothing forever.
Deno.test("T-02 #1648 ADVERSARIAL: junk input never reaches Google", () => {
  const bad: unknown[] = [
    null,
    undefined,
    "string",
    {},
    { ...GOOD, lat: 0, lng: 0 }, // null island
    { ...GOOD, lat: undefined },
    { ...GOOD, lng: undefined },
    { ...GOOD, lat: "35.7" }, // string, not number
    { ...GOOD, lat: NaN },
    { ...GOOD, lat: 91 }, // out of range
    { ...GOOD, lng: -181 },
    { ...GOOD, formatted_address: "" },
    { ...GOOD, formatted_address: "   " },
    { ...GOOD, formatted_address: "abc" }, // under the 4-char floor
  ];
  for (const b of bad) {
    const r = parseResolveInput(b);
    assert(
      "error" in r,
      `${JSON.stringify(b)} must be rejected before any paid call`,
    );
  }
  // vacuity guard — an emptied list would make this assert nothing
  assertEquals(bad.length, 14);
});

// ─── T-03 — Google's answer becomes a place id ───────────────────────────────
Deno.test("T-03 #1648: a Google hit yields the place id", async () => {
  const fake = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ places: [{ id: "ChIJtest440club" }] }), {
        status: 200,
      }),
    )) as unknown as typeof fetch;
  const parsed = parseResolveInput(GOOD);
  assert(!("error" in parsed));
  if ("error" in parsed) return;
  assertEquals(await resolveGooglePlaceId(parsed, "k", fake), "ChIJtest440club");
});

// ─── T-04 — a genuine miss is null, not an error ─────────────────────────────
// A brand-new venue that really is in nobody's directory is a COMMON, correct
// outcome. It must resolve to null so the brand continues creating, not to an
// error the client has to interpret.
Deno.test("T-04 #1648: no Google result resolves to null, not an error", async () => {
  const parsed = parseResolveInput(GOOD);
  assert(!("error" in parsed));
  if ("error" in parsed) return;

  for (const payload of ['{"places":[]}', "{}", '{"places":[{}]}']) {
    const fake = (() =>
      Promise.resolve(new Response(payload, { status: 200 }))) as unknown as typeof fetch;
    assertEquals(await resolveGooglePlaceId(parsed, "k", fake), null);
  }
});

// ─── T-05 — ADVERSARIAL: an outage must NOT masquerade as "no match" ─────────
// THE most important test here. If Google is down and we report "no match", we
// tell a venue we DO hold that we have never heard of them, and they duplicate
// themselves — the precise harm this endpoint exists to prevent. Same failure
// shape as #1620, where a monitor reported healthy over a dead API.
Deno.test("T-05 #1648 ADVERSARIAL: an upstream failure throws, never returns null", async () => {
  const parsed = parseResolveInput(GOOD);
  assert(!("error" in parsed));
  if ("error" in parsed) return;

  for (const status of [400, 401, 403, 429, 500, 502, 503]) {
    const fake = (() =>
      Promise.resolve(new Response("{}", { status }))) as unknown as typeof fetch;
    await assertRejects(
      () => resolveGooglePlaceId(parsed, "k", fake),
      Error,
      undefined,
      `HTTP ${status} must throw — reporting it as "no match" would send a venue ` +
        `we hold into create-from-scratch`,
    );
  }
});

// ─── T-06 — the field mask stays minimal (cost) ──────────────────────────────
// `places.id` alone keeps this in Google's Essentials SKU (10,000 free/month).
// Adding displayName or any Pro field silently moves every call to a paid tier
// for data we already hold in our own pool.
Deno.test("T-06 #1648: the Google field mask requests identity ONLY", async () => {
  let seenMask: string | null = null;
  const fake = ((_u: string, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    seenMask = h["X-Goog-FieldMask"] ?? null;
    return Promise.resolve(
      new Response(JSON.stringify({ places: [{ id: "x" }] }), { status: 200 }),
    );
  }) as unknown as typeof fetch;

  const parsed = parseResolveInput(GOOD);
  assert(!("error" in parsed));
  if ("error" in parsed) return;
  await resolveGooglePlaceId(parsed, "k", fake);

  assertEquals(seenMask, "places.id", "mask must stay identity-only (Essentials SKU)");
});

// ─── T-07 — the request is biased to the pick, not a discovery query ─────────
Deno.test("T-07 #1648: the search is location-biased to the picked coordinate", async () => {
  let body: Record<string, unknown> = {};
  const fake = ((_u: string, init?: RequestInit) => {
    body = JSON.parse(String(init?.body ?? "{}"));
    return Promise.resolve(
      new Response(JSON.stringify({ places: [{ id: "x" }] }), { status: 200 }),
    );
  }) as unknown as typeof fetch;

  const parsed = parseResolveInput(GOOD);
  assert(!("error" in parsed));
  if ("error" in parsed) return;
  await resolveGooglePlaceId(parsed, "k", fake);

  const circle = (body.locationBias as Record<string, Record<string, Record<string, number>>>)
    ?.circle;
  assertEquals(circle?.center?.latitude, 35.7847);
  assertEquals(circle?.center?.longitude, -78.6821);
  assertEquals(body.maxResultCount, 1, "one answer, not a shortlist");
});

// ─── T-08 — no pool row means an honest null match ───────────────────────────
Deno.test("T-08 #1648: an unmatched place id returns match:null", async () => {
  const res = matchResponseForRows([]);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).match, null);
});

// ─── T-09 — rate limiting actually bites ─────────────────────────────────────
// This endpoint spends money per call. An unbounded one is a billing incident.
Deno.test("T-09 #1648: the per-user rate limit closes", () => {
  const uid = `u-${Math.round(performance.now())}-a`;
  let allowed = 0;
  for (let i = 0; i < 40; i++) if (checkRateLimit(uid, 1_000_000)) allowed++;
  assert(allowed > 0, "some calls must be allowed");
  assert(allowed <= 20, `rate limit did not close — ${allowed} calls allowed`);
});
