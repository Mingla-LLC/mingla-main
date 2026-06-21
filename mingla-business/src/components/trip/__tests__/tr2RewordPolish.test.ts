/**
 * ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 2 — source-grep regression
 * tests for items 2, 3, 4, 5, 6, 7 from the operator smoke list.
 *
 * Each assertion pins one specific code-level commitment the rework made.
 * Fails-on-revert: removing/inverting any of the cited lines causes the
 * matching assertion to fail.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

const ROOT = join(__dirname, "..", "..", "..", "..");

const WIZARD_SOURCE = readFileSync(
  join(ROOT, "src", "components", "trip", "TripCreatorWizard.tsx"),
  "utf8",
);

const STEP1_SOURCE = readFileSync(
  join(ROOT, "src", "components", "trip", "TripCreatorStep1Basics.tsx"),
  "utf8",
);

const STEP4_SOURCE = readFileSync(
  join(ROOT, "src", "components", "trip", "TripCreatorStep4Pricing.tsx"),
  "utf8",
);

const HUB_TRIPS_SOURCE = readFileSync(
  join(ROOT, "app", "(tabs)", "hub", "trips.tsx"),
  "utf8",
);

const BUSINESS_EVENTS_SOURCE = readFileSync(
  join(ROOT, "src", "services", "businessEvents.ts"),
  "utf8",
);

describe("ORCH-0859 REWORK 2 — item 1 + 7 (pricing currency + stale-banner)", () => {
  test("Step 4 pricing component has NO editable currency TextInput", () => {
    // Currency input was a free-form TextInput pre-fix. Now read-only View.
    // [TEST-MOD-APPROVED META-ORCH-1174] — Step 4 is now MULTI-PACKAGE (Leg B2),
    // so the read-only currency View renders PER PACKAGE with an indexed testID
    // `trip-step4-currency-readonly-${index}` (template literal). The ORCH-0859
    // invariant — currency is NEVER an editable input — is fully preserved.
    expect(STEP4_SOURCE).not.toMatch(/testID="trip-step4-currency"/);
    expect(STEP4_SOURCE).toMatch(
      /testID=\{`trip-step4-currency-readonly-\$\{index\}`\}/,
    );
    // No onChange/onPatch handler writes currency to draft/package state.
    expect(STEP4_SOURCE).not.toMatch(/onChange\(\s*\{\s*currency:/);
    expect(STEP4_SOURCE).not.toMatch(/onPatch\(\s*\{\s*currency:/);
  });

  test("wizard pricing persistence does NOT send currency in the patch", () => {
    // [TEST-MOD-APPROVED META-ORCH-1174] — autosaveStep4 now delegates to the
    // N-package `persistPackages` callback. Currency stays server-derived per
    // ORCH-0859 REWORK 2: neither persistPackages nor autosaveStep4 may include
    // a `currency:` key in any updateTripPricing/createTripPricingTier patch.
    const persistBlock = WIZARD_SOURCE.match(
      /const persistPackages[^]*?\}, \[\s*step4Draft\.packages[^]*?\]\);/,
    );
    expect(persistBlock).not.toBeNull();
    expect(persistBlock?.[0]).not.toMatch(/currency:\s/);
    const autosaveStep4Block = WIZARD_SOURCE.match(
      /const autosaveStep4[^]*?\}, \[\s*persistPackages[^]*?\]\);/,
    );
    expect(autosaveStep4Block).not.toBeNull();
    expect(autosaveStep4Block?.[0]).not.toMatch(/currency:\s/);
  });

  test("wizard handleNext clears publishError on autosave success (item 7 defensive)", () => {
    const handleNextBlock = WIZARD_SOURCE.match(
      /const handleNext[^]*?\}, \[autosaveCurrentStep, step\]\);/,
    );
    expect(handleNextBlock).not.toBeNull();
    // The fix is to call setPublishError(null) AFTER await + BEFORE the
    // setStep call so stale banners from prior failures don't persist.
    expect(handleNextBlock?.[0]).toMatch(/await\s+autosaveCurrentStep\(\)/);
    expect(handleNextBlock?.[0]).toMatch(/setPublishError\(null\)/);
  });
});

describe("ORCH-0859 REWORK 2 — item 3 (events service excludes trips)", () => {
  test("fetchBusinessEventsForBrand filters event_type='trip' rows out", () => {
    // Implementation reality: view doesn't expose event_type, so the fix
    // does a follow-up `events.in("id", ids)` query to discover trip ids
    // and filters client-side. Pin both halves.
    //
    // ORCH-0874 [Trip surfaces visual parity with Events] tester QA report
    // P3-FIND-1: regex widened to also match aliased form `const t = r.event_type;
    // if (t === "trip")` which the implementation uses for null-coalescing.
    // Functional invariant unchanged (still strict-equality string check on
    // the per-row event_type column value). [TEST-MOD-APPROVED ORCH-0874]
    const fnBlock = BUSINESS_EVENTS_SOURCE.match(
      /export const fetchBusinessEventsForBrand[^]*?^\};/m,
    );
    expect(fnBlock).not.toBeNull();
    expect(fnBlock?.[0]).toMatch(/from\("events"\)/);
    expect(fnBlock?.[0]).toMatch(/(r\.event_type|t)\s*===\s*["']trip["']/);
    expect(fnBlock?.[0]).toMatch(/filter\(.*tripIds/);
  });
});

describe("ORCH-0859 REWORK 2 — item 4 (drafts get edit path) — updated for ORCH-0874", () => {
  // ORCH-0874 [Trip surfaces visual parity with Events] refactored the
  // inline `/trip/${trip.id}/edit` / `/trip/${trip.id}` routing in
  // hub/trips.tsx to use the canonical `routeForEventRowDefensive` helper
  // per I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE invariant (ORCH-0865 [trips-leak
  // + routeForEventRow helper] established this pattern). Functional
  // behaviour preserved — the helper routes drafts to /trip/{id}/edit and
  // non-drafts to /trip/{id}. The behavioural verification lives in
  // `TripVisualParity_adversarial.test.ts` A-01 which exercises
  // `routeForEventRowDefensive` directly and confirms the routing output.
  // [TEST-MOD-APPROVED ORCH-0874]
  test("hub/trips routes via routeForEventRowDefensive helper (post-ORCH-0874)", () => {
    expect(HUB_TRIPS_SOURCE).toMatch(/routeForEventRowDefensive/);
    expect(HUB_TRIPS_SOURCE).toMatch(/event_type:\s*["']trip["']/);
    expect(HUB_TRIPS_SOURCE).toMatch(/status:\s*trip\.status/);
  });
});

describe("ORCH-0859 REWORK 2 — item 5 (date pickers, not free-form text)", () => {
  test("Step 1 imports DateTimePicker and uses Pressable rows (no raw date TextInputs)", () => {
    expect(STEP1_SOURCE).toMatch(
      /from\s+["']@react-native-community\/datetimepicker["']/,
    );
    expect(STEP1_SOURCE).toMatch(/<DateTimePicker[\s>]/);
    // No raw TextInput bound to startAt/endAt anymore.
    expect(STEP1_SOURCE).not.toMatch(
      /<TextInput[^>]*onChangeText=\{[^}]*startAt:/,
    );
    expect(STEP1_SOURCE).not.toMatch(
      /<TextInput[^>]*onChangeText=\{[^}]*endAt:/,
    );
  });

  test("Step 1 date pickers enforce minimumDate to block past dates", () => {
    expect(STEP1_SOURCE).toMatch(/minimumDate=\{pickerMinDate\}/);
    // End date minimum must be max(startAt, today); pin the helper logic.
    expect(STEP1_SOURCE).toMatch(/pickerMode === ["']end["']/);
    expect(STEP1_SOURCE).toMatch(/isoToDate\(draft\.startAt\)/);
  });
});

describe("ORCH-0859 REWORK 2 — items 2 + 6 (wizard SafeArea + step progress)", () => {
  test("wizard host wraps in safe-area padding", () => {
    expect(WIZARD_SOURCE).toMatch(/useSafeAreaInsets/);
    expect(WIZARD_SOURCE).toMatch(/paddingTop:\s*insets\.top/);
  });

  // ORCH-0874 [Trip surfaces visual parity with Events] SC-05 EXPLICITLY
  // removes the 4pt anonymous progress segments in favour of the `Stepper`
  // primitive with named pill chips, mirroring EventCreatorWizard chrome.
  // Functional invariant preserved (5-step progress visible to operator);
  // implementation moved from anonymous segments to named Stepper.
  // New contract verified in `TripVisualParity.test.ts` SC-05.
  // [TEST-MOD-APPROVED ORCH-0874]
  test("wizard renders named Stepper primitive (post-ORCH-0874)", () => {
    expect(WIZARD_SOURCE).toMatch(/<Stepper[^>]*steps=\{?STEPPER_STEPS/);
    expect(WIZARD_SOURCE).toMatch(/STEP_COUNT\s*=\s*5/);
    // No more anonymous 4pt segments — superseded by named pill chips.
    expect(WIZARD_SOURCE).not.toMatch(/progressSegment/);
  });
});
