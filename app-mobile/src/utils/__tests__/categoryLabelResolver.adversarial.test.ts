// @ts-nocheck
// ORCH-1044 T-A1…T-A5 (adversarial) regression test.
//
// Hardens the I-CATEGORY-LABEL-NO-TOKEN-LEAK invariant: the resolver MUST NEVER
// return a value matching /^(common:)?(category|intent)_/ and must survive the
// exact namespace-strip behavior that defeated the old equality guard.
//
// Deno-runnable via the §6.1(a) seam (pure resolver + injected stub) — no RN.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { resolveReadableCategoryName } from "../categoryUtils.ts";

// The no-token-leak invariant regex (SPEC §10, LOCKED).
const TOKEN_SHAPE = /^(common:)?(category|intent)_/;

// Real category_* keys (same production subset as the happy-path stub).
const REAL_CATEGORY_KEYS: Record<string, string> = {
  "common:category_nature": "Nature & Views",
  "common:category_casual_food": "Casual",
  "common:category_upscale_fine_dining": "Fine Dining",
};

// PRODUCTION-FAITHFUL stub: on a miss, t() returns the namespace-STRIPPED key
// ("category_romantic"), exactly as real i18next does with
// appendNamespaceToMissingKey:false. This is the behavior that defeated the old
// `translated === key` guard. The fix must rely on exists(), not on t()'s shape.
const stubI18n = {
  exists: (key: string): boolean =>
    Object.prototype.hasOwnProperty.call(REAL_CATEGORY_KEYS, key),
  t: (key: string): string =>
    REAL_CATEGORY_KEYS[key] ?? key.replace(/^common:/, ""), // strips namespace on miss
};

const resolve = (input: string): string =>
  resolveReadableCategoryName(input, stubI18n);

const CURATED_LABELS = [
  "Romantic",
  "Adventurous",
  "First Date",
  "Group Fun",
  "Picnic Dates",
  "Take a Stroll",
];

// T-A1 — Token-shape invariant: the core regression anchor.
// Fails on revert of D-1 (the equality guard would leak "category_romantic").
Deno.test("ORCH-1044 T-A1: curated labels never return a category_/intent_ token or a namespace separator", () => {
  for (const label of CURATED_LABELS) {
    const out = resolve(label);
    assert(
      !TOKEN_SHAPE.test(out),
      `'${label}' leaked a token-shaped string: '${out}'`,
    );
    assert(
      !out.includes(":"),
      `'${label}' leaked a namespace separator: '${out}'`,
    );
  }
});

// T-A2 — Namespace-strip simulation: even though t() returns the stripped key
// on a miss, exists() reports false, so the resolver must NOT echo it.
Deno.test("ORCH-1044 T-A2: namespace-stripped miss-return does not leak ('Romantic', not 'category_romantic')", () => {
  // Sanity: the stub's t() would itself leak the token on a miss…
  assertEquals(stubI18n.t("common:category_romantic"), "category_romantic");
  // …but the resolver relies on exists(), so it returns the friendly label.
  assertEquals(resolve("Romantic"), "Romantic");
});

// T-A3 — intent_-shaped input never leaks (defensive: a caller misroutes an
// intent key into the category resolver). Guards the F-3 blast-radius class.
Deno.test("ORCH-1044 T-A3: 'intent_romantic' input never returns an intent_/category_ token", () => {
  const out = resolve("intent_romantic");
  assert(
    !TOKEN_SHAPE.test(out),
    `intent-shaped input leaked a token: '${out}'`,
  );
  // Title-cased human label of the normalized slug.
  assertEquals(out, "Intent Romantic");
});

// T-A4 — Legacy slug still normalizes AND the localized HIT path coexists with
// the new guard: 'fine_dining' → legacyToSlug → upscale_fine_dining → hit.
Deno.test("ORCH-1044 T-A4: 'fine_dining' → 'Fine Dining' (legacy normalize + hit path)", () => {
  assertEquals(resolve("fine_dining"), "Fine Dining");
});

// T-A5 — Hyphen + case normalization on a miss yields a clean human label,
// never a token.
Deno.test("ORCH-1044 T-A5: 'first-date' → clean label, not 'category_first_date'", () => {
  const out = resolve("first-date");
  assert(!TOKEN_SHAPE.test(out), `leaked a token: '${out}'`);
  assertEquals(out, "First-Date");
});
