/**
 * ORCH-1144 [universal experience-create chooser] — TESTER adversarial regression.
 *
 * DIFFERENT ANGLE from the implementor's `hubExperiences.contract.test.ts`
 * (which is a source-grep of the tab + a presence-grep of the chooser testIDs).
 * This suite attacks three failure modes the implementor's happy-path test does
 * NOT cover:
 *
 *   (A) DEAD TAPS (Constitution #1 / SC-10) — every `route:` literal the chooser
 *       can push MUST resolve to a real Expo Router route file on disk. A typo'd
 *       or unregistered route ("/experience/snapp", "/experience/build") would
 *       pass the implementor's testID grep but is a white-screen dead tap at
 *       runtime. We parse the route literals out of the OPTIONS array and stat
 *       each destination file.
 *
 *   (B) CATEGORY-AGNOSTIC PARSE-MODE (SC-8) — a `creative_and_arts` / null-
 *       category brand (previously STRANDED) must reach BOTH parsers. We prove
 *       the snap route derives `parseMode` SOLELY from the URL `mode` param and
 *       NEVER from the brand's `venueCategory`. If a future edit re-derived the
 *       mode from the brand, the stranded brand would silently lose a parser
 *       even though the chooser still shows three rows.
 *
 *   (C) ENTRY-POINT WIRING — the `+` sheet (UniversalCreatorSheet) experience
 *       row routes to `/experience/choose`, NOT straight to `/experience/create`
 *       (the pre-1144 behavior). If this regressed, SC-1 silently breaks while
 *       every other 1144 test still passes (they read the chooser/tab, not the
 *       entry sheet).
 *
 * fails-on-revert: re-introducing the deleted `venueCategory` parse-mode router
 * into snap.tsx flips (B); pointing UniversalCreatorSheet back at
 * `/experience/create` flips (C); a route typo flips (A).
 */
import { describe, expect, test } from "@jest/globals";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const APP_DIR = join(__dirname, "..", "..");
const CHOOSER = join(
  APP_DIR,
  "..",
  "src",
  "components",
  "experience",
  "ExperienceCreateChooser.tsx",
);
const SNAP_ROUTE = join(__dirname, "..", "snap.tsx");
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
  const chooser = readFileSync(CHOOSER, "utf8");
  // Pull every `route: "..."` literal out of the OPTIONS array.
  const routeLiterals = Array.from(
    chooser.matchAll(/route:\s*"([^"]+)"/g),
    (m) => m[1],
  );

  test("the chooser declares exactly the 3 expected routes", () => {
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

describe("ORCH-1144 entry-point wiring (C)", () => {
  const sheet = readFileSync(UNIVERSAL_SHEET, "utf8");

  test("the + sheet experience row routes to the chooser, not the manual wizard", () => {
    // The experience CreatorOption must point at /experience/choose.
    expect(sheet).toMatch(/route:\s*"\/experience\/choose"/);
    // And must NOT still point straight at /experience/create (pre-1144).
    expect(sheet).not.toMatch(/route:\s*"\/experience\/create"/);
  });
});
