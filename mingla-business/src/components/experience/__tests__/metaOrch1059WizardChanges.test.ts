/**
 * META-ORCH-1059 [experiences-business-parity] · WIZARD CHANGES 1+2+3 regression.
 *
 * CHANGE 1 — no validation error on step entry; errors only after Continue.
 * CHANGE 2 — required curated-intent picker on Step 1 (the 6 consumer ids).
 * CHANGE 3 — compulsory per-stop description.
 *
 * Mix of pure-logic assertions (the exported helpers + intent taxonomy) and
 * source assertions for the gating wiring that can't be exercised headless.
 * Each assertion FAILS on revert of the corresponding change.
 */

import { readFileSync } from "fs";
import { join } from "path";

import {
  emptyStop,
  stopHasValidDescription,
  MAX_STOP_DESCRIPTION,
  type ExperienceStopDraft,
} from "../experienceWizardTypes";
import {
  EXPERIENCE_INTENTS,
  EXPERIENCE_INTENT_IDS,
  asExperienceIntent,
} from "../../../constants/experienceIntents";

const SRC = join(__dirname, "..", "..");
const read = (rel: string): string => readFileSync(join(SRC, rel), "utf8");

// ── CHANGE 2 — curated intent taxonomy mirrors the consumer app exactly ───────

describe("CHANGE 2 — curated intent taxonomy", () => {
  test("the 6 ids match the consumer ONBOARDING_INTENTS / curatedExperience union", () => {
    expect([...EXPERIENCE_INTENT_IDS].sort()).toEqual(
      [
        "adventurous",
        "first-date",
        "group-fun",
        "picnic-dates",
        "romantic",
        "take-a-stroll",
      ].sort(),
    );
  });

  test("labels mirror the consumer onboarding labels (not invented)", () => {
    const byId = Object.fromEntries(EXPERIENCE_INTENTS.map((i) => [i.id, i.label]));
    expect(byId["adventurous"]).toBe("Adventurous");
    expect(byId["first-date"]).toBe("First Dates");
    expect(byId["romantic"]).toBe("Romantic");
    expect(byId["group-fun"]).toBe("Group Fun");
    expect(byId["picnic-dates"]).toBe("Picnic Dates");
    expect(byId["take-a-stroll"]).toBe("Take a Stroll");
  });

  test("asExperienceIntent narrows valid ids and rejects junk", () => {
    expect(asExperienceIntent("romantic")).toBe("romantic");
    expect(asExperienceIntent("not-a-vibe")).toBeNull();
    expect(asExperienceIntent(null)).toBeNull();
    expect(asExperienceIntent(undefined)).toBeNull();
  });

  test("wizard makes intent part of the Step-1 Continue gate + publish gate", () => {
    const src = read("experience/ExperienceCreatorWizard.tsx");
    // Step-1 canContinue requires intent !== null.
    expect(src).toMatch(/if \(step === 1\)[\s\S]*?intent !== null/);
    // Publish is blocked when intent is null.
    expect(src).toMatch(/publish &&\s*\(\s*intent === null/);
    // The picker renders the canonical taxonomy.
    expect(src).toContain("EXPERIENCE_INTENTS.map");
    // Intent is sent in the payload.
    expect(src).toContain("experience_intent: intent");
  });
});

// ── CHANGE 3 — compulsory per-stop description ────────────────────────────────

describe("CHANGE 3 — compulsory per-stop description", () => {
  test("a fresh stop starts with an empty description (invalid until filled)", () => {
    const s = emptyStop();
    expect(s.description).toBe("");
    expect(stopHasValidDescription(s)).toBe(false);
  });

  test("stopHasValidDescription enforces 1..MAX bounds", () => {
    const base = emptyStop();
    const withDesc = (d: string): ExperienceStopDraft => ({ ...base, description: d });
    expect(stopHasValidDescription(withDesc("Sunset rooftop welcome drinks."))).toBe(true);
    expect(stopHasValidDescription(withDesc("   "))).toBe(false);
    expect(stopHasValidDescription(withDesc("x".repeat(MAX_STOP_DESCRIPTION)))).toBe(true);
    expect(stopHasValidDescription(withDesc("x".repeat(MAX_STOP_DESCRIPTION + 1)))).toBe(false);
  });

  test("StopsStep renders a description field gated on showErrors", () => {
    const src = read("experience/ExperienceStopsStep.tsx");
    // The field exists and is bound to stop.description.
    expect(src).toContain("Stop ${i + 1} description");
    expect(src).toMatch(/updateStop\(i, \{ description:/);
    // The error is computed ONLY when showErrors is true (CHANGE 1 spine).
    expect(src).toMatch(/descError =\s*\n?\s*showErrors && stop\.description\.trim\(\)\.length === 0/);
  });

  test("wizard sends the authored description as the stop ai_description (not '')", () => {
    const src = read("experience/ExperienceCreatorWizard.tsx");
    expect(src).toContain("ai_description: s.description.trim()");
    // It must NOT ship the old hardcoded empty string.
    expect(src).not.toContain('ai_description: "",');
    // stopsValid requires every stop's description.
    expect(src).toContain("stopHasValidDescription(s)");
  });
});

// ── CHANGE 1 — no errors on step entry; every inline error gated ──────────────

describe("CHANGE 1 — validation errors are gated, never shown on step entry", () => {
  test("every inline error in StopsStep is gated on showErrors", () => {
    const src = read("experience/ExperienceStopsStep.tsx");
    // nameError, descError, addrError, priceError all start from `showErrors &&`.
    expect(src).toMatch(/const nameError = showErrors &&/);
    expect(src).toMatch(/const descError =\s*\n?\s*showErrors &&/);
    expect(src).toMatch(/const addrError =\s*\n?\s*showErrors &&/);
    expect(src).toMatch(/const priceError =\s*\n?\s*showErrors &&/);
    // There is no UNGATED `<Text style={styles.inlineError}>` driven by a raw
    // condition (every inline error is rendered behind a *Error variable).
    expect(src).not.toMatch(/inlineError\}>Name this stop\.<\/Text>\s*\n?\s*: null\}\s*\n?\s*\{stop\.placeName/);
  });

  test("PricingStep gates its inline errors on showErrors", () => {
    const src = read("experience/ExperiencePricingStep.tsx");
    expect(src).toMatch(/showErrors && num\(wholePriceMajor\) <= 0/);
    expect(src).toMatch(/showErrors && \(parseInt\(capacity, 10\) \|\| 0\) <= 0/);
  });

  test("goNext resets showStepErrors to false before advancing (no carry-over on entry)", () => {
    const src = read("experience/ExperienceCreatorWizard.tsx");
    // The successful branch of goNext clears the flag, then advances.
    expect(src).toMatch(/setShowStepErrors\(false\);[\s\S]*?setStep\(\(prev\) => Math\.min\(5/);
  });

  test("draft create on leaving Step 1 does not toast premature stop errors (server gate is publish-only)", () => {
    // The bug was server-side: biz_create_experience(p_publish:=false) raised
    // stop_name_required on the empty seed stops. The forward migration gates it.
    const migration = readFileSync(
      join(
        SRC, // mingla-business/src/components
        "..",
        "..",
        "..",
        "supabase",
        "migrations",
        "20260827000000_meta_orch_1059_wizard_intent_desc_validation.sql",
      ),
      "utf8",
    );
    // stop_name_required must only appear behind a p_publish guard.
    const occurrences = migration.match(/stop_name_required/g) ?? [];
    expect(occurrences.length).toBeGreaterThan(0);
    // Every raise is preceded (same line) by `IF p_publish AND`.
    const ungated = /IF\s+NULLIF\(btrim\(COALESCE\(v_stop->>'place_name'[^\n]*\n[^\n]*RAISE EXCEPTION 'stop_name_required'/;
    expect(ungated.test(migration)).toBe(false);
  });
});
