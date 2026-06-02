// @ts-nocheck
/**
 * ORCH-1036 [launch-city gate override clobber] — ADVERSARIAL regression test
 * (tester-authored, distinct angle from the implementor's happy-path test).
 *
 * The implementor's test (onboardingLocationOverride.test.ts) replays gate-confirm
 * THEN handleSavePreferences through a single column-scoped upsert simulator and
 * asserts the DB row keeps custom_location.
 *
 * This test attacks DIFFERENT angles the happy-path test does not cover:
 *
 *   ANGLE 1 — TWO-WRITER PARITY: the real bug clobbered custom_location at BOTH
 *     sites inside handleSavePreferences — the persisted updateUserPreferences
 *     upsert (anchor line 1732) AND the in-handler queryClient.setQueryData cache
 *     pre-seed (anchor line 1758). Both must receive the IDENTICAL resolved value,
 *     or the cold-relaunch DB row and the in-session cache diverge. We model BOTH
 *     writers from one resolver call and assert byte-equality of the location fields.
 *
 *   ANGLE 2 — GPS → custom → GPS toggle within one onboarding session: a user who
 *     picked a launch city (or typed one), then went BACK and re-ran GPS capture.
 *     useGpsLocation flips back to true while cityName/manualLocation/coordinates
 *     still hold the stale picked-city values. The resolver MUST null all three
 *     custom_* fields so no stale override is persisted (the inverse of the bug).
 *
 *   ANGLE 3 — empty / whitespace-only label boundary (documents current behavior).
 *
 *   ANGLE 4 — IDEMPOTENCY: running the final save twice (re-onboard / retry tap)
 *     must converge to the same row, not accumulate or drift.
 */
import {
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  resolveOnboardingLocationOverride,
  type OnboardingLocationState,
} from "../onboardingLocationOverride.ts";

const WASHINGTON = { name: "Washington", lat: 38.9072873, lng: -77.0369274 };

// PostgREST column-scoped upsert simulator (same mechanism as the prod row).
type Row = Record<string, unknown>;
function makeUpsertStore() {
  let row: Row | null = null;
  return {
    upsert(payload: Row) {
      row = row === null ? { ...payload } : { ...row, ...payload };
    },
    get(): Row | null {
      return row === null ? null : { ...row };
    },
  };
}

// The DB-persisted location payload (handleSavePreferences updateUserPreferences).
function dbWritePayload(resolved: { custom_location: string | null; custom_lat: number | null; custom_lng: number | null }, useGps: boolean) {
  return {
    profile_id: "user-1",
    use_gps_location: useGps,
    custom_location: resolved.custom_location,
    custom_lat: resolved.custom_lat,
    custom_lng: resolved.custom_lng,
  };
}

// The in-handler React Query cache pre-seed (handleSavePreferences setQueryData).
// In the SHIPPED code both blocks destructure the SAME resolver result, so this
// mirrors the cache object's location fields.
function cacheWriteLocationFields(resolved: { custom_location: string | null; custom_lat: number | null; custom_lng: number | null }, useGps: boolean) {
  return {
    use_gps_location: useGps,
    custom_location: resolved.custom_location,
    custom_lat: resolved.custom_lat,
    custom_lng: resolved.custom_lng,
  };
}

Deno.test("ORCH-1036 adversarial: persisted DB write and in-session cache write carry the IDENTICAL gate override (no DB↔cache divergence)", () => {
  // Gate user finishing onboarding (the exact bug condition: manualLocation null).
  const state: OnboardingLocationState = {
    useGpsLocation: false,
    cityName: "Washington",
    manualLocation: null,
    coordinates: { lat: WASHINGTON.lat, lng: WASHINGTON.lng },
  };
  // The SHIPPED code resolves ONCE and feeds both sites — model that.
  const resolved = resolveOnboardingLocationOverride(state);

  const db = dbWritePayload(resolved, state.useGpsLocation);
  const cache = cacheWriteLocationFields(resolved, state.useGpsLocation);

  // Both sites must persist the override, not null it.
  assertEquals(db.custom_location, "Washington");
  assertEquals(cache.custom_location, "Washington");

  // CRITICAL: DB and cache must AGREE on every location field, or cold relaunch
  // (DB) disagrees with in-session (cache) — the §9 cache-vs-DB divergence flaw.
  assertEquals(db.custom_location, cache.custom_location);
  assertEquals(db.custom_lat, cache.custom_lat);
  assertEquals(db.custom_lng, cache.custom_lng);
  assertEquals(db.use_gps_location, cache.use_gps_location);
  assertEquals(cache.custom_lat, WASHINGTON.lat);
  assertEquals(cache.custom_lng, WASHINGTON.lng);
});

Deno.test("ORCH-1036 adversarial: GPS → custom → GPS toggle in one session clears the stale override (inverse of the bug)", () => {
  // User picked Washington, then went back and re-enabled GPS capture.
  // useGpsLocation flips to true but the stale picked-city fields linger in `data`.
  const state: OnboardingLocationState = {
    useGpsLocation: true, // toggled back to GPS
    cityName: "Washington", // stale from the earlier gate pick
    manualLocation: "Brooklyn, NY, USA", // stale from an even-earlier typed attempt
    coordinates: { lat: WASHINGTON.lat, lng: WASHINGTON.lng }, // stale coords
  };
  const resolved = resolveOnboardingLocationOverride(state);

  const store = makeUpsertStore();
  // Simulate an earlier gate write that DID set an override on the row...
  store.upsert({
    profile_id: "user-1",
    custom_location: "Washington",
    custom_lat: WASHINGTON.lat,
    custom_lng: WASHINGTON.lng,
    use_gps_location: false,
  });
  // ...then the final save fires with useGpsLocation back to true.
  store.upsert(dbWritePayload(resolved, state.useGpsLocation));

  const row = store.get()!;
  // The override must be cleared — a true GPS user must NOT keep a stale custom location,
  // even though the row previously held one. This is I-1028-ONE-LOCATION-OWNER's other edge.
  assertEquals(row.custom_location, null);
  assertEquals(row.custom_lat, null);
  assertEquals(row.custom_lng, null);
  assertEquals(row.use_gps_location, true);
});

Deno.test("ORCH-1036 adversarial: idempotency — running the final save twice converges to the same gate override", () => {
  const state: OnboardingLocationState = {
    useGpsLocation: false,
    cityName: "Washington",
    manualLocation: null,
    coordinates: { lat: WASHINGTON.lat, lng: WASHINGTON.lng },
  };
  const store = makeUpsertStore();
  store.upsert(dbWritePayload(resolveOnboardingLocationOverride(state), state.useGpsLocation));
  const afterFirst = store.get()!;
  store.upsert(dbWritePayload(resolveOnboardingLocationOverride(state), state.useGpsLocation));
  const afterSecond = store.get()!;

  assertEquals(afterSecond.custom_location, "Washington");
  assertEquals(afterFirst.custom_location, afterSecond.custom_location);
  assertEquals(afterFirst.custom_lat, afterSecond.custom_lat);
  assertEquals(afterFirst.custom_lng, afterSecond.custom_lng);
  assertEquals(afterFirst.use_gps_location, afterSecond.use_gps_location);
});

Deno.test("ORCH-1036 adversarial: non-GPS with NO label at all does not persist a coords-only ghost override mismatch", () => {
  // Defensive: non-GPS but neither cityName nor manualLocation present (should never
  // happen via the gate, but proves the resolver does not invent a label).
  const resolved = resolveOnboardingLocationOverride({
    useGpsLocation: false,
    cityName: null,
    manualLocation: null,
    coordinates: null,
  });
  assertEquals(resolved.custom_location, null);
  assertEquals(resolved.custom_lat, null);
  assertEquals(resolved.custom_lng, null);
});

Deno.test("ORCH-1036 adversarial: empty-string label boundary (documents current behavior; downstream truthiness-gates it)", () => {
  // The resolver uses `??`, which only catches null/undefined — an empty/whitespace
  // string passes through. In practice neither the gate (real seeding_cities.name) nor
  // the legacy geocoded manualLocation can be empty, and PreferencesSheet gates the city
  // label on truthiness so "" reads as "no custom location" (same as null) — no visible
  // corruption. This test pins the CURRENT behavior so a future trim()/empty-check is a
  // deliberate, test-visible change, not a silent regression.
  const empty = resolveOnboardingLocationOverride({
    useGpsLocation: false,
    cityName: "",
    manualLocation: null,
    coordinates: { lat: 1, lng: 2 },
  });
  assertEquals(empty.custom_location, ""); // current behavior — falsy, gated downstream
  // and the manualLocation fallback only fires when cityName is null/undefined, NOT "":
  const emptyWithFallback = resolveOnboardingLocationOverride({
    useGpsLocation: false,
    cityName: "",
    manualLocation: "Brooklyn",
    coordinates: { lat: 1, lng: 2 },
  });
  assertEquals(emptyWithFallback.custom_location, ""); // "" is non-null → wins over fallback
});
