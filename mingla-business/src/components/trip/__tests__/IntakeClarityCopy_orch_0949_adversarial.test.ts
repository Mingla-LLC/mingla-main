/**
 * ORCH-0949 [Intake form clarity for organisers] — adversarial regression test.
 *
 * The happy-path test (IntakeClarityCopy_orch_0949_regression.test.ts) verifies
 * the banner + context render with the required copy and ordering. This file
 * attacks DIFFERENT failure modes that the happy-path test cannot catch:
 *
 * A-1. Banner SOURCE: the planner banner must live inside the shared
 *      <IntakeSchemaBuilder /> component — NOT inline in TripCreatorStep6Intake
 *      only. A future "well, we have it on Step 6, that's enough" regression
 *      would silently hide the contract from the post-publish edit accordion
 *      (EditPublishedTripIntakeAccordion.tsx). Verified by asserting the
 *      banner does NOT appear inline in the two consumer wrappers — it must
 *      come through the shared builder render.
 *
 * A-2. Buyer-side context is RENDERED UNCONDITIONALLY, not gated by
 *      multi-tier branch. A naive placement inside the `totalTiers > 1` block
 *      would hide the context for the vast majority of trips (single-tier),
 *      defeating the entire ORCH. Verified by asserting the context JSX is
 *      NOT enclosed inside a `totalTiers > 1` ternary.
 *
 * A-3. testID values are unique across the file (a duplicate testID would
 *      break E2E selectors and break future adversarial harnesses).
 *
 * A-4. Copy does NOT contradict the data model: the banner says "can't ask
 *      again after they've paid" — but schema_version_id bumps DO trigger
 *      re-answer flows for unsubmitted travelers. The copy is correct for
 *      the paid-traveler audience. We assert the banner specifically scopes
 *      its "can't ask again" claim to the post-payment case (i.e., the
 *      sentence pairs "after they've paid" — NOT a global "can't ask again
 *      ever" which would be a lie given the version-bump re-answer flow).
 */

/* eslint-disable import/first */
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

const SCHEMA_BUILDER_PATH = path.join(
  __dirname,
  "..",
  "IntakeSchemaBuilder.tsx",
);
const STEP6_PATH = path.join(__dirname, "..", "TripCreatorStep6Intake.tsx");
const EDIT_ACCORDION_PATH = path.join(
  __dirname,
  "..",
  "EditPublishedTripIntakeAccordion.tsx",
);
const BUYER_INTAKE_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "app",
  "checkout-trip",
  "[tripEventId]",
  "intake.tsx",
);

describe("ORCH-0949 A-1 — banner lives in shared builder, not inline in consumers", () => {
  test("TripCreatorStep6Intake does NOT inline the banner copy", () => {
    const src = readFileSync(STEP6_PATH, "utf8");
    // If a future regression copy-pastes the banner into Step 6, it would
    // double-render for creation AND drift between create + edit surfaces.
    expect(src).not.toMatch(/intake-upfront-banner/);
    expect(src).not.toMatch(/Ask EVERYTHING you need upfront/);
  });

  test("EditPublishedTripIntakeAccordion does NOT inline the banner copy", () => {
    const src = readFileSync(EDIT_ACCORDION_PATH, "utf8");
    expect(src).not.toMatch(/intake-upfront-banner/);
    expect(src).not.toMatch(/Ask EVERYTHING you need upfront/);
  });

  test("the banner exists in EXACTLY ONE place (the shared builder)", () => {
    const builderSrc = readFileSync(SCHEMA_BUILDER_PATH, "utf8");
    const occurrences = (builderSrc.match(/intake-upfront-banner/g) || [])
      .length;
    // Exactly one testID occurrence in the shared builder.
    expect(occurrences).toBe(1);
  });
});

describe("ORCH-0949 A-2 — buyer context renders unconditionally", () => {
  test("buyer intake.tsx renders the context line OUTSIDE any totalTiers > 1 gate", () => {
    const src = readFileSync(BUYER_INTAKE_PATH, "utf8");
    const contextIdx = src.indexOf('testID="intake-upfront-context"');
    expect(contextIdx).toBeGreaterThan(0);

    // Walk backwards from the context JSX to the nearest opening
    // `totalTiers > 1` ternary. If we hit `<IntakeFormRenderer` (the
    // sibling that we KNOW is unconditional) before any totalTiers gate,
    // the context is in the unconditional region — pass.
    //
    // Concretely: find the LAST occurrence of `totalTiers > 1` BEFORE the
    // context, and the LAST closing `) : null}` between that gate and
    // the context. If a closing `) : null}` exists between the gate and
    // the context, the context is OUTSIDE that gate.
    const head = src.slice(0, contextIdx);
    const lastGateOpen = head.lastIndexOf("totalTiers > 1");
    if (lastGateOpen === -1) {
      // No multi-tier gate appears before the context at all — passes
      // trivially (context is unconditional).
      return;
    }
    const tail = head.slice(lastGateOpen);
    // Look for the gate's closing `) : null}` between the gate and the
    // context. If present, the context lives OUTSIDE the gate.
    expect(tail).toMatch(/\)\s*:\s*null\s*\}/);
  });
});

describe("ORCH-0949 A-3 — testIDs are unique within each file", () => {
  test("intake-upfront-banner appears exactly once in IntakeSchemaBuilder", () => {
    const src = readFileSync(SCHEMA_BUILDER_PATH, "utf8");
    const matches = src.match(/intake-upfront-banner/g) || [];
    expect(matches.length).toBe(1);
  });

  test("intake-upfront-context appears exactly once in buyer intake.tsx", () => {
    const src = readFileSync(BUYER_INTAKE_PATH, "utf8");
    const matches = src.match(/intake-upfront-context/g) || [];
    expect(matches.length).toBe(1);
  });
});

describe("ORCH-0949 A-4 — 'can't ask again' claim is scoped to post-payment", () => {
  test("banner body pairs 'can't ask again' with 'after they've paid' (not a global lie)", () => {
    const src = readFileSync(SCHEMA_BUILDER_PATH, "utf8");
    // The sentence "You can't ask again after they've paid." is scoped.
    // A naive "You can't ask again." (full stop, unscoped) would be wrong
    // because schema_version_id bumps DO re-trigger fills for unpaid
    // travelers. The assertion enforces the scoped form.
    expect(src).toMatch(/can't ask again after they've paid/i);
    // Negative assertion: the unscoped form must NOT appear.
    expect(src).not.toMatch(/You can't ask again\.\s*<\/Text>/);
    expect(src).not.toMatch(/You can't ask again\s*\./);
  });
});
