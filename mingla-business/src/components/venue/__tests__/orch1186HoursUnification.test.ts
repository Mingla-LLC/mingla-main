/**
 * ORCH-1186-A — venue hours unification: implementor happy-path regression test.
 *
 * Runs under the default node/ts-jest config (no RTL) — same approach as the
 * ORCH-1184 implementor test: source-text wiring assertions + a pure-logic
 * weekday-remap unit. The DB behavior (seed/derive/remap/non-clobber) is proven
 * by the SQL probe `supabase/migrations/__tests__/orch_1186_hours_single_owner_seed.test.sql`;
 * the tester writes the adversarial render proof.
 *
 * FAILS-ON-REVERT (verified by true line-deletion of the fix, NOT comment-out):
 *  - T9: deleting the new "Opening hours" editor section + restoring the retired
 *    read-only "Your opening hours come from your venue profile" prose →
 *    T9a/T9b FAIL.
 *  - T8: removing the venueAvailabilityKeys.config cross-invalidation from
 *    useUpsertBrandHours → T8 FAILS (the Availability cache would go stale).
 *  - T11: collapsing the BrandHoursEditor extraction (re-coupling VenueStep4Hours
 *    to the store JSX) → T11 FAILS (the wizard no longer renders the shared editor).
 *  - REMAP: removing/altering the (weekday+1)%7 remap math → the remap unit FAILS.
 *
 * Append-only: NEW file; modifies/deletes no existing test.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const HOOKS = join(__dirname, "..", "..", "..", "hooks");
const MIGRATIONS = join(__dirname, "..", "..", "..", "..", "..", "supabase", "migrations");

const read = (p: string): string => readFileSync(p, "utf8");

/** Strip line + block comments so doc-comment prose never trips an assertion. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * The single load-bearing transform: brand_hours weekday (Mon=0..Sun=6) →
 * Postgres dow (Sun=0..Sat=6). This MUST match the SQL helper's `(weekday+1)%7`.
 */
const pgDowFromBrandWeekday = (weekday: number): number => (weekday + 1) % 7;

describe("ORCH-1186-A weekday remap (brand_hours Mon=0..Sun=6 → pg dow Sun=0..Sat=6)", () => {
  it("REMAP — Monday(0)→1, Tuesday(1)→2, … Saturday(5)→6, Sunday(6)→0", () => {
    expect(pgDowFromBrandWeekday(0)).toBe(1); // Mon
    expect(pgDowFromBrandWeekday(1)).toBe(2); // Tue
    expect(pgDowFromBrandWeekday(2)).toBe(3); // Wed
    expect(pgDowFromBrandWeekday(3)).toBe(4); // Thu
    expect(pgDowFromBrandWeekday(4)).toBe(5); // Fri
    expect(pgDowFromBrandWeekday(5)).toBe(6); // Sat
    expect(pgDowFromBrandWeekday(6)).toBe(0); // Sun
  });

  it("REMAP — the migration helper uses the identical (weekday + 1) % 7 formula", () => {
    const mig = read(
      join(MIGRATIONS, "20261116000000_orch_1186_a_hours_single_owner_seed.sql"),
    );
    // The derived days[] value itself MUST be the remap — not the raw weekday.
    // (A weak assertion on a stray ORDER BY would pass even with a broken days[];
    //  this targets the actual jsonb_build_array that lands in service_periods.)
    expect(mig).toMatch(
      /jsonb_build_array\(\s*\(\s*\(\s*h\.weekday\s*\+\s*1\s*\)\s*%\s*7\s*\)\s*\)/,
    );
    // and tags every derived period with the provenance marker.
    expect(mig).toContain("derived_from_hours");
  });
});

describe("ORCH-1186-A T8 — useUpsertBrandHours dual cache invalidation", () => {
  const hook = read(join(HOOKS, "useBrandHours.ts"));

  it("T8 — invalidates BOTH the hours key AND the Availability config key", () => {
    expect(hook).toContain("brandHoursKeys.byBrand(brandId)");
    expect(hook).toContain("venueAvailabilityKeys.config(brandId)");
  });

  it("T8 — hours are server state (React Query), never parked in Zustand", () => {
    expect(hook).not.toMatch(/useDraftVenueStore|zustand|create\(/);
  });
});

describe("ORCH-1186-A T9 — Settings has no read-only dead-end; real hours editor", () => {
  const mod = stripComments(read(join(SRC, "VenueSettingsModule.tsx")));

  it("T9a — the retired read-only hours prose is GONE", () => {
    expect(mod).not.toContain(
      "Your opening hours come from your venue profile",
    );
  });

  it("T9b — renders the BrandHoursEditor with a working Save path", () => {
    expect(mod).toContain("BrandHoursEditor");
    expect(mod).toContain("useUpsertBrandHours");
    expect(mod).toContain("venue-settings-hours-save");
  });

  it("T9c — every creation field is reachable (details + photos/vibes/AI affordances)", () => {
    expect(mod).toContain("venue-settings-edit-details");
    expect(mod).toContain("venue-settings-edit-photos");
    expect(mod).toContain("venue-settings-rerun-recommend");
  });

  it("T10 — every mutation control is manager-plus gated (canMutate)", () => {
    // The Save block + each edit affordance is wrapped in a canMutate guard.
    expect(mod).toContain("canMutate = rank >= MANAGER_PLUS_RANK");
    expect(mod).toContain("canMutate && hoursDraft !== null ?");
    // The Save button itself is also disabled while not dirty / saving.
    expect(mod).toMatch(/disabled=\{!hoursDirty \|\| hoursInvalid/);
  });

  it("SC-6/I-1148-NO-BUYER-TAX-FORM — no billing-address / Calculate-tax field", () => {
    expect(mod).not.toMatch(/Calculate tax/i);
    expect(mod).not.toMatch(/BILLING ADDRESS/i);
  });
});

describe("ORCH-1186-A T11 — VenueStep4Hours is a thin wrapper over the shared editor", () => {
  const wizard = read(join(SRC, "VenueStep4Hours.tsx"));

  it("T11 — the wizard step renders the extracted BrandHoursEditor", () => {
    expect(wizard).toContain("BrandHoursEditor");
    // still binds the draft store (wizard parity) and keeps the step copy.
    expect(wizard).toContain("useDraftVenueStore");
    expect(wizard).toContain("Opening hours");
    expect(wizard).toContain("Default: Mon–Sat 9–5, Sun closed.");
  });

  it("T11 — the editor itself is controlled (no store coupling inside it)", () => {
    const editor = read(join(SRC, "BrandHoursEditor.tsx"));
    expect(editor).not.toContain("useDraftVenueStore");
    expect(editor).toContain("onChange");
    // web time-control branch + bulk-chip hitSlop fix (design D.3/D.9/D.10).
    expect(editor).toContain('Platform.OS === "web"');
    expect(editor).toContain("hitSlop");
  });
});
