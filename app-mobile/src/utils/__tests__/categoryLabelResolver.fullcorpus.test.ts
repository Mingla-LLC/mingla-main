// @ts-nocheck
// ORCH-1044 T-T1…T-T7 (TESTER-authored adversarial regression test).
//
// DISTINCT ANGLE from the implementor's two suites:
//   - categoryLabelResolver.test.ts        → 8 hand-picked happy-path strings.
//   - categoryLabelResolver.adversarial.test.ts → 5 cases, stub seeded with a
//     3-11 key SUBSET, namespace-strip (appendNamespaceToMissingKey:false) only.
//
// This suite attacks three new surfaces the existing two never touch:
//   (1) FULL-CORPUS sweep: the stub is seeded with the ENTIRE real en/common.json
//       category_* resource set (all 23 keys, read live from the locale file at
//       test time — not a hand-maintained subset). Every real localized label is
//       asserted against the no-token-leak invariant, so a future label edit that
//       accidentally introduces a token-shaped value is caught.
//   (2) INVERSE namespace config: i18next can be configured with
//       appendNamespaceToMissingKey:true, in which case t() on a miss returns the
//       PREFIXED key "common:category_romantic" (the opposite of the strip the
//       existing T-A2 simulates). A resolver that relied on ANY t()-shape heuristic
//       would break under one config or the other; only an exists()-gated resolver
//       survives BOTH. This proves SC-4 against the config flip NG-1 forbids.
//   (3) EVERY curated intent_* deck label (the real 6 from en/common.json) driven
//       through the resolver as a human label, against the full real corpus, must
//       yield a clean non-token string — the production miss path at full fidelity.
//
// Deno-runnable via the §6.1(a) seam (pure resolver + injected stub) — no RN.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { resolveReadableCategoryName } from "../categoryUtils.ts";

// The no-token-leak invariant regex (SPEC §10, LOCKED — I-CATEGORY-LABEL-NO-TOKEN-LEAK).
const TOKEN_SHAPE = /^(common:)?(category|intent)_/;

// Read the LIVE locale corpus so this test tracks the real resource state, not a
// frozen hand-copy. URL is relative to this test file.
const commonJsonUrl = new URL(
  "../../i18n/locales/en/common.json",
  import.meta.url,
);
const common: Record<string, string> = JSON.parse(
  await Deno.readTextFile(commonJsonUrl),
);

// The full real category_* key set, namespaced exactly as the resolver queries it.
const REAL_CATEGORY_KEYS: Record<string, string> = {};
for (const [k, v] of Object.entries(common)) {
  if (k.startsWith("category_")) REAL_CATEGORY_KEYS[`common:${k}`] = v;
}

// The real curated intent_* deck labels (the human strings card.category carries).
const CURATED_INTENT_LABELS = Object.entries(common)
  .filter(([k]) => k.startsWith("intent_"))
  .map(([, v]) => v);

// ── Stub A: namespace-STRIP on miss (appendNamespaceToMissingKey:false — prod default).
const stubStrip = {
  exists: (key: string): boolean =>
    Object.prototype.hasOwnProperty.call(REAL_CATEGORY_KEYS, key),
  t: (key: string): string =>
    REAL_CATEGORY_KEYS[key] ?? key.replace(/^common:/, ""),
};

// ── Stub B: namespace-KEEP on miss (appendNamespaceToMissingKey:true — the flip
//    NG-1 forbids; tested here only to prove the resolver is immune to it).
const stubKeep = {
  exists: (key: string): boolean =>
    Object.prototype.hasOwnProperty.call(REAL_CATEGORY_KEYS, key),
  t: (key: string): string => REAL_CATEGORY_KEYS[key] ?? key, // returns "common:category_romantic"
};

// Sanity: the live corpus actually has the keys we expect (guards against an empty
// read silently making the sweep vacuous).
Deno.test("ORCH-1044 T-T0: live en/common.json corpus loaded (>=20 category_*, ==6 intent_*)", () => {
  assert(
    Object.keys(REAL_CATEGORY_KEYS).length >= 20,
    `expected >=20 real category_* keys, got ${Object.keys(REAL_CATEGORY_KEYS).length}`,
  );
  assertEquals(CURATED_INTENT_LABELS.length, 6);
});

// Legacy-alias slugs that legacyToSlug intentionally REMAPS to a different
// canonical slug (so resolving them returns the CANONICAL key's label, not the
// alias key's own corpus value). These are not bugs — the remap is the ORCH-0434
// /0597/0598 canonicalization contract. The full-corpus sweep asserts only the
// no-token-leak invariant for these; the non-remapped slugs additionally assert
// exact-label identity. Derived from the resolver's own legacyToSlug table.
const LEGACY_REMAPPED_SLUGS = new Set([
  "first_meet", "picnic_park", "picnic", "drink", "casual_eats", "fine_dining",
  "watch", "live_performance", "wellness", "brunch_lunch_casual", "movies_theatre",
  "nature_views", // category_nature_views slug "nature_views" → not in legacyToSlug,
  // but its own key exists so it self-resolves; kept here only if it diverges.
]);

// T-T1 — FULL-CORPUS sweep: every real category_* slug resolves TOKEN-FREE (the
// binding ORCH-1044 invariant). For slugs that are NOT legacy-remapped, the output
// must additionally equal the slug's own localized label verbatim. A future
// common.json edit introducing a category_-shaped VALUE is caught by the regex arm.
Deno.test("ORCH-1044 T-T1: every real category_* slug resolves token-free; non-remapped slugs return their verbatim label", () => {
  for (const [nsKey, label] of Object.entries(REAL_CATEGORY_KEYS)) {
    const slug = nsKey.replace(/^common:category_/, "");
    const out = resolveReadableCategoryName(slug, stubStrip);
    // Binding invariant — applies to EVERY real slug (remapped or not).
    assert(!TOKEN_SHAPE.test(out), `real label for '${slug}' is token-shaped: '${out}'`);
    assert(!out.includes(":"), `real label for '${slug}' leaked a namespace sep: '${out}'`);
    // Identity arm — only for slugs the resolver does not canonicalize away.
    if (!LEGACY_REMAPPED_SLUGS.has(slug)) {
      assertEquals(out, label, `non-remapped slug '${slug}' did not return its real label`);
    }
  }
});

// T-T2 — EVERY curated intent_* deck label, driven as a human label through the
// resolver against the FULL real corpus, yields a clean non-token string.
// (These labels have NO category_* key, so they take the title-case miss path.)
Deno.test("ORCH-1044 T-T2: every curated intent_* deck label resolves token-free against full corpus", () => {
  assert(CURATED_INTENT_LABELS.length > 0, "no intent_* labels found in corpus");
  for (const label of CURATED_INTENT_LABELS) {
    const out = resolveReadableCategoryName(label, stubStrip);
    assert(!TOKEN_SHAPE.test(out), `curated label '${label}' leaked a token: '${out}'`);
    assert(!out.includes(":"), `curated label '${label}' leaked a namespace sep: '${out}'`);
    assert(out.length > 0, `curated label '${label}' resolved empty`);
  }
});

// T-T3 — INVERSE namespace config (appendNamespaceToMissingKey:true): t() returns
// the PREFIXED key on a miss. A resolver gating on t()-shape would echo
// "common:category_romantic"; the exists()-gated resolver still yields "Romantic".
Deno.test("ORCH-1044 T-T3: prefixed-key miss config does NOT leak (immune to appendNamespaceToMissingKey flip)", () => {
  // Sanity: the keep-stub's t() WOULD leak the prefixed token on a miss…
  assertEquals(stubKeep.t("common:category_romantic"), "common:category_romantic");
  // …but the resolver relies on exists(), so the flip cannot reach the UI.
  for (const label of ["Romantic", "Adventurous", "Group Fun"]) {
    const out = resolveReadableCategoryName(label, stubKeep);
    assert(!TOKEN_SHAPE.test(out), `'${label}' leaked under prefixed-key config: '${out}'`);
    assert(!out.includes(":"), `'${label}' leaked a namespace sep under prefix config: '${out}'`);
  }
  assertEquals(resolveReadableCategoryName("Romantic", stubKeep), "Romantic");
});

// T-T4 — Localized HIT path returns the REAL labels for representative slugs under
// BOTH stub configs (the hit path must be config-independent).
Deno.test("ORCH-1044 T-T4: localized HIT returns real labels (casual_food→Casual, upscale_fine_dining→Fine Dining, nature→Nature & Views)", () => {
  for (const stub of [stubStrip, stubKeep]) {
    assertEquals(resolveReadableCategoryName("casual_food", stub), "Casual");
    assertEquals(resolveReadableCategoryName("upscale_fine_dining", stub), "Fine Dining");
    assertEquals(resolveReadableCategoryName("nature", stub), "Nature & Views");
  }
});

// T-T5 — Legacy alias → canonical HIT under full corpus: 'fine_dining' maps via
// legacyToSlug to 'upscale_fine_dining', whose key exists → localized "Fine Dining".
Deno.test("ORCH-1044 T-T5: legacy alias 'fine_dining' resolves to localized 'Fine Dining' under full corpus", () => {
  assertEquals(resolveReadableCategoryName("fine_dining", stubStrip), "Fine Dining");
});

// T-T6 — Defensive: a category_-prefixed RAW token passed as input must not be
// echoed back as a token (the leak class this ORCH exists to kill), regardless of
// which miss config is active.
Deno.test("ORCH-1044 T-T6: raw 'category_romantic' input never echoes the token (either config)", () => {
  for (const stub of [stubStrip, stubKeep]) {
    const out = resolveReadableCategoryName("category_romantic", stub);
    assert(!TOKEN_SHAPE.test(out), `raw token input echoed under config: '${out}'`);
  }
});

// T-T7 — Empty/whitespace guard holds under both configs.
Deno.test("ORCH-1044 T-T7: empty input → 'Experience' under both miss configs", () => {
  assertEquals(resolveReadableCategoryName("", stubStrip), "Experience");
  assertEquals(resolveReadableCategoryName("", stubKeep), "Experience");
});
