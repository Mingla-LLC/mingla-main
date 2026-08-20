/**
 * #2211 — TESTER adversarial coverage for the
 * I-PROPOSED-2211-FULLSCREEN-ROUTE-MUST-SCROLL gate.
 *
 * The gate's own built-in self check proves it flags the reference defect shape and
 * passes each satisfier. That is the IMPLEMENTOR's axis. This file attacks a
 * different one: **can a real route walk past the detector by accident?**
 *
 * Every case below is a spelling a developer would plausibly write without any
 * intent to evade — reordered style properties, single quotes, extra
 * whitespace, a different control type. A detector that only recognises the
 * house style silently exempts exactly the files most likely to be added next,
 * which is how the `readonly` regex hole recorded in COMMS-0141 happened.
 *
 * Run: `node --test` (registered in MANIFEST.json alongside the gate).
 */

import test from "node:test";
import assert from "node:assert/strict";

import { isScrollViolation, hasCentredFullScreenRoot, isScannableRouteFile } from "../issue-2211-fullscreen-route-must-scroll.mjs";

const DEFECT =
  'import { StyleSheet, View, Text } from "react-native";\n' +
  'import { Button } from "../src/components/ui/Button";\n' +
  'export default function S(){return(<View style={styles.host}><Text>x</Text>' +
  '<Button label="Sign in" onPress={()=>{}} /></View>);}\n' +
  'const styles = StyleSheet.create({ host: { flex: 1, justifyContent: "center" } });\n';

test("D-1 the reference defect is flagged — the gate is not inert", () => {
  assert.equal(isScrollViolation(DEFECT), true);
});

test("D-2 property ORDER inside the style object does not exempt it", () => {
  const reordered = DEFECT.replace(
    'host: { flex: 1, justifyContent: "center" }',
    'host: { justifyContent: "center", backgroundColor: "#000", flex: 1 }',
  );
  assert.equal(isScrollViolation(reordered), true);
});

test("D-3 single quotes around center do not exempt it", () => {
  assert.equal(isScrollViolation(DEFECT.replace('"center"', "'center'")), true);
});

test("D-4 extra whitespace in `flex:  1` does not exempt it", () => {
  assert.equal(isScrollViolation(DEFECT.replace("flex: 1", "flex:  1")), true);
});

test("D-5 a TextInput counts as a control the user must reach", () => {
  const withInput = DEFECT
    .replace('<Button label="Sign in" onPress={()=>{}} />', "<TextInput value={''} />")
    .replace('import { Button } from "../src/components/ui/Button";\n', "");
  assert.equal(isScrollViolation(withInput), true);
});

test("D-6 a multi-line style block is recognised as well as a single-line one", () => {
  const multiline = DEFECT.replace(
    'const styles = StyleSheet.create({ host: { flex: 1, justifyContent: "center" } });\n',
    "const styles = StyleSheet.create({\n  host: {\n    flex: 1,\n    alignItems: \"center\",\n    justifyContent: \"center\",\n  },\n});\n",
  );
  assert.equal(isScrollViolation(multiline), true);
});

test("D-7 the allowlist tag must be spelled exactly; a near-miss does not exempt", () => {
  const nearMiss = "// orch-strict-grep-allow fullscreen-route-scroll — typo\n" + DEFECT;
  assert.equal(isScrollViolation(nearMiss), true);
});

test("D-8 `flex: 1` and `justifyContent` in DIFFERENT style objects is not the defect shape", () => {
  // The two must co-exist in ONE object. Matching them file-wide would flag
  // almost every screen in the app and the gate would be switched off.
  const separate =
    'const styles = StyleSheet.create({ host: { flex: 1 }, row: { justifyContent: "center" } });\n';
  assert.equal(hasCentredFullScreenRoot(separate), false);
});

test("D-9 documented limitation: a NESTED scroll view exempts the whole file", () => {
  // The gate is file-scoped, so a `maxHeight: 220` inner list exempts a route
  // whose OUTER region still cannot scroll — the exact shape #2211 found on the
  // refund attention form. Asserted so the limitation is a known fact with a
  // failing marker for any future tightening, not a surprise.
  const nestedOnly = DEFECT.replace(
    "<Text>x</Text>",
    '<ScrollView style={{ maxHeight: 220 }}><Text>x</Text></ScrollView>',
  );
  assert.equal(isScrollViolation(nestedOnly), false);
});

test("D-10 the scan set excludes web variants and helpers, includes real routes", () => {
  for (const e of ["index.tsx", "accept-brand-invitation.tsx", "[id].tsx"]) {
    assert.equal(isScannableRouteFile(e), true, e);
  }
  for (const e of ["helper.ts", "connect.web.tsx", "+html.tsx", "S.test.tsx"]) {
    assert.equal(isScannableRouteFile(e), false, e);
  }
});
