/**
 * META-ORCH-1059 regression — intent picker (4 ids + MULTI), the stop-card
 * freeze fix (memoization), and the universal Hub empty state.
 *
 * Mixed: behavioral assertions over the pure intent helpers + source-level
 * assertions over the wizard / step / hub wiring (the same source-probe style
 * the sibling metaOrch1059* tests use, so they run in the jsdom-free unit lane).
 *
 * fails-on-revert: each block asserts the NEW behavior; reverting any of the
 * three changes makes at least one assertion fail.
 */

import { readFileSync } from "fs";
import { join } from "path";

import {
  EXPERIENCE_INTENTS,
  EXPERIENCE_INTENT_IDS,
  asExperienceIntent,
  normalizeExperienceIntents,
  type ExperienceIntentId,
} from "../../../constants/experienceIntents";

// __dirname = mingla-business/src/components/experience/__tests__
const BIZ_ROOT = join(__dirname, "..", "..", "..", ".."); // → mingla-business
const REPO_ROOT = join(BIZ_ROOT, ".."); // → monorepo root (supabase/ lives here)
const read = (rel: string): string =>
  readFileSync(join(BIZ_ROOT, rel), "utf8");
const readRepo = (rel: string): string =>
  readFileSync(join(REPO_ROOT, rel), "utf8");

// ── CHANGE 1 — taxonomy is exactly the 4 KEPT ids ────────────────────────────
describe("intent taxonomy — 4 ids, picnic/stroll removed", () => {
  test("EXPERIENCE_INTENTS is exactly the 4 brand-experience ids in order", () => {
    expect(EXPERIENCE_INTENTS.map((o) => o.id)).toEqual([
      "adventurous",
      "first-date",
      "romantic",
      "group-fun",
    ]);
  });

  test("the removed ids are no longer valid", () => {
    expect(asExperienceIntent("picnic-dates")).toBeNull();
    expect(asExperienceIntent("take-a-stroll")).toBeNull();
    expect((EXPERIENCE_INTENT_IDS as readonly string[]).includes("picnic-dates")).toBe(false);
    expect((EXPERIENCE_INTENT_IDS as readonly string[]).includes("take-a-stroll")).toBe(false);
  });

  test("the kept ids still narrow", () => {
    for (const id of ["adventurous", "first-date", "romantic", "group-fun"] as ExperienceIntentId[]) {
      expect(asExperienceIntent(id)).toBe(id);
    }
  });
});

// ── CHANGE 2 — normalizeExperienceIntents (multi) ────────────────────────────
describe("normalizeExperienceIntents — dedupe, drop junk/removed, canonical order", () => {
  test("dedupes + drops removed/unknown ids", () => {
    expect(
      normalizeExperienceIntents([
        "romantic",
        "romantic",
        "picnic-dates", // removed → dropped
        "take-a-stroll", // removed → dropped
        "not-a-vibe", // junk → dropped
        "adventurous",
      ]),
    ).toEqual(["adventurous", "romantic"]); // canonical EXPERIENCE_INTENTS order
  });

  test("trims whitespace and tolerates null/undefined", () => {
    expect(normalizeExperienceIntents([" group-fun ", null, undefined, ""])).toEqual([
      "group-fun",
    ]);
    expect(normalizeExperienceIntents(null)).toEqual([]);
    expect(normalizeExperienceIntents(undefined)).toEqual([]);
  });

  test("returns all 4 when all are present, always in canonical order", () => {
    expect(
      normalizeExperienceIntents(["group-fun", "romantic", "first-date", "adventurous"]),
    ).toEqual(["adventurous", "first-date", "romantic", "group-fun"]);
  });
});

// ── CHANGE 3 — wizard is MULTI-select + ≥1 gate ──────────────────────────────
describe("wizard — multi-select intents + ≥1 gate", () => {
  const wiz = read("src/components/experience/ExperienceCreatorWizard.tsx");

  test("state is an array of intents (not a single intent)", () => {
    expect(wiz).toMatch(/useState<ExperienceIntentId\[\]>/);
    expect(wiz).toContain("toggleIntent");
  });

  test("the picker chips are checkbox (multi), not radio (single)", () => {
    expect(wiz).toContain('accessibilityRole="checkbox"');
    expect(wiz).not.toContain('accessibilityRole="radio"');
    expect(wiz).toContain("intents.includes(opt.id)");
  });

  test("Step-1 gate + publish gate require ≥1 intent", () => {
    expect(wiz).toMatch(/if \(step === 1\)[\s\S]*?intents\.length > 0/);
    expect(wiz).toMatch(/publish &&\s*\(\s*intents\.length === 0/);
  });

  test("payload sends the array under experience_intents", () => {
    expect(wiz).toContain("experience_intents: intents");
    expect(wiz).not.toContain("experience_intent: intent");
  });
});

// ── CHANGE 4 — migration: 4-id array column + RPC array read ──────────────────
describe("migration — experience_intents text[] + 4-id CHECK + RPC array read", () => {
  const mig = readRepo(
    "supabase/migrations/20260828000000_meta_orch_1059_experience_intents_multi.sql",
  );

  test("adds the array column", () => {
    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS experience_intents text\[\]/);
  });

  test("array CHECK allows only the 4 ids (no picnic/stroll)", () => {
    const m = /events_experience_intents_chk[\s\S]*?CHECK[\s\S]*?ARRAY\[([\s\S]*?)\]/.exec(mig);
    expect(m).not.toBeNull();
    const body = (m as RegExpExecArray)[1];
    expect(body).toContain("'adventurous'");
    expect(body).toContain("'group-fun'");
    expect(body).not.toContain("picnic-dates");
    expect(body).not.toContain("take-a-stroll");
  });

  test("both RPCs read experience_intents (array) + require ≥1 at publish", () => {
    expect(
      (mig.match(/jsonb_typeof\(p_payload->'experience_intents'\) = 'array'/g) ?? []).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      (mig.match(/RAISE EXCEPTION 'experience_intent_required'/g) ?? []).length,
    ).toBeGreaterThanOrEqual(2);
  });
});

// ── CHANGE 5 — stop-card freeze fix (memoization) ────────────────────────────
describe("freeze fix — memoized stop card + stable clientId handlers", () => {
  test("ExperienceStopCard is wrapped in React.memo", () => {
    const card = read("src/components/experience/ExperienceStopCard.tsx");
    expect(card).toMatch(/React\.memo\(ExperienceStopCardImpl\)/);
  });

  test("StopsStep renders the memoized card (not an inline GlassCard map)", () => {
    const step = read("src/components/experience/ExperienceStopsStep.tsx");
    expect(step).toContain("<ExperienceStopCard");
    // handlers are clientId-keyed + stable (deps are [setStops]/[moveStopBy] only)
    expect(step).toMatch(/patchStop[\s\S]*?\[setStops\]/);
    expect(step).toMatch(/\(clientId: string,/);
    // the old index-based updateStop is gone
    expect(step).not.toContain("updateStop(i,");
  });
});

// ── CHANGE 6 — universal Hub empty state ─────────────────────────────────────
describe("hub empty state — universal 'Create your first offering'", () => {
  const events = read("app/(tabs)/hub/events.tsx");

  test("renders the universal copy when nothing is created at all", () => {
    expect(events).toContain("Nothing created yet");
    expect(events).toContain("Create your first offering");
    expect(events).toContain("hasNoOfferingsAtAll");
  });

  test("the universal CTA opens the shared offering chooser (not /event/create)", () => {
    expect(events).toContain("openOfferingChooser");
    expect(events).toContain("useHubCreatorStore");
    // 'No events yet' / 'Build a new event' still exist for the events-have-others case
    expect(events).toContain("No events yet");
  });

  test("the layout wires the shared chooser flag into UniversalCreatorSheet", () => {
    const layout = read("app/(tabs)/hub/_layout.tsx");
    expect(layout).toContain("useHubCreatorStore");
    expect(layout).toMatch(/creatorRequestOpen[\s\S]*?setIsUniversalCreatorOpen\(true\)/);
  });
});
