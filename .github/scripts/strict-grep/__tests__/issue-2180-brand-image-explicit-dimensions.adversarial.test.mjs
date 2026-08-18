/**
 * #2180 [get-app link opens the installed app and strands the user]
 * Adversarial suite for the T-8 gate itself.
 *
 * A gate is only worth its green if it can be shown to go RED. These tests attack
 * `issue-2180-brand-image-explicit-dimensions.mjs` from angles its own built-in
 * self-check does not cover: that it actually reaches the two real `+not-found`
 * screens, that the frozen exemption list cannot quietly grow, and that the
 * specific shipped defect (width + aspectRatio, no height) is caught in every
 * syntactic dress it can wear.
 *
 * This file has no self-check mode of its own; it is a plain `node --test` suite.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  analyze,
  loadRepoFiles,
  EXEMPT,
  EXPECTED_VIOLATION_COUNT,
} from "../issue-2180-brand-image-explicit-dimensions.mjs";

const HEADER = 'import { MINGLA_BUSINESS_LOGO } from "@mingla/brand-assets";\n';

const fixture = (body) => [{ rel: "fixture/X.tsx", source: HEADER + body }];

test("A-1 the real repo is clean apart from the frozen exemptions", () => {
  const { violations, inspected } = analyze(loadRepoFiles());
  assert.ok(inspected > 10, `expected a real corpus, inspected ${inspected}`);
  const unexpected = violations.filter((v) => !EXEMPT.has(v.rel));
  assert.deepEqual(
    unexpected,
    [],
    "a brand-asset <Image> outside the frozen exemption list is under-constrained",
  );
});

test("A-2 the exemption list may only shrink, never grow", () => {
  // Frozen at #2180 CLOSE. Lowering this number is the only legal edit.
  const FRONTIER = 2;
  assert.ok(
    EXEMPT.size <= FRONTIER,
    `EXEMPT grew to ${EXEMPT.size}; a new violation must be FIXED, not exempted`,
  );
  assert.equal(EXPECTED_VIOLATION_COUNT, EXEMPT.size);
});

test("A-3 both shipped +not-found screens are actually reached and pass", () => {
  const files = loadRepoFiles();
  for (const rel of [
    "mingla-business/app/+not-found.tsx",
    "app-mobile/app/+not-found.tsx",
  ]) {
    const file = files.find((f) => f.rel === rel);
    assert.ok(file, `${rel} was not swept by the gate at all`);
    const { violations, inspected } = analyze([file]);
    assert.equal(inspected, 1, `${rel}: brand <Image> not detected`);
    assert.deepEqual(violations, [], `${rel}: still under-constrained`);
  }
});

test("A-4 the exact shipped defect is caught in every dress", () => {
  const BAD = [
    // the literal reverted style
    "const logo = MINGLA_BUSINESS_LOGO;\n<Image source={logo} style={styles.logo} />\n" +
      "const styles = StyleSheet.create({ logo: { width: 140, aspectRatio: 1356 / 480 } })",
    // inline, no styles.* indirection
    "<Image source={MINGLA_BUSINESS_LOGO} style={{ width: 140, aspectRatio: 2 }} />",
    // array form where NO member supplies a height
    "<Image source={MINGLA_BUSINESS_LOGO} style={[styles.a, { aspectRatio: 2 }]} />\n" +
      "const styles = StyleSheet.create({ a: { width: 140 } })",
    // percentage width, no height
    "<Image source={MINGLA_BUSINESS_LOGO} style={{ width: '100%', aspectRatio: 2 }} />",
    // height only
    "<Image source={MINGLA_BUSINESS_LOGO} style={{ height: 140 }} />",
    // namespaced element
    "<Animated.Image source={MINGLA_BUSINESS_LOGO} style={{ width: 140 }} />",
  ];
  for (const body of BAD) {
    const { violations } = analyze(fixture(body));
    assert.equal(violations.length, 1, `NOT caught:\n${body}`);
  }
});

test("A-5 legitimate sizings are not flagged (the gate is not just always-red)", () => {
  const GOOD = [
    "<Image source={MINGLA_BUSINESS_LOGO} style={{ width: 200, height: 200 }} />",
    "<Image source={MINGLA_BUSINESS_LOGO} style={[styles.a, { width: w, height: h }]} />\n" +
      "const styles = StyleSheet.create({ a: { aspectRatio: 2 } })",
    "const logo = MINGLA_BUSINESS_LOGO\n<Image source={logo} style={styles.a} />\n" +
      "const styles = StyleSheet.create({ a: { width: s(88), height: s(31) } })",
  ];
  for (const body of GOOD) {
    const { violations, inspected } = analyze(fixture(body));
    assert.equal(inspected, 1, `not inspected:\n${body}`);
    assert.deepEqual(violations, [], `wrongly flagged:\n${body}`);
  }
});

test("A-6 the gate cannot pass vacuously", () => {
  // No brand import at all -> nothing inspected. The runner treats inspected === 0
  // as a hard failure, which is what stops a renamed package reading as green.
  const { inspected } = analyze([
    { rel: "fixture/Y.tsx", source: "<Image source={{ uri }} style={{}} />" },
  ]);
  assert.equal(inspected, 0);
});

test("A-7 a violation in a NEW file is not covered by someone else's exemption", () => {
  const { violations } = analyze([
    {
      rel: "mingla-business/src/components/brand/NewScreen.tsx",
      source: HEADER + "<Image source={MINGLA_BUSINESS_LOGO} style={{ width: 140 }} />",
    },
  ]);
  assert.equal(violations.length, 1);
  assert.ok(!EXEMPT.has(violations[0].rel), "a new file must not inherit an exemption");
});
