/**
 * ORCH-0949 [Intake form clarity for organisers] — happy-path regression test.
 *
 * The trip intake form is the planner's ONE moment to collect per-traveler
 * info; buyers fill it BEFORE paying, once per ticket. Pre-ORCH-0949 neither
 * the planner-side builder nor the buyer-side fill screen made this contract
 * explicit, so planners shipped incomplete schemas thinking they could "ask
 * later" (they can't) and buyers didn't realize they were filling one form
 * per ticket.
 *
 * The fix adds:
 *   - planner-side intro banner inside <IntakeSchemaBuilder /> (used by both
 *     TripCreatorStep6Intake.tsx for creation AND
 *     EditPublishedTripIntakeAccordion.tsx for post-publish edits — single
 *     source of truth so the copy can't drift between create + edit surfaces)
 *   - buyer-side one-line context above the form on
 *     app/checkout-trip/[tripEventId]/intake.tsx
 *
 * Source-pattern presence test (mirror ORCH-0884 regression pattern). A revert
 * that deletes the banner copy or context line causes this gate to FAIL.
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

describe("ORCH-0949 — planner-side upfront-clarity banner", () => {
  test("IntakeSchemaBuilder renders the upfront banner with required copy", () => {
    const src = readFileSync(SCHEMA_BUILDER_PATH, "utf8");
    // testID anchor — banner must be wired with the stable testID so future
    // E2E + adversarial tests can target it.
    expect(src).toMatch(/testID=["']intake-upfront-banner["']/);
    // Title copy carries the "EVERYTHING upfront" framing — the operator
    // directive 2026-05-24 explicitly requires this phrasing.
    expect(src).toMatch(/Ask EVERYTHING you need upfront/);
    // Body copy must call out: only moment, BEFORE paying, once per ticket,
    // can't ask again after payment.
    expect(src).toMatch(/only moment you'll collect info/i);
    expect(src).toMatch(/BEFORE paying/);
    expect(src).toMatch(/once per ticket/i);
    expect(src).toMatch(/can't ask again after they've paid/i);
  });

  test("banner sits ABOVE the question list (not below — order matters for first-glance read)", () => {
    const src = readFileSync(SCHEMA_BUILDER_PATH, "utf8");
    const bannerIdx = src.indexOf('testID="intake-upfront-banner"');
    const eyebrowIdx = src.indexOf("INTAKE QUESTIONS (");
    expect(bannerIdx).toBeGreaterThan(0);
    expect(eyebrowIdx).toBeGreaterThan(0);
    // Banner JSX must appear in source order BEFORE the eyebrow / question
    // list. If a future refactor moves the banner below, planners would see
    // the questions first and miss the contract.
    expect(bannerIdx).toBeLessThan(eyebrowIdx);
  });
});

describe("ORCH-0949 — buyer-side one-line context", () => {
  test("buyer intake.tsx renders the one-line context with required copy", () => {
    const src = readFileSync(BUYER_INTAKE_PATH, "utf8");
    expect(src).toMatch(/testID=["']intake-upfront-context["']/);
    expect(src).toMatch(/Fill in details for each traveler/);
    expect(src).toMatch(/one form per ticket/i);
  });

  test("context line sits IMMEDIATELY above the IntakeFormRenderer", () => {
    const src = readFileSync(BUYER_INTAKE_PATH, "utf8");
    const contextIdx = src.indexOf('testID="intake-upfront-context"');
    const rendererIdx = src.indexOf("<IntakeFormRenderer");
    expect(contextIdx).toBeGreaterThan(0);
    expect(rendererIdx).toBeGreaterThan(0);
    // The context line is the last thing buyers read before the first
    // question. Must precede the form in source order.
    expect(contextIdx).toBeLessThan(rendererIdx);
  });
});
