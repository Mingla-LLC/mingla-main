// #2539 implementor happy-path suite for the rnw-image-filter-clip class gate.
//
// T-1  happy       the repo as shipped                                -> exit 0
// T-2  REVERT      shadowOpacity: 0.26 restored to styles.avatar      -> non-zero,
//                  naming the file, the style key and the prop
// T-3  REVERT-full all four shadow* props, split across the StyleSheet
//                  and the inline object, as they shipped              -> non-zero
// T-4  C-2         tintColor= as an element PROP on a rounded Image    -> flagged
// T-5  T-8 negative the real unrounded tinted kickerLogo shape         -> exit 0
// T-6  T-9 negative comment prose naming the props                     -> exit 0
// T-7  CENSUS      the gate resolves >= 1 <Image> in the real
//                  PublicBrandPage.tsx, and reports the number         -> >= 1
//
// T-7 is the non-vacuous one. "Real repo -> exit 0" passes just as happily when
// the parser is BLIND: it resolves nothing, finds nothing, exits 0. This whole
// issue exists because a measurement that could not fail was read as evidence
// (the #2539 investigation F-2: a cross-engine pixel diff computed with an
// engine-specific PNG decoder returned the same constant for every mutation,
// including one that could not possibly have left the avatar unclipped).
// Asserting the census is what makes a blind parser red rather than quietly
// green.
//
// The gate's own self-test mode is NOT driven from here — that mode belongs to
// the gate and is registered separately (modes: ["self-test","plain"]). This
// suite drives the exported `checkSource` seam and the CLI, and mutates no real
// repository file.
//
// (Do NOT write the self-test flag's literal two-dash spelling anywhere in this
// file. `meta-1383-manifest-parity.mjs` P6 decides whether a script "supports"
// it with a plain `src.includes(...)` substring test, so the token in a comment
// makes this suite look self-test-capable and fails parity against its
// registered selfTest:"none". Same bug class as the one #2539 is about: a
// matcher that cannot tell code from prose.)

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { checkSource, stripComments, parseStyleSheets } from "./issue-2539-rnw-image-filter-clip.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const GATE = path.join(HERE, "issue-2539-rnw-image-filter-clip.mjs");
const BRAND_PAGE = path.join(REPO_ROOT, "packages/brand-rendering/PublicBrandPage.tsx");

/** Run checkSource over a fixture and return { failures, resolvedImages }. */
function run(src, rel = "fixture.tsx") {
  const failures = [];
  const res = checkSource(src, rel, failures);
  return { failures, ...res };
}

const sheet = (body) => `const styles = StyleSheet.create({\n${body}\n});`;

test("T-1 the repo as shipped passes the gate", () => {
  const out = execFileSync("node", [GATE], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.match(out, /^OK: #2539 rnw-image-filter-clip/m);
  assert.match(out, /census: [1-9]\d* resolved <Image>/);
});

test("T-2 REVERT — shadowOpacity restored to styles.avatar is flagged, with file/key/prop", () => {
  const src = `
    const avatarStyle = [styles.avatar, { width: size, height: size, borderRadius: size / 2 }];
    const el = <Image source={{ uri: p }} style={avatarStyle} resizeMode="cover" />;
    ${sheet(`  avatar: { borderWidth: 3, overflow: "hidden", shadowOpacity: 0.26 },`)}
  `;
  const { failures } = run(src, "packages/brand-rendering/PublicBrandPage.tsx");
  assert.equal(failures.length, 1);
  assert.match(failures[0], /packages\/brand-rendering\/PublicBrandPage\.tsx:\d+:/);
  assert.match(failures[0], /shadowOpacity/);
  assert.match(failures[0], /styles\.avatar/);
  assert.match(failures[0], /borderRadius/);
});

test("T-3 REVERT-full — all four shadow* props, split across StyleSheet and inline object", () => {
  const src = `
    const avatarStyle = [styles.avatar, { width: size, borderRadius: size / 2, shadowColor: palette.accent }];
    const el = <Image source={s} style={avatarStyle} />;
    ${sheet(`  avatar: { overflow: "hidden", shadowOpacity: 0.26, shadowRadius: 18, shadowOffset: { width: 0, height: 10 } },`)}
  `;
  const { failures } = run(src);
  const named = failures.join("\n");
  for (const prop of ["shadowColor", "shadowOpacity", "shadowRadius", "shadowOffset"]) {
    assert.match(named, new RegExp(`\`${prop}\``), `expected the gate to name ${prop}`);
  }
  assert.equal(failures.length, 4);
});

test("T-4 C-2 — tintColor as an element prop on a rounded Image is flagged by the prop route", () => {
  const src = `
    const el = <Image source={LOGO} tintColor={accent} style={styles.badge} />;
    ${sheet(`  badge: { width: 40, height: 40, borderRadius: 20 },`)}
  `;
  const { failures } = run(src);
  assert.ok(failures.length >= 1);
  assert.ok(failures.some((f) => /as a PROP/.test(f)), "expected a C-2 prop-route failure");
});

test("T-5 (T-8) the real unrounded tinted logo shape is NOT flagged", () => {
  const src = `
    const el = <Image source={MINGLA_WORDMARK} tintColor={palette.accent} style={styles.kickerLogo} resizeMode="contain" accessibilityLabel="Mingla" />;
    ${sheet(`  kickerLogo: { width: 40, height: 14 },`)}
  `;
  assert.deepEqual(run(src).failures, []);
});

test("T-6 (T-9) comment prose naming the props does not fire, and does not rescue a real violation", () => {
  const clean = `
    // #2539 — NO shadow* here. shadowOpacity: 0.26 / shadowRadius: 18 /
    /* shadowOffset: { width: 0, height: 10 } / shadowColor live on the wrapper. */
    const el = <Image source={s} style={styles.avatar} />;
    ${sheet(`  avatar: { borderWidth: 3, overflow: "hidden", borderRadius: 30 },`)}
  `;
  assert.deepEqual(run(clean).failures, []);

  const rescued = `
    // the glow moved to a wrapper; this Image is clean
    const el = <Image source={s} style={styles.avatar} />;
    ${sheet(`  avatar: { borderRadius: 30, shadowRadius: 18 },`)}
  `;
  assert.ok(run(rescued).failures.length >= 1, "a comment must not suppress a real violation");
});

test("T-7 CENSUS — the gate resolves at least one real <Image> in PublicBrandPage.tsx", () => {
  const src = fs.readFileSync(BRAND_PAGE, "utf8");
  const { resolvedImages, failures } = run(src, "packages/brand-rendering/PublicBrandPage.tsx");
  assert.ok(
    resolvedImages >= 1,
    `parser resolved ${resolvedImages} <Image> elements in the real component — it has gone blind`,
  );
  assert.deepEqual(failures, [], "the shipped component must be clean");
  // And the parser really did read the StyleSheet, not an empty map.
  const sheets = parseStyleSheets(stripComments(src));
  assert.ok(sheets.has("avatar"), "styles.avatar not parsed out of the real StyleSheet.create");
  // `stripComments` blanks string CONTENTS as well as comments (a prop name in
  // a label is data, not a style key), so assert the KEYS, never their values.
  assert.match(sheets.get("avatar").body, /(^|[\s,{])overflow\s*:/);
  assert.match(sheets.get("avatar").body, /(^|[\s,{])borderWidth\s*:\s*3/);
  for (const prop of ["shadowColor", "shadowOpacity", "shadowOffset", "shadowRadius"]) {
    assert.doesNotMatch(
      sheets.get("avatar").body,
      new RegExp(`(^|[\\s,{])${prop}\\s*:`),
      `styles.avatar still carries ${prop} — the #2539 fix has been reverted`,
    );
  }
});

test("the census cannot be satisfied by an <Image> with no resolvable style", () => {
  assert.equal(run(`const el = <Image source={s} />;`).resolvedImages, 0);
});
