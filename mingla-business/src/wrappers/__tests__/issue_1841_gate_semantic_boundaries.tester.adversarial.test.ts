/**
 * #1841 [keyboard-guard-blind-spots] — TESTER adversarial regression suite.
 *
 * DIFFERENT ANGLE, deliberately. The implementor's two suites attack the gate's
 * PATTERNS: `KeyboardRoot.sweep.v2.adversarial.test.tsx` plants one synthetic
 * file per closed hole and proves the gate goes red; the happy-path suite
 * mutates the real shipped screens back to their pre-#1841 shapes and proves
 * the same. Both ask "does the gate still catch the five things it learned to
 * catch?"
 *
 * This suite asks the question neither of them asks: **are the gate's SEMANTIC
 * BOUNDARIES still where the SPEC put them?** Every assertion here targets a
 * boundary whose failure mode is UNDER-reporting — a gate that silently sees
 * less while every pattern test stays green.
 *
 * Measured gap that motivated this file (TEST phase, #1841): deleting branch (a)
 * of pattern 4 outright — the SPEC's central safety claim in B1-3, that the
 * corrected rule is a strict SUPERSET of the pre-#1841 rule and therefore "can
 * never be a silent weakening" — passes ALL 32 of the implementor's assertions.
 * TB-4 below closes that.
 *
 * ANTI-CLONE (I-PROPOSED-1841-A-GUARD-MUST-BE-EXECUTED-NOT-RE-DECLARED):
 *   - Zero gate regexes are re-declared here. The gate's own exported core is
 *     imported and EXECUTED.
 *   - No branch reads a gitignored build artifact, so nothing here can skip.
 *   - An empty scan must FAIL, and TB-0 asserts the domain is real and non-empty
 *     before any other assertion is allowed to mean anything.
 */

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// The gate is an ESM .mjs and this suite runs under jest's CJS transform, so it
// is executed in a child node process rather than required. That is not a
// workaround for the anti-clone rule — it IS the anti-clone rule: every fact
// about the gate below comes back from running the real module, and this file
// contains zero copies of its regexes, its walk, its safelist or its comment
// classifier.
const GATE_PATH = resolve(
  __dirname,
  "../../../../.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs",
);
const REPO_ROOT = resolve(__dirname, "../../../..");
const TIMEOUT_MS = 120_000;

type Warning = { path: string; line: number; pattern: string; fix: string };
type ScanResult = { scanned: number; safelisted: number; warnings: Warning[] };

/** Run `body` INSIDE the gate module and bring the result back as JSON. */
function inGate<T>(body: string): T {
  const script =
    `import * as gate from ${JSON.stringify(pathToFileURL(GATE_PATH).href)};\n` +
    `const out = await (async () => {\n${body}\n})();\n` +
    `process.stdout.write(JSON.stringify(out));\n`;
  const raw = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    timeout: TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(raw) as T;
}

const ROOT = "/tester-boundaries";
const BIZ = `${ROOT}/mingla-business`;

function scan(files: Record<string, string>): ScanResult {
  return inGate<ScanResult>(
    `const files = ${JSON.stringify(files)};\n` +
      `const repoRoot = ${JSON.stringify(ROOT)};\n` +
      `return gate.scanKeyboardPlumbing({ files: Object.keys(files), readFile: (p) => files[p], repoRoot });`,
  );
}

function patterns(r: ScanResult): string {
  return r.warnings.map((w) => w.pattern).join(" | ");
}

/** A leaf that renders a real field, reached only through the house primitive. */
const FIELD_MODULE = {
  [`${BIZ}/src/ui/Field.tsx`]: `
import React from "react";
import { TextInput } from "react-native";
export const Field = (p) => <TextInput {...p} />;
`,
};

describe("#1841 tester — the gate's semantic boundaries", () => {
  // -------------------------------------------------------------------------
  it("TB-0 vacuity guard: the real scan domain is non-empty, and an EMPTY file set THROWS", () => {
    const probe = inGate<{ count: number; hasSentinel: boolean; emptyThrew: boolean }>(
      `const files = gate.collectSourceFiles(gate.SCAN_ROOTS);\n` +
        `let emptyThrew = false;\n` +
        `try { gate.scanKeyboardPlumbing({ files: [], readFile: () => "" }); } catch { emptyThrew = true; }\n` +
        `return { count: files.length, hasSentinel: files.some((f) => f.endsWith("mingla-business/src/wrappers/SmartScrollView.native.tsx")), emptyThrew };`,
    );
    // If this suite ever runs against an emptied walk, every assertion below
    // would be trivially satisfiable. Refuse to be that suite.
    expect(probe.count).toBeGreaterThan(1000);
    expect(probe.hasSentinel).toBe(true);
    expect(probe.emptyThrew).toBe(true);
  }, TIMEOUT_MS);

  // -------------------------------------------------------------------------
  it("TB-1 boundary is BOUNDED: a closed <Modal> blanks only its own span, not the rest of the file", () => {
    // The Modal/Sheet blanking is the single largest source of under-reporting
    // in this gate (43 candidate files -> 5). If the blank ever runs past the
    // closing tag, every violation after the first Modal in a file disappears
    // and every pattern test stays green.
    const r = scan({
      ...FIELD_MODULE,
      [`${BIZ}/src/bad/AfterModal.tsx`]: `
import React from "react";
import { Modal, ScrollView, Text, View } from "react-native";
import { Field } from "../ui/Field";

export const AfterModal = () => (
  <View>
    <Modal visible>
      <Field value="" onChangeText={() => undefined} />
    </Modal>
    <ScrollView>
      <Text>this container is AFTER the modal and DOES host a field</Text>
      <Field value="" onChangeText={() => undefined} />
    </ScrollView>
  </View>
);
`,
    });
    expect(patterns(r)).toMatch(/bare react-native container/);
  }, TIMEOUT_MS);

  // -------------------------------------------------------------------------
  it("TB-2 boundary is REAL: a field inside a closed <Modal> is still NOT the outer container's problem", () => {
    // The other direction of TB-1. Written with no literal TextInput token so
    // branch (a) cannot fire and this isolates the boundary itself.
    const r = scan({
      ...FIELD_MODULE,
      [`${BIZ}/src/good/OnlyInModal.tsx`]: `
import React from "react";
import { Modal, ScrollView, Text, View } from "react-native";
import { Field } from "../ui/Field";

export const OnlyInModal = () => (
  <View>
    <ScrollView>
      <Text>nothing focusable in this flow</Text>
    </ScrollView>
    <Modal visible>
      <Field value="" onChangeText={() => undefined} />
    </Modal>
  </View>
);
`,
    });
    expect(r.warnings).toHaveLength(0);
  }, TIMEOUT_MS);

  // -------------------------------------------------------------------------
  it("TB-3 allowlist window is BOUNDED at 3 lines — it must not creep back toward whole-file immunity", () => {
    // Hole 4's fix replaced whole-file immunity with a +/-3 line window. The
    // regression risk is not that the window disappears, it is that it QUIETLY
    // WIDENS until it is a whole file again. Pin both sides of the boundary.
    const build = (gapLines: number): string =>
      [
        `import { Keyboard } from "react-native";`,
        ``,
        `export function f() {`,
        `  // orch-strict-grep-allow orch-0892 — approved: the anchored one only`,
        ...Array.from({ length: gapLines }, () => ``),
        `  return Keyboard.addListener("keyboardDidShow", () => undefined);`,
        `}`,
      ].join("\n");

    // Marker at index 3; listener 3 lines below it (index 6) -> inside the window.
    const covered = scan({ [`${BIZ}/src/w/Covered.ts`]: build(2) });
    expect(covered.warnings).toHaveLength(0);

    // One line further out (index 7) -> outside the window, MUST be flagged.
    const uncovered = scan({ [`${BIZ}/src/w/Uncovered.ts`]: build(3) });
    expect(patterns(uncovered)).toMatch(/Keyboard\.addListener/);
  }, TIMEOUT_MS);

  // -------------------------------------------------------------------------
  it("TB-4 SUPERSET guarantee: the pre-#1841 rule still fires on its own, with the new closure OFF the table", () => {
    // SPEC B1-3: pattern 4 is a UNION and branch (a) is "retained VERBATIM", so
    // the corrected gate is a strict superset of what shipped before and the
    // change "can never be a silent weakening". Nothing in the implementor's 32
    // assertions exercises branch (a) in isolation — deleting it outright leaves
    // all 32 green (measured at TEST). This is that assertion.
    //
    // The shape below is deliberately one the CLOSURE cannot see: the TextInput
    // identifier is present in the file (a type position + a bare reference),
    // but no input-bearing element sits inside the ScrollView's span, so only
    // branch (a) can possibly fire.
    const r = scan({
      [`${BIZ}/src/bad/LegacyTokenOnly.tsx`]: `
import React, { useRef } from "react";
import { ScrollView, TextInput, View, Text } from "react-native";

export const LegacyTokenOnly = () => {
  const ref = useRef<TextInput | null>(null);
  return (
    <View>
      <ScrollView>
        <Text>no field element inside this span at all</Text>
      </ScrollView>
    </View>
  );
};
`,
    });
    expect(patterns(r)).toMatch(/ScrollView imported from 'react-native'/);
  }, TIMEOUT_MS);

  // -------------------------------------------------------------------------
  it("TB-5 pattern 1 went argument-agnostic WITHOUT going identifier-agnostic — no collateral on non-listeners", () => {
    // Making pattern 1 argument-agnostic is a widening, and widenings acquire
    // false positives. Keyboard.dismiss() is explicitly out of scope per the
    // gate's own header; a screen that only dismisses must stay green, or the
    // next engineer allowlists a legal call and the allowlist set rots.
    const r = scan({
      [`${BIZ}/src/good/DismissOnly.ts`]: `
import { Keyboard } from "react-native";

export const bye = () => {
  Keyboard.dismiss();
  Keyboard.removeAllListeners("keyboardDidShow");
};
`,
    });
    expect(r.warnings).toHaveLength(0);
  }, TIMEOUT_MS);

  // -------------------------------------------------------------------------
  it("TB-6 type-only imports stay invisible in BOTH spellings — the correct migration must not trip the gate", () => {
    // A1's migration keeps a type-only RN ScrollView for its imperative scroll
    // handle. If B1-6 ever regresses, the CORRECT fix becomes a violation and
    // the next engineer reverts the migration to get green.
    const r = scan({
      ...FIELD_MODULE,
      [`${BIZ}/src/good/TypeOnlyA.tsx`]: `
import React, { useRef } from "react";
import { View } from "react-native";
import type { ScrollView as RNScrollView } from "react-native";
import { ScrollView } from "../wrappers/SmartScrollView";
import { Field } from "../ui/Field";

export const A = () => {
  const r = useRef<RNScrollView | null>(null);
  return <ScrollView ref={r}><View><Field value="" onChangeText={() => undefined} /></View></ScrollView>;
};
`,
      [`${BIZ}/src/good/TypeOnlyB.tsx`]: `
import React, { useRef } from "react";
import { View, type ScrollView as RNScrollView2 } from "react-native";
import { ScrollView } from "../wrappers/SmartScrollView";
import { Field } from "../ui/Field";

export const B = () => {
  const r = useRef<RNScrollView2 | null>(null);
  return <ScrollView ref={r}><View><Field value="" onChangeText={() => undefined} /></View></ScrollView>;
};
`,
    });
    expect(r.warnings).toHaveLength(0);
  }, TIMEOUT_MS);

  // -------------------------------------------------------------------------
  it("TB-7 the SAFELIST is a carve-out, not a prefix — a safelisted path must not shelter its neighbours", () => {
    // SAFELIST membership is an exact relative-path match. If it ever became a
    // prefix/startsWith test, every file beside a safelisted wrapper would go
    // dark, and no pattern test would notice.
    const r = scan({
      ...FIELD_MODULE,
      [`${BIZ}/src/wrappers/SmartScrollView.native.tsx`]: `
export { KeyboardAwareScrollView as ScrollView } from "react-native-keyboard-controller";
`,
      [`${BIZ}/src/wrappers/NotSafelisted.tsx`]: `
import React from "react";
import { ScrollView, View } from "react-native";
import { Field } from "../ui/Field";

export const NotSafelisted = () => (
  <ScrollView><View><Field value="" onChangeText={() => undefined} /></View></ScrollView>
);
`,
    });
    expect(r.safelisted).toBe(1);
    expect(patterns(r)).toMatch(/bare react-native container/);
    expect(r.warnings.every((w) => !w.path.endsWith("SmartScrollView.native.tsx"))).toBe(true);
  }, TIMEOUT_MS);
});
