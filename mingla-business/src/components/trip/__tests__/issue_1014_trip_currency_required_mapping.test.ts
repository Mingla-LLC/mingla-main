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

  test("the pre-existing ORCH-1075 cases are untouched", () => {
    expect(SOURCE).toContain('case "stripe_charges_disabled":');
    expect(SOURCE).toContain('case "offering_date_past":');
  });
});
