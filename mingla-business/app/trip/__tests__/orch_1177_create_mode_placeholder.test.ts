/**
 * ORCH-1177 [trip-wizard-discard-prompt] — a fresh trip-create draft must route
 * Close X / Android back through the create-mode DISCARD path (pristine → discard
 * orphan + exit; dirty → "Discard this trip?" confirm), NOT the silent edit-mode
 * autosave + bounce-to-Home.
 *
 * Root cause (INVESTIGATE_ORCH-1177): `createTripDraft` seeds the title with the
 * placeholder "Untitled trip" (NOT an empty string), but `isCreateMode` required
 * `trip.title.length === 0`. So a never-edited draft was misclassified as
 * edit-mode → Close silently autosaved + router.back()'d to Home with no confirm.
 *
 * The fix: export the placeholder title as a shared const
 * (TRIP_DRAFT_PLACEHOLDER_TITLE) used by BOTH the seed and the isCreateMode guard,
 * and treat that placeholder title as still-pristine in the guard.
 *
 * This file proves: (1) the create-mode PREDICATE (replicated from edit.tsx)
 * classifies a fresh placeholder-title draft as create-mode; (2) a real edited
 * trip stays edit-mode; (3) a SOURCE-GUARD that the seed + the guard reference the
 * SAME exported const (fails-on-revert if the literal drifts).
 */

/* eslint-disable import/first */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, jest, test } from "@jest/globals";

// tripsService.ts imports the real Supabase client (expo-constants ESM), which
// the node/ts-jest env can't transpile. We only need the exported const, so stub
// the supabase module (mirrors src/services/__tests__/tripsService.test.ts). The
// path resolves to the SAME module tripsService imports as `./supabase`.
jest.mock("../../../src/services/supabase", () => ({
  supabase: {
    from: () => ({}),
    rpc: () => ({}),
    auth: { getUser: () => ({ data: { user: null } }) },
  },
}));

import { TRIP_DRAFT_PLACEHOLDER_TITLE } from "../../../src/services/tripsService";

// Replicate the exact isCreateMode predicate from app/trip/[id]/edit.tsx so the
// classification can be unit-tested without rendering the expo-router screen.
function isCreateMode(trip: {
  status: string;
  title: string;
  days: unknown[];
  inclusions: unknown[];
}): boolean {
  return (
    trip.status === "draft" &&
    (trip.title.length === 0 || trip.title === TRIP_DRAFT_PLACEHOLDER_TITLE) &&
    trip.days.length === 0 &&
    trip.inclusions.length === 0
  );
}

describe("ORCH-1177 — fresh placeholder-title draft is create-mode", () => {
  // ── HAPPY — a fresh draft (seeded placeholder title, no days/inclusions) ──
  test("a fresh draft with the placeholder title is create-mode (→ discard path)", () => {
    const fresh = {
      status: "draft",
      title: TRIP_DRAFT_PLACEHOLDER_TITLE, // "Untitled trip" — what createTripDraft seeds
      days: [],
      inclusions: [],
    };
    expect(isCreateMode(fresh)).toBe(true);
  });

  test("an empty-string-title draft is still create-mode (back-compat)", () => {
    expect(
      isCreateMode({ status: "draft", title: "", days: [], inclusions: [] }),
    ).toBe(true);
  });

  // ── ADVERSARIAL — a real edited / published trip stays EDIT-mode ──
  test("a draft with a real (non-placeholder) title is NOT create-mode", () => {
    expect(
      isCreateMode({
        status: "draft",
        title: "Tuscany Wine Tour",
        days: [],
        inclusions: [],
      }),
    ).toBe(false);
  });

  test("a placeholder-title draft that already has days is NOT create-mode (edited)", () => {
    expect(
      isCreateMode({
        status: "draft",
        title: TRIP_DRAFT_PLACEHOLDER_TITLE,
        days: [{ ordinal: 1 }],
        inclusions: [],
      }),
    ).toBe(false);
  });

  test("a non-draft (published) trip is never create-mode regardless of title", () => {
    expect(
      isCreateMode({
        status: "live",
        title: TRIP_DRAFT_PLACEHOLDER_TITLE,
        days: [],
        inclusions: [],
      }),
    ).toBe(false);
  });
});

describe("ORCH-1177 — source guard: seed + guard share ONE const (no drift)", () => {
  const SERVICE = readFileSync(
    join(__dirname, "..", "..", "..", "src", "services", "tripsService.ts"),
    "utf8",
  );
  const EDIT = readFileSync(
    join(__dirname, "..", "..", "..", "app", "trip", "[id]", "edit.tsx"),
    "utf8",
  );
  const strip = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  test("the const value is exactly the historical placeholder literal", () => {
    // If someone changes the displayed placeholder, BOTH sites move together via
    // this const; this pins the value the create-mode guard keys off.
    expect(TRIP_DRAFT_PLACEHOLDER_TITLE).toBe("Untitled trip");
  });

  test("tripsService exports the const AND seeds the draft title FROM it", () => {
    const src = strip(SERVICE);
    expect(src).toMatch(
      /export const TRIP_DRAFT_PLACEHOLDER_TITLE = "Untitled trip";/,
    );
    // The seed uses the const, NOT a bare duplicated literal.
    expect(src).toMatch(
      /const tempTitle = input\.initialTitle\?\.trim\(\) \|\| TRIP_DRAFT_PLACEHOLDER_TITLE;/,
    );
  });

  test("edit.tsx imports the const AND the isCreateMode guard references it", () => {
    const src = strip(EDIT);
    expect(src).toContain(
      'import { TRIP_DRAFT_PLACEHOLDER_TITLE } from "../../../src/services/tripsService"',
    );
    expect(src).toMatch(
      /trip\.title\.length === 0 \|\| trip\.title === TRIP_DRAFT_PLACEHOLDER_TITLE/,
    );
  });
});
