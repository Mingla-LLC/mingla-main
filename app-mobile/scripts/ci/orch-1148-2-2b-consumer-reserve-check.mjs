#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * META-ORCH-1148 sub-ORCH 2.2b [consumer reserve] regression check.
 *
 * The consumer app reserve flow built on the SHIPPED 2.2a backend:
 *   - A "Reserve a table" affordance in ExpandedCardModal's nightOut branch,
 *     gated on useVenueReservable (reservable=true + brand_id) → NO dead tap
 *     for non-reservable / unclaimed places.
 *   - A 3-step VenueReserveSheet (party+date → engine slots → confirm/review),
 *     where the FREE path STILL renders the confirm step (locked decision 3),
 *     fee routes to the native PaymentSheet + venue-reservation-confirm.
 *   - Slots come ONLY from the engine pg_venue_available_slots (never fabricated).
 *   - "My reservations" = a THIRD UnifiedRow kind folded into the existing
 *     Calendar tab Active/Archive buckets, with a Cancel action.
 *   - A net-new anon resolve RPC pg_venue_reservable_for_place (OQ-1) exposing
 *     ONLY {reservable, brand_id, currency}.
 *
 * Structural + behavioral `.mjs` check (the app-mobile gate convention). Set
 * ORCH1148_2_2B_SIMULATE_REVERT=1 to strip the load-bearing seams; the script
 * must then FAIL, proving the checks bite.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const simulateRevert = process.env.ORCH1148_2_2B_SIMULATE_REVERT === "1";

const read = (rel) => {
  try {
    return fs.readFileSync(path.join(repoRoot, rel), "utf8");
  } catch (error) {
    console.error(`Cannot read ${rel}: ${error.message}`);
    process.exit(2);
  }
};

const RESOLVE_MIGRATION =
  "supabase/migrations/20261012000006_orch_1148_2_2b_venue_reservable_for_place.sql";
const RESERVABLE_HOOK = "app-mobile/src/hooks/useVenueReservable.ts";
const AVAILABILITY_HOOK = "app-mobile/src/hooks/useVenueAvailability.ts";
const RESERVE_HOOK = "app-mobile/src/hooks/useReserveTable.ts";
const MY_RESERVATIONS_HOOK = "app-mobile/src/hooks/useMyReservations.ts";
const SERVICE = "app-mobile/src/services/venueReservationService.ts";
const SHEET = "app-mobile/src/components/expandedCard/VenueReserveSheet.tsx";
const SLOT_PICKER = "app-mobile/src/components/expandedCard/VenueSlotPicker.tsx";
const RESERVATION_ROW =
  "app-mobile/src/components/activity/ReservationCalendarRow.tsx";
const MODAL = "app-mobile/src/components/ExpandedCardModal.tsx";
const CALENDAR = "app-mobile/src/components/activity/CalendarTab.tsx";

// Simulated revert = the pre-2.2b regressions we must catch:
//   - modal: remove the reservable GATE → the affordance renders unconditionally
//     (a DEAD TAP for non-reservable places).
//   - sheet: strip the confirm step so FREE skips straight to commit.
//   - availability: add a fabricated-slots fallback.
//   - calendar: drop the reservation render branch.
const maybeRevert = (source, kind) => {
  if (!simulateRevert) return source;
  if (kind === "modal") {
    // Loosen the AFFORDANCE gate (the one wrapping the Reserve button): render
    // it with no reservable check → a DEAD TAP for non-reservable places.
    return source.replace(
      /venueReservable\?\.reservable === true &&\s*\n\s*venueReservable\.brand_id !== null && \(\s*\n\s*<TouchableOpacity\s*\n\s*style=\{reserveStyles\.reserveButton\}/,
      "true && (\n                    <TouchableOpacity\n                      style={reserveStyles.reserveButton}",
    );
  }
  if (kind === "sheet") {
    // Remove the confirm step → free path would skip review.
    return source.replace(/step === "confirm"/g, 'step === "__never__"');
  }
  if (kind === "availability") {
    // Fabricate a slot fallback when the engine returns empty.
    return source.replace(
      /return rows\.map\(\(r\) => \(\{/,
      "if (rows.length === 0) { return [{ slotStartUtc: new Date().toISOString(), label: '7:00', remaining: 99, isFull: false }]; }\n  return rows.map((r) => ({",
    );
  }
  if (kind === "calendar") {
    // Drop the reservation render branch.
    return source.replace(/row\.kind === "reservation"/g, 'row.kind === "__never__"');
  }
  return source;
};

let failures = 0;
const check = (label, fn) => {
  try {
    fn();
    console.log(`  ✓ ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${label}\n      ${error.message}`);
  }
};

// ── 1. Resolve RPC migration (OQ-1): anon-safe, exposes ONLY the display gate.
const resolveMig = read(RESOLVE_MIGRATION);
console.log("Resolve RPC pg_venue_reservable_for_place:");
check("function created", () => {
  assert.match(
    resolveMig,
    /CREATE OR REPLACE FUNCTION public\.pg_venue_reservable_for_place\(p_place_pool_id uuid\)/,
  );
});
check("SECURITY DEFINER + locked search_path", () => {
  assert.match(resolveMig, /SECURITY DEFINER/);
  assert.match(resolveMig, /SET search_path TO 'public', 'pg_temp'/);
});
check("returns EXACTLY {reservable, brand_id, currency}", () => {
  assert.match(
    resolveMig,
    /RETURNS TABLE \(\s*reservable boolean,\s*brand_id\s+uuid,\s*currency\s+text\s*\)/,
  );
  // No PII / fee-amount column leaked.
  assert.ok(!/fee_amount_cents|guest_name|guest_phone|guest_email/.test(resolveMig));
});
check("verified-claim place→brand link (mirrors anon experiences RPC)", () => {
  assert.match(resolveMig, /b\.place_pool_id = p_place_pool_id/);
  assert.match(resolveMig, /b\.claim_status = 'verified'/);
});
check("REVOKE PUBLIC then GRANT anon+authenticated", () => {
  assert.match(
    resolveMig,
    /REVOKE ALL ON FUNCTION public\.pg_venue_reservable_for_place\(uuid\) FROM PUBLIC/,
  );
  assert.match(
    resolveMig,
    /GRANT EXECUTE ON FUNCTION public\.pg_venue_reservable_for_place\(uuid\)\s*\n?\s*TO anon, authenticated, service_role/,
  );
});
check("brand_id+currency NULL unless reservations_enabled (no leak when off)", () => {
  assert.match(resolveMig, /WHEN COALESCE\(vrs\.reservations_enabled, false\)\s*\n\s*THEN b\.id ELSE NULL END/);
});

// ── 2. Reservable-venue gate hook (no dead tap; non-uuid → no fetch). ───────
const reservableHook = read(RESERVABLE_HOOK);
console.log("useVenueReservable:");
check("calls pg_venue_reservable_for_place", () => {
  assert.match(reservableHook, /pg_venue_reservable_for_place/);
});
check("disabled for non-uuid place ids (UUID gate)", () => {
  assert.match(reservableHook, /UUID_RE\.test\(placePoolId\)/);
});

// ── 3. Availability hook: engine is the SOLE source — never fabricated. ─────
const availHook = maybeRevert(read(AVAILABILITY_HOOK), "availability");
console.log("useVenueAvailability:");
check("calls the engine pg_venue_available_slots", () => {
  assert.match(availHook, /pg_venue_available_slots/);
});
check("NEVER fabricates slots (no synthetic fallback array)", () => {
  // The only mapping is engine rows → VenueSlot; no hardcoded slot fallback.
  assert.ok(
    !/slotStartUtc: new Date\(\)\.toISOString\(\)/.test(availHook),
    "a fabricated slot fallback was introduced",
  );
});

// ── 4. The reserve commit: free vs fee routing + confirm via the edge fns. ──
const reserveHook = read(RESERVE_HOOK);
const service = read(SERVICE);
console.log("useReserveTable + venueReservationService:");
check("service calls venue-reservation-create (surface native)", () => {
  assert.match(service, /venue-reservation-create/);
  assert.match(service, /surface: "native"/);
});
check("service calls venue-reservation-confirm (fee finalize)", () => {
  assert.match(service, /venue-reservation-confirm/);
});
check("free path → succeeded immediately (free_completed)", () => {
  assert.match(reserveHook, /created\.kind === "free_completed"/);
});
check("fee path → native PaymentSheet then confirm", () => {
  assert.match(reserveHook, /created\.kind === "requires_payment"/);
  assert.match(reserveHook, /presentPaymentSheet\(\)/);
  assert.match(reserveHook, /finalizeFee\(/);
});
check("Connect direct-charge re-init (ORCH-0844 reuse)", () => {
  assert.match(reserveHook, /initStripe\(\{[\s\S]*?stripeAccountId: created\.stripeAccountId/);
});
check("on success invalidates myReservations", () => {
  assert.match(reserveHook, /myReservationsKeys\.byUser/);
});

// ── 5. The 3-step sheet: FREE STILL has the confirm/review step. ────────────
const sheet = maybeRevert(read(SHEET), "sheet");
console.log("VenueReserveSheet (3 steps; free still reviews):");
check("step 1 party+date present (See times CTA)", () => {
  assert.match(sheet, /step === "party"/);
  assert.match(sheet, /See times/);
});
check("step 2 slot grid (VenueSlotPicker)", () => {
  assert.match(sheet, /step === "slots"/);
  assert.match(sheet, /<VenueSlotPicker/);
});
check("step 3 confirm/review ALWAYS rendered (free + fee)", () => {
  assert.match(sheet, /step === "confirm"/);
  assert.match(sheet, /REVIEW/);
  assert.match(sheet, /Confirm reservation/);
});
check("commit only fires from the confirm step (handleConfirm)", () => {
  // handleConfirm calls reserve(); it lives behind the confirm CTA.
  assert.match(sheet, /handleConfirm/);
  assert.match(sheet, /const outcome = await reserve\(/);
});
check("NO sign-in step in the consumer reserve flow (2.2b correction)", () => {
  assert.ok(!/signInWithApple|signInWithGoogle/.test(sheet));
});
check("a11y labels on the stepper + CTA", () => {
  assert.match(sheet, /accessibilityLabel="Increase party size"/);
  assert.match(sheet, /accessibilityLabel="Confirm reservation"/);
});

// ── 6. Slot picker: full slots disabled (no dead tap), empty = fully booked. ─
const slotPicker = read(SLOT_PICKER);
console.log("VenueSlotPicker:");
check("full slots are disabled (not hidden) — no dead tap", () => {
  assert.match(slotPicker, /disabled=\{full\}/);
  assert.match(slotPicker, /if \(full\) return;/);
});
check("empty engine result → fully-booked state (not fabricated)", () => {
  assert.match(slotPicker, /Fully booked/);
});

// ── 7. The modal affordance gate: reservable=true + brand_id → no dead tap. ─
const modal = maybeRevert(read(MODAL), "modal");
console.log("ExpandedCardModal reserve affordance:");
check("affordance gated on reservable + brand_id (NO dead tap)", () => {
  // The Reserve BUTTON specifically must sit behind the reservable gate.
  assert.match(
    modal,
    /venueReservable\?\.reservable === true &&\s*\n\s*venueReservable\.brand_id !== null && \(\s*\n\s*<TouchableOpacity\s*\n\s*style=\{reserveStyles\.reserveButton\}/,
  );
});
check("opens the reserve sheet on tap", () => {
  assert.match(modal, /setIsReserveSheetOpen\(true\)/);
  assert.match(modal, /<VenueReserveSheet/);
});
check("the reserve sheet gates the root sheet (anyChildModalOpen)", () => {
  assert.match(modal, /isReserveSheetOpen;/);
});

// ── 8. Calendar union: the reservation kind buckets + renders + cancels. ────
const myResHook = read(MY_RESERVATIONS_HOOK);
const calendar = maybeRevert(read(CALENDAR), "calendar");
const reservationRow = read(RESERVATION_ROW);
console.log("Calendar union reservation kind:");
check("useMyReservations reads consumer-own reservations", () => {
  assert.match(myResHook, /\.from\("reservations"\)/);
  assert.match(myResHook, /\.eq\("consumer_user_id", userId\)/);
});
check("cancelMyReservation calls pg_cancel_my_reservation", () => {
  assert.match(myResHook, /pg_cancel_my_reservation/);
});
check("UnifiedRow has the reservation kind", () => {
  assert.match(calendar, /kind: "reservation"/);
});
check("reservations buckets into Active/Archive", () => {
  assert.match(calendar, /activeReservations/);
  assert.match(calendar, /archiveReservations/);
});
check("the reservation row branch renders in both buckets", () => {
  const matches = calendar.match(/row\.kind === "reservation"/g) ?? [];
  assert.ok(matches.length >= 2, `expected ≥2 reservation render branches, found ${matches.length}`);
});
check("ReservationCalendarRow exposes a Cancel action", () => {
  assert.match(reservationRow, /onCancel\(reservation\)/);
  assert.match(reservationRow, /isCancellable/);
});

console.log("");
if (failures > 0) {
  console.error(`META-ORCH-1148 2.2b check: ${failures} failure(s).`);
  process.exit(1);
}
if (simulateRevert) {
  console.error(
    "SIMULATE_REVERT was set but ALL checks passed — the gates do NOT bite. This is itself a failure.",
  );
  process.exit(1);
}
console.log("META-ORCH-1148 2.2b consumer reserve: ALL CHECKS PASS.");
