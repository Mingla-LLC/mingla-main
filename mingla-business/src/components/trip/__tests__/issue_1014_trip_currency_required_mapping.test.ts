/**
 * issue #1014 [free-only publish / money fails close] — implementor happy-path
 * regression, trip leg (SPEC §7 T-13, trip wizard).
 *
 * `business_publish_trip_draft` (post-#1014 migration) leaves a paid trip on a
 * currency-less brand to trigger (c)'s strict path → the RPC surfaces
 * `event_currency_required` on error.message → tripsService passes it as
 * `rawMessage` → TripCreatorStep5Review.mapPublishErrorToState must map it to
 * the actionable Step-5 banner copy (the proactive StripeBlockedCard next to
 * it carries the Connect CTA), NEVER the raw token / generic default.
 *
 * Source-grep pattern (publishErrorMapper.adversarial.test.ts precedent — the
 * component imports react-native and cannot be imported under node-env jest).
 *
 * fails-on-revert: deleting the `event_currency_required` case from the
 * mapper switch turns these assertions red.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

const SOURCE = readFileSync(
  join(__dirname, "..", "TripCreatorStep5Review.tsx"),
  "utf8",
);

describe("issue #1014 — trip publish error mapping for event_currency_required", () => {
  test("the mapper carries an event_currency_required case", () => {
    expect(SOURCE).toContain('case "event_currency_required":');
  });

  test("the case maps to the locked actionable copy, pointing at Step 5", () => {
    const caseIdx = SOURCE.indexOf('case "event_currency_required":');
    expect(caseIdx).toBeGreaterThan(-1);
    const caseBlock = SOURCE.slice(caseIdx, caseIdx + 600);
    expect(caseBlock).toContain(
      "Connect your bank to set a payout currency before publishing a paid trip. Free trips publish any time.",
    );
    expect(caseBlock).toContain("pointsToStep: 5");
  });

  test("the switch still discriminates on rawMessage (ORCH-0859 P0001 contract)", () => {
    // Postgrest returns code=P0001 for unqualified RAISE; the literal lives in
    // message. Reverting the discriminator would dead-end EVERY mapped reason.
    expect(SOURCE).toContain("switch (rawMessage) {");
  });

  test("the ORCH-1075 payment guard is normalized and date case remains untouched", () => {
    expect(SOURCE).toContain(
      "resolveProviderNeutralPaidPublishGuardCopy(rawMessage)",
    );
    expect(SOURCE).toContain('case "offering_date_past":');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// issue #1014 REWORK (tester F-1, SPEC-AMENDMENT #2) — APPEND-ONLY extension.
//
// A currency-less brand pricing a PAID trip at Step 4 fires trigger (d)'s
// `event_currency_required` during AUTOSAVE (updateTripPricing /
// createTripPricingTier) — before publish ever runs. Pre-rework, the wizard's
// handleNext/handleStepBack catches mapped EVERY autosave failure to
// "Couldn't save your changes. Check your connection and try again." — a
// misleading dead end with no payments route.
//
// Contract: both autosave catches run the caught error through
// resolvePaidPublishGuardCopy FIRST; a stripe_onboarding-action copy surfaces
// the locked body + routes to the payments onboarding (mirroring
// handleConfirmPublish); only unrecognized errors keep the connection toast.
//
// fails-on-revert: deleting the resolver call / the guard branch from the
// catches turns these assertions red.
// ─────────────────────────────────────────────────────────────────────────────

const WIZARD_SOURCE = readFileSync(
  join(__dirname, "..", "TripCreatorWizard.tsx"),
  "utf8",
);

describe("issue #1014 rework — autosave catches map money-setup guards (F-1)", () => {
  // [TEST-MOD-APPROVED #1919] Same currency-required autosave scenario, now
  // routed through the standard Trip provider-neutral adapter/action.
  test("the wizard imports the guard resolver alongside the onboarding route", () => {
    expect(WIZARD_SOURCE).toContain("resolveProviderNeutralPaidPublishGuardCopy");
    expect(WIZARD_SOURCE).toContain("brandPaymentOnboardingRoute");
  });

  test("BOTH autosave catches (handleNext + handleStepBack) run the resolver", () => {
    const calls = WIZARD_SOURCE.split(
      "resolveProviderNeutralPaidPublishGuardCopy(autosaveErrCode)",
    ).length - 1;
    expect(calls).toBe(2);
  });

  test("the payment_onboarding branch surfaces the locked copy and routes to payments", () => {
    const firstCatch = WIZARD_SOURCE.indexOf(
      "resolveProviderNeutralPaidPublishGuardCopy(autosaveErrCode)",
    );
    expect(firstCatch).toBeGreaterThan(-1);
    const branch = WIZARD_SOURCE.slice(firstCatch, firstCatch + 700);
    expect(branch).toContain('guardCopy.action === "payment_onboarding"');
    expect(branch).toContain("message: guardCopy.body");
    expect(branch).toContain(
      "router.push(brandPaymentOnboardingRoute(trip.brandId)",
    );
  });

  test("unrecognized autosave errors keep the connection toast (both catches)", () => {
    const toasts = WIZARD_SOURCE.split(
      "Couldn't save your changes. Check your connection and try again.",
    ).length - 1;
    expect(toasts).toBe(2);
  });
});

describe("issue #1014 rework — tripsService pricing writes stop fabricating USD (F-2)", () => {
  const SERVICE_SOURCE = readFileSync(
    join(__dirname, "..", "..", "..", "services", "tripsService.ts"),
    "utf8",
  );

  test("no `?? \"USD\"` currency fabrication remains anywhere in tripsService", () => {
    expect(SERVICE_SOURCE).not.toContain('?? "USD"');
  });

  test("the pricing writes pass NULL through (trigger (d) is authoritative)", () => {
    // [TEST-MOD-APPROVED #1971] ONE assertion is invalidated. It counted three
    // client-side `(… as string | null) ?? null` currency reads — in
    // createTripDraft, updateTripPricing and createTripPricingTier. #1971
    // deleted all three: those functions no longer read or send a currency at
    // all, because `biz_create_trip_draft` and `biz_apply_trip_draft_graph`
    // derive it from the locked row. Counting a construct that no longer exists
    // would be an unfalsifiable green, so the rule is re-pinned where it lives:
    // the client cannot supply a currency, and the SQL passes NULL through.
    // Comments are stripped first. A source-text audit that scans prose matches
    // the explanation of a rule instead of the rule, and reads GREEN on code
    // that violates it (repo-wide trap, see the audit-regex reference note).
    const stripComments = (source: string): string =>
      source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");

    for (const name of ["createTripDraft", "updateTripPricing", "createTripPricingTier"]) {
      const start = SERVICE_SOURCE.indexOf(`export async function ${name}(`);
      expect(start).toBeGreaterThan(-1);
      const next = SERVICE_SOURCE.indexOf("\nexport ", start + 1);
      const body = stripComments(SERVICE_SOURCE.slice(
        start,
        next === -1 ? SERVICE_SOURCE.length : next,
      ));
      // Sanity: the slice really is the function, so the assertion below is not
      // vacuously scanning an empty string.
      expect(body).toContain(`function ${name}(`);
      expect(body).not.toMatch(/currency/i);
    }

    const MIGRATION = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "..",
        "supabase",
        "migrations",
        "20270509001971_issue_1971_ari_trip_lifecycle.sql",
      ),
      "utf8",
    );
    // Derived from the brand / the locked event row, never invented, and never
    // COALESCEd to a literal.
    expect(MIGRATION).toMatch(/SELECT default_currency INTO v_currency/);
    expect(MIGRATION).toMatch(/v_currency := v_event\.currency;/);
    expect(MIGRATION).not.toMatch(/'USD'/);
    expect(MIGRATION).not.toMatch(/COALESCE\(\s*v_currency/);
  });
});
