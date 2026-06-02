// @ts-nocheck
// ORCH-1044 T-01…T-08 (implementor-owned, happy-path) regression test.
//
// Deno-runnable: it imports the PURE resolver `resolveReadableCategoryName`
// from categoryUtils.ts and injects a minimal i18n stub, so it never boots the
// RN i18n module (AsyncStorage + react-i18next). This is the §6.1(a) test seam.
//
// Fails-on-revert anchor for the D-1 fix: the stub registers ONLY the real
// `category_*` keys that exist in en/common.json and NO `category_romantic` /
// `intent_*` keys — reproducing the exact production resource state that
// triggered the leak. With the OLD `translated === key` guard, the namespace-
// stripped miss-return ("category_romantic") never equals the prefixed key
// ("common:category_romantic"), so the resolver leaked "category_romantic"
// and T-01…T-06 FAIL. With the `exists()` guard they return the friendly label.
import {
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { resolveReadableCategoryName } from "../categoryUtils.ts";

// Minimal i18n stub mirroring the production resource state at bug time:
// only the REAL category_* keys present in en/common.json are registered.
// NO category_romantic / category_adventurous / intent_* keys exist — exactly
// why curated labels missed and leaked their bare key.
const REAL_CATEGORY_KEYS: Record<string, string> = {
  "common:category_nature": "Nature & Views",
  "common:category_casual_food": "Casual",
  "common:category_casual": "Casual",
  "common:category_upscale_fine_dining": "Fine Dining",
  "common:category_brunch": "Brunch",
  "common:category_movies": "Movies",
  "common:category_theatre": "Theatre",
  "common:category_creative_arts": "Creative & Arts",
  "common:category_play": "Play",
  "common:category_icebreakers": "Icebreakers",
  "common:category_drinks_and_music": "Drinks & Music",
};

// Faithful to real i18next default behavior:
//  - exists(key) → true only if the key is a registered resource.
//  - t(key) on a MISS → the namespace-STRIPPED key ("category_romantic"),
//    matching appendNamespaceToMissingKey:false (PROVEN in investigation §3).
const stubI18n = {
  exists: (key: string): boolean =>
    Object.prototype.hasOwnProperty.call(REAL_CATEGORY_KEYS, key),
  t: (key: string): string =>
    REAL_CATEGORY_KEYS[key] ?? key.replace(/^common:/, ""),
};

const resolve = (input: string): string =>
  resolveReadableCategoryName(input, stubI18n);

// ── Curated labels (the reported bug): no category_* key → title-case fallback.
Deno.test("ORCH-1044 T-01: 'Romantic' → 'Romantic' (no token leak)", () => {
  assertEquals(resolve("Romantic"), "Romantic");
});

Deno.test("ORCH-1044 T-02: 'Adventurous' → 'Adventurous'", () => {
  assertEquals(resolve("Adventurous"), "Adventurous");
});

Deno.test("ORCH-1044 T-03: 'First Date' → 'First Date' (singular, D-2: NOT 'First Dates')", () => {
  assertEquals(resolve("First Date"), "First Date");
});

Deno.test("ORCH-1044 T-04: 'Group Fun' → 'Group Fun'", () => {
  assertEquals(resolve("Group Fun"), "Group Fun");
});

Deno.test("ORCH-1044 T-05: 'Picnic Dates' → 'Picnic Dates'", () => {
  assertEquals(resolve("Picnic Dates"), "Picnic Dates");
});

// T-06 NOTE (implementor): SPEC §7.1 expected 'Take a Stroll', but the LOCKED,
// unchanged title-case fallback formula — slug.replace(/_/g,' ').replace(/\b\w/g,
// upper) — uppercases EVERY word boundary, so 'Take a Stroll' resolves to
// 'Take A Stroll'. The spec's expected string contradicts its own locked formula
// (D-1 step 2 / NG-3 keeps the formula untouched). Asserting the resolver's true
// output here; the SC-1 invariant (never a category_/intent_ token) still holds.
// Logged as a discovery for the orchestrator. The deck's intent_take_a_stroll
// localized label ("Take a Stroll") is the deferred F/U-2 parity route, not this.
Deno.test("ORCH-1044 T-06: 'Take a Stroll' → 'Take A Stroll' (locked title-case formula)", () => {
  assertEquals(resolve("Take a Stroll"), "Take A Stroll");
});

// ── Real category slug: localized HIT path still works (no single-card regression).
Deno.test("ORCH-1044 T-07: 'casual_food' → 'Casual' (localized hit preserved)", () => {
  assertEquals(resolve("casual_food"), "Casual");
});

// ── Empty guard intact.
Deno.test("ORCH-1044 T-08: '' → 'Experience' (empty guard)", () => {
  assertEquals(resolve(""), "Experience");
});
