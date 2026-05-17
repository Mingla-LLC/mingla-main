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
    // The mapper "trip-step4-currency" testID belonged to a TextInput;
    // after rework it must be replaced by "trip-step4-currency-readonly".
    expect(STEP4_SOURCE).not.toMatch(/testID="trip-step4-currency"/);
    expect(STEP4_SOURCE).toMatch(/testID="trip-step4-currency-readonly"/);
    // No TextInput element bound to currency — pin via the onChange handler
    // pattern that used to write currency to draft.
    expect(STEP4_SOURCE).not.toMatch(/onChange\(\s*\{\s*currency:/);
  });

  test("wizard autosaveStep4 does NOT send currency in the pricing patch", () => {
    // The autosaveStep4 callback must not include a `currency:` key in the
    // patch payload — currency is server-derived per ORCH-0859 REWORK 2.
    const autosaveStep4Block = WIZARD_SOURCE.match(
      /const autosaveStep4[^]*?\}, \[step4Draft[^]*?\]\);/,
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
    const fnBlock = BUSINESS_EVENTS_SOURCE.match(
      /export const fetchBusinessEventsForBrand[^]*?^\};/m,
    );
    expect(fnBlock).not.toBeNull();
    expect(fnBlock?.[0]).toMatch(/from\("events"\)/);
    expect(fnBlock?.[0]).toMatch(/event_type.*===\s*["']trip["']/);
    expect(fnBlock?.[0]).toMatch(/filter\(.*tripIds/);
  });
});

describe("ORCH-0859 REWORK 2 — item 4 (drafts get edit path)", () => {
  test("hub/trips routes drafts to /trip/{id}/edit and others to /trip/{id}", () => {
    expect(HUB_TRIPS_SOURCE).toMatch(/trip\.status === ["']draft["']/);
    expect(HUB_TRIPS_SOURCE).toMatch(/\/trip\/\$\{trip\.id\}\/edit/);
    expect(HUB_TRIPS_SOURCE).toMatch(/\/trip\/\$\{trip\.id\}`/);
    // Operator must see a different accessibility label for drafts vs
    // published so screen readers convey the action.
    expect(HUB_TRIPS_SOURCE).toMatch(/Continue editing/);
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

  test("wizard renders visible 5-segment progress indicator", () => {
    expect(WIZARD_SOURCE).toMatch(/testID="trip-wizard-progress"/);
    expect(WIZARD_SOURCE).toMatch(/STEP_COUNT\s*=\s*5/);
    // Three distinct visual states: complete / current / upcoming.
    expect(WIZARD_SOURCE).toMatch(/progressComplete/);
    expect(WIZARD_SOURCE).toMatch(/progressCurrent/);
    expect(WIZARD_SOURCE).toMatch(/progressUpcoming/);
  });
});
