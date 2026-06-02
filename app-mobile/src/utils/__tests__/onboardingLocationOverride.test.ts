// @ts-nocheck
/**
 * ORCH-1036 [launch-city gate override clobber] — regression test
 *
 * Proves the launch-city gate's custom_location override SURVIVES the full
 * post-gate onboarding sequence (gate-confirm THEN handleSavePreferences), not
 * just at pick time. This is the exact gap that let the bug ship in ORCH-1028:
 * the gate wrote custom_location='Washington', then the final preferences save
 * re-upserted custom_location=null (sourced from the always-null data.manualLocation),
 * clobbering it while the coords survived (column-scoped upsert).
 *
 * The test exercises the REAL shipped derivation (resolveOnboardingLocationOverride,
 * used by OnboardingFlow.tsx handleSavePreferences) feeding a PostgREST-faithful
 * column-scoped upsert simulator that replays BOTH writers against one row.
 *
 * Mechanism faithfulness:
 *   PreferencesService.updateUserPreferences upserts on PK profile_id with NO
 *   onConflict and NO column list, so PostgREST builds DO UPDATE SET from the
 *   payload keys only: keys present (incl. explicit null) overwrite the column;
 *   omitted keys are preserved. The simulator below replicates exactly that.
 */
import {
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  resolveOnboardingLocationOverride,
  type OnboardingLocationState,
} from "../onboardingLocationOverride.ts";

const WASHINGTON = { name: "Washington", lat: 38.9072873, lng: -77.0369274 };

// ── PostgREST column-scoped upsert simulator ──────────────────────────────
// One conflict target (profile_id). Provided keys (incl. explicit null) win;
// omitted keys are preserved. Mirrors supabase.from('preferences').upsert(payload)
// with no onConflict + no defaultToNull control.
type Row = Record<string, unknown>;
function makeUpsertStore() {
  let row: Row | null = null;
  return {
    upsert(payload: Row) {
      if (row === null) {
        row = { ...payload };
      } else {
        // DO UPDATE SET <only provided columns> — explicit null overwrites,
        // omitted columns are left untouched.
        row = { ...row, ...payload };
      }
    },
    get(): Row | null {
      return row === null ? null : { ...row };
    },
  };
}

// ── The exact write the launch-city gate (ORCH-1028 handleLaunchGateConfirmCity)
// performs: the four custom_*/use_gps_location override fields, nothing else. ──
function gateConfirmPayload(city: { name: string; lat: number; lng: number }) {
  return {
    profile_id: "user-1",
    custom_lat: city.lat,
    custom_lng: city.lng,
    custom_location: city.name,
    use_gps_location: false,
  };
}

// ── The exact location-bearing portion of the FINAL save (handleSavePreferences),
// built from the SHIPPED derivation under test. ──
function savePreferencesLocationPayload(state: OnboardingLocationState) {
  const resolved = resolveOnboardingLocationOverride(state);
  return {
    profile_id: "user-1",
    // non-location prefs the real save also writes (present so the row is realistic)
    categories: ["nature"],
    travel_mode: "walking",
    use_gps_location: state.useGpsLocation,
    custom_location: resolved.custom_location,
    custom_lat: resolved.custom_lat,
    custom_lng: resolved.custom_lng,
  };
}

Deno.test("ORCH-1036: gate-confirmed launch city SURVIVES handleSavePreferences (custom_location stays non-null)", () => {
  const store = makeUpsertStore();

  // STEP A — user picks Washington at the launch-city gate (out-of-live-city user).
  store.upsert(gateConfirmPayload(WASHINGTON));

  // Snapshot at pick time — override correct (this is where the OLD code also looked fine).
  const afterGate = store.get()!;
  assertEquals(afterGate.custom_location, "Washington");
  assertEquals(afterGate.use_gps_location, false);

  // STEP B — user finishes onboarding; the FINAL preferences save fires.
  // The gate set cityName + coordinates + useGpsLocation=false but NOT manualLocation.
  const onboardingStateAtSave: OnboardingLocationState = {
    useGpsLocation: false,
    cityName: "Washington",
    manualLocation: null, // gate never sets this — the exact bug condition
    coordinates: { lat: WASHINGTON.lat, lng: WASHINGTON.lng },
  };
  store.upsert(savePreferencesLocationPayload(onboardingStateAtSave));

  // ASSERT — after the FULL gate→save sequence, the override survives end-to-end.
  const afterSave = store.get()!;
  assertEquals(afterSave.custom_location, "Washington"); // <-- was null pre-fix (clobbered)
  assertEquals(afterSave.use_gps_location, false);
  assertEquals(afterSave.custom_lat, WASHINGTON.lat);
  assertEquals(afterSave.custom_lng, WASHINGTON.lng);
});

Deno.test("ORCH-1036: legacy manual-location (typed city, no gate) also survives the save", () => {
  const store = makeUpsertStore();

  // Legacy flow: user typed a city; manualLocation set, cityName not set by gate.
  const onboardingState: OnboardingLocationState = {
    useGpsLocation: false,
    cityName: null,
    manualLocation: "Brooklyn, NY, USA",
    coordinates: { lat: 40.6782, lng: -73.9442 },
  };
  store.upsert(savePreferencesLocationPayload(onboardingState));

  const row = store.get()!;
  assertEquals(row.custom_location, "Brooklyn, NY, USA");
  assertEquals(row.use_gps_location, false);
  assertEquals(row.custom_lat, 40.6782);
  assertEquals(row.custom_lng, -73.9442);
});

Deno.test("ORCH-1036: true GPS user stays clean — custom_location null, use_gps_location true", () => {
  const store = makeUpsertStore();

  // GPS user: captureLocation set useGpsLocation=true + a cityName from reverse-geocode,
  // but they did NOT pick a launch city. The save must NOT persist a stale custom_location.
  const onboardingState: OnboardingLocationState = {
    useGpsLocation: true,
    cityName: "San Francisco", // reverse-geocoded label — must NOT become a custom override
    manualLocation: null,
    coordinates: { lat: 37.7749, lng: -122.4194 },
  };
  store.upsert(savePreferencesLocationPayload(onboardingState));

  const row = store.get()!;
  assertEquals(row.custom_location, null);
  assertEquals(row.custom_lat, null);
  assertEquals(row.custom_lng, null);
  assertEquals(row.use_gps_location, true);
});

Deno.test("ORCH-1036: resolver unit — non-GPS prefers gate cityName over manualLocation", () => {
  // When both are present (defensive), the gate's city wins (it is the live-city choice).
  const resolved = resolveOnboardingLocationOverride({
    useGpsLocation: false,
    cityName: "Washington",
    manualLocation: "Some Stale Typed City",
    coordinates: { lat: WASHINGTON.lat, lng: WASHINGTON.lng },
  });
  assertEquals(resolved.custom_location, "Washington");
  assertEquals(resolved.custom_lat, WASHINGTON.lat);
  assertEquals(resolved.custom_lng, WASHINGTON.lng);
});
