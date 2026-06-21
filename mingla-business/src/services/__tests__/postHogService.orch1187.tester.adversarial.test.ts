/**
 * META-ORCH-1187 [Growth Analytics Hub] Phase 1 — LEG 3 — TESTER ADVERSARIAL.
 *
 * Different angle than the implementor's happy-path tests (which assert the
 * config object passed to a MOCKED PostHog constructor). The tester discovered
 * that the strict-grep `native-mounts-analytics` gate matches `maskAllTextInputs:
 * true` against the WHOLE file — including the doc-comment — so masking could be
 * deleted from the ACTIVE client constructor while the comment alone keeps the
 * gate green (proven by the tester via stash-revert).
 *
 * This test closes that hole at the SOURCE level for BOTH native apps: it strips
 * comments, then asserts the NON-COMMENT code of each postHogService.ts still
 * (a) enables session replay and (b) keeps BOTH mask flags true. A replay that
 * captures a card field / email / PII is an AUTOMATIC FAIL (§4.H / §SC-Security).
 *
 * FAILS-ON-REVERT: deleting `maskAllTextInputs: true` (or `maskAllImages: true`,
 * or `enableSessionReplay: true`) from the active client config in either
 * service makes this test FAIL even if the doc-comment still mentions the flag.
 */

import fs from "node:fs";
import path from "node:path";

/** Remove block + line comments so doc-comment prose can't satisfy an assertion. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const SERVICES = [
  path.resolve(__dirname, "../postHogService.ts"), // mingla-business
  path.resolve(__dirname, "../../../../app-mobile/src/services/postHogService.ts"),
];

describe("META-ORCH-1187 tester adversarial — native replay masking lives in ACTIVE code, not comments", () => {
  for (const file of SERVICES) {
    const label = file.includes("app-mobile") ? "consumer (app-mobile)" : "business";

    it(`${label}: active (de-commented) code enables masked session replay`, () => {
      const raw = fs.readFileSync(file, "utf8");
      const code = stripComments(raw);

      // The flags must survive comment-stripping (i.e. exist in real code).
      expect(code).toMatch(/enableSessionReplay\s*:\s*true/);
      expect(code).toMatch(/maskAllTextInputs\s*:\s*true/);
      expect(code).toMatch(/maskAllImages\s*:\s*true/);

      // And no active code may ever flip a mask flag to false.
      expect(code).not.toMatch(/maskAllTextInputs\s*:\s*false/);
      expect(code).not.toMatch(/maskAllImages\s*:\s*false/);
      expect(code).not.toMatch(/maskAllInputs\s*:\s*false/);
    });

    it(`${label}: masking is inside the live PostHog client constructor (not only a static helper)`, () => {
      const code = stripComments(fs.readFileSync(file, "utf8"));
      // Find the `new PostHogClass(` ... `)` construction region and assert the
      // masked sessionReplayConfig appears within the live constructor call —
      // not merely in an unused buildOptions() helper.
      const ctorIdx = code.indexOf("new PostHogClass(");
      expect(ctorIdx).toBeGreaterThanOrEqual(0);
      const ctorRegion = code.slice(ctorIdx, ctorIdx + 600);
      expect(ctorRegion).toMatch(/sessionReplayConfig\s*:/);
      expect(ctorRegion).toMatch(/maskAllTextInputs\s*:\s*true/);
      expect(ctorRegion).toMatch(/maskAllImages\s*:\s*true/);
    });
  }
});
