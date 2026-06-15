/**
 * ORCH-1144 [universal experience-create chooser] — TESTER adversarial regression.
 *
 * DIFFERENT ANGLE from the implementor's `hubExperiences.contract.test.ts`
 * (which is a source-grep of the tab + a presence-grep of the chooser testIDs).
 * This suite attacks three failure modes the implementor's happy-path test does
 * NOT cover:
 *
 *   (A) DEAD TAPS (Constitution #1 / SC-10) — every experience-step `route:`
 *       literal the sheet can push MUST resolve to a real Expo Router route file
 *       on disk. A typo'd or unregistered route ("/experience/snapp",
 *       "/experience/build") would pass a testID grep but is a white-screen dead
 *       tap at runtime. ORCH-1144 UX refinement folded the chooser in-sheet, so
 *       we now parse the EXPERIENCE_OPTIONS route literals out of
 *       UniversalCreatorSheet.tsx (the retired ExperienceCreateChooser.tsx is
 *       gone) and stat each destination file.
 *
 *   (B) CATEGORY-AGNOSTIC PARSE-MODE (SC-8) — a `creative_and_arts` / null-
 *       category brand (previously STRANDED) must reach BOTH parsers. We prove
 *       the snap route derives `parseMode` SOLELY from the URL `mode` param and
 *       NEVER from the brand's `venueCategory`. If a future edit re-derived the
 *       mode from the brand, the stranded brand would silently lose a parser
 *       even though the chooser still shows three rows.
 *
 *   (C) ENTRY-POINT WIRING (ORCH-1144 UX refinement) — the `+` sheet experience
 *       row must NOT push `/experience/choose` (a separate sheet was retired) and
 *       must NOT route straight to `/experience/create` (pre-1144). It now
 *       transitions the SAME sheet IN-PLACE to its "experience" step
 *       (`step: "experience"` on the experience RootOption). If this regressed —
 *       a re-introduced push, or a missing step transition — SC-1 silently breaks
 *       while the other 1144 tests still pass (they read the tab/snap route, not
 *       the entry sheet's step machine).
 *
 * fails-on-revert: re-introducing the deleted `venueCategory` parse-mode router
 * into snap.tsx flips (B); pointing the experience row back at a `/experience/*`
 * push instead of an in-place step flips (C); a route typo flips (A).
 */
import { describe, expect, test } from "@jest/globals";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const APP_DIR = join(__dirname, "..", "..");
const SNAP_ROUTE = join(__dirname, "..", "snap.tsx");
// ORCH-1144 UX refinement — the 3-option experience chooser was folded INTO
// UniversalCreatorSheet (step "experience"); ExperienceCreateChooser.tsx + the
// /experience/choose route were retired. The experience route literals now live
// in this file's EXPERIENCE_OPTIONS array.
const UNIVERSAL_SHEET = join(
  APP_DIR,
  "..",
  "src",
  "components",
  "ui",
  "UniversalCreatorSheet.tsx",
);

/** Map an Expo-Router push path (minus query string) to its route file on disk. */
function routeFileFor(routePath: string): string {
  const clean = routePath.split("?")[0].replace(/^\//, ""); // "experience/snap"
  return join(APP_DIR, "..", "app", `${clean}.tsx`);
}

describe("ORCH-1144 chooser — no dead taps (A)", () => {
  const sheet = readFileSync(UNIVERSAL_SHEET, "utf8");
  // The experience chooser now lives in-sheet. Pull route literals from the
  // EXPERIENCE_OPTIONS array only (the root options route to /event/create +
  // /trip/create, which are NOT experience destinations and not under test here).
  const expBlock =
    sheet.match(
      /EXPERIENCE_OPTIONS:\s*readonly\s+ChooserOption\[\]\s*=\s*\[([\s\S]*?)\n\]\s*as const;/,
    )?.[1] ?? "";
  const routeLiterals = Array.from(
    expBlock.matchAll(/route:\s*"([^"]+)"/g),
    (m) => m[1],
  );

  test("the in-sheet experience chooser declares exactly the 3 expected routes", () => {
    expect(routeLiterals.sort()).toEqual(
      [
        "/experience/create",
        "/experience/snap?mode=activities",
        "/experience/snap?mode=menu",
      ].sort(),
    );
  });

  test.each([
    "/experience/snap?mode=menu",
    "/experience/snap?mode=activities",
    "/experience/create",
  ])("route %s resolves to a real route file (no dead tap)", (routePath) => {
    expect(routeLiterals).toContain(routePath);
    expect(existsSync(routeFileFor(routePath))).toBe(true);
  });
});

describe("ORCH-1144 snap route — category-agnostic parse mode (B)", () => {
  const snap = readFileSync(SNAP_ROUTE, "utf8");

  test("parseMode is derived from the URL `mode` param, not the brand", () => {
    // The explicit param coercion must be present...
    expect(snap).toMatch(
      /params\.mode\s*===\s*"activities"\s*\?\s*"activities"\s*:\s*"menu"/,
    );
  });

  test("snap route never branches parse mode on venueCategory", () => {
    // A creative_and_arts / null-category brand must reach BOTH parsers — the
    // route must not re-derive the mode from the brand category. (A prose
    // comment mentioning the word is fine; a real member-access GATE is not.)
    expect(snap).not.toMatch(/\.venueCategory/); // member access (a real read)
    expect(snap).not.toMatch(/venueCategory ===/); // equality gate
    expect(snap).not.toMatch(/canGenerateExperiencesFrom/);
  });

  test("snap route reads currentBrand only for ownership/context, not gating", () => {
    // It may load the brand (for brandId), but must not gate the SnapInput
    // selection on the brand's category.
    expect(snap).not.toMatch(/currentBrand[^\n]*venueCategory/);
  });
});

describe("ORCH-1144 entry-point wiring (C) — in-place experience step", () => {
  const sheet = readFileSync(UNIVERSAL_SHEET, "utf8");

  test("the separate /experience/choose route is fully retired", () => {
    // The whole point of the UX refinement: no sheet-swap to a /experience/choose
    // route anywhere in the entry sheet.
    expect(sheet).not.toMatch(/\/experience\/choose/);
  });

  test("the experience root option steps IN-PLACE, it does not push a route", () => {
    // Isolate the experience RootOption block (key: "experience" ... testID).
    const expRoot =
      sheet.match(
        /key:\s*"experience",[\s\S]*?testID:\s*"universal-creator-experience",/,
      )?.[0] ?? "";
    expect(expRoot).not.toBe("");
    // It transitions the sheet to the "experience" step...
    expect(expRoot).toMatch(/step:\s*"experience"/);
    // ...and does NOT carry a `route:` literal (no close+push; no dead sheet-swap).
    expect(expRoot).not.toMatch(/route:\s*"/);
  });

  test("the experience step actually renders the 3 chooser destinations", () => {
    // The in-place step must mount the EXPERIENCE_OPTIONS the chooser used to own,
    // so the row is not a step into a blank screen (a different dead-tap class).
    expect(sheet).toMatch(/"\/experience\/snap\?mode=menu"/);
    expect(sheet).toMatch(/"\/experience\/snap\?mode=activities"/);
    expect(sheet).toMatch(/"\/experience\/create"/);
  });
});
