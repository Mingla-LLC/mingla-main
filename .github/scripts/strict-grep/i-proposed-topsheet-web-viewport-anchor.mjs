#!/usr/bin/env node

/**
 * I-PROPOSED-TOPSHEET-WEB-OVERLAY-NO-FIXED  (ORCH-1136 R2 / F-2 — INVERTED)
 *
 * Supersedes the round-1 I-PROPOSED-TOPSHEET-WEB-VIEWPORT-ANCHOR gate, which
 * REQUIRED a web-gated `position:'fixed'` on the overlay root. Round 1 was a
 * net REGRESSION: the `position:'fixed'` "fix" targeted a problem that is
 * physically impossible under the expo-router web reset (`body{overflow:hidden}`
 * ⇒ the document/route host never document-scrolls), and it introduced a
 * fixed-containing-block trap.
 *
 * THE CORRECT CONTRACT: TopSheet's web overlay MUST be a containing-block-immune
 * `position:absolute` (`StyleSheet.absoluteFill`). `position:'fixed'` is BANNED
 * on this overlay because it is captured by ANY ancestor with
 * transform/filter/backdrop-filter/will-change/contain/perspective in the real
 * Home/Hub shell — collapsing the scrim (see-through) and short-anchoring the
 * panel (ORCH-1136 R2 F-2, harness-proven `drive4.mjs`). `position:absolute` is
 * immune to those ancestors and was harness-proven correct on Home AND Hub
 * under the real reset (`drive2.mjs`).
 *
 * THE RULE (load-bearing fails-on-revert-to-regression):
 *   1. FAIL if `position:'fixed'` appears anywhere in TopSheet.tsx executable
 *      code (comments are stripped first so the rationale comment is allowed).
 *   2. PASS requires `StyleSheet.absoluteFill` present (the overlay root path).
 *   3. FAIL if a `Platform.OS === 'web'` gate is co-located (~400 chars) with a
 *      `rootOverlayStyle` definition that yields `position:'fixed'` — i.e. the
 *      old "web-gated fixed overlay root" construct must not reappear.
 *
 * Investigation: Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1136_R2_BIZ_WEB_SHELL_BUGS.md
 * Scope: the single shared primitive mingla-business/src/components/ui/TopSheet.tsx.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const REL = "mingla-business/src/components/ui/TopSheet.tsx";
const filePath = path.join(repoRoot, REL);

let rawSrc;
try {
  rawSrc = fs.readFileSync(filePath, "utf8");
} catch {
  console.error(
    `\nFAIL [I-PROPOSED-TOPSHEET-WEB-OVERLAY-NO-FIXED]: cannot read ${REL}\n`,
  );
  process.exit(1);
}

// Strip comments so the rationale comment (which legitimately names the banned
// `position:'fixed'` to explain WHY it is banned) does not trip the gate. Only
// executable code is scanned for the regression marker.
const src = rawSrc
  // block comments /* ... */
  .replace(/\/\*[\s\S]*?\*\//g, "")
  // line comments // ...
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const violations = [];

// (1) Load-bearing: position:'fixed' must NOT appear in executable code.
const FIXED_RE = /position:\s*["']fixed["']/;
if (FIXED_RE.test(src)) {
  violations.push(
    "`position: \"fixed\"` is present in executable code — BANNED on the TopSheet overlay root (containing-block trap, ORCH-1136 R2 F-2). Revert the overlay to bare StyleSheet.absoluteFill.",
  );
}

// (2) The overlay root must use StyleSheet.absoluteFill.
if (!/StyleSheet\.absoluteFill/.test(src)) {
  violations.push(
    "`StyleSheet.absoluteFill` missing — the web overlay root MUST be containing-block-immune position:absolute.",
  );
}

// (3) The old web-gated-fixed `rootOverlayStyle` construct must not reappear:
// FAIL if a Platform.OS === 'web' gate co-locates (~400 chars) with a
// position:'fixed' near a rootOverlayStyle definition.
const rootIdx = src.indexOf("rootOverlayStyle");
if (rootIdx >= 0) {
  const region = src.slice(rootIdx, rootIdx + 400);
  const gatedFixed =
    /Platform\.OS\s*===\s*["']web["']/.test(region) && FIXED_RE.test(region);
  if (gatedFixed) {
    violations.push(
      "a `rootOverlayStyle` web-gated `position: \"fixed\"` construct reappeared — the round-1 regression. Remove it; the overlay root is bare StyleSheet.absoluteFill on all platforms.",
    );
  }
}

if (violations.length > 0) {
  console.error("\nFAIL [I-PROPOSED-TOPSHEET-WEB-OVERLAY-NO-FIXED]:");
  console.error(
    "  TopSheet's web overlay root MUST be position:absolute (StyleSheet.absoluteFill);",
  );
  console.error(
    "  position:'fixed' is BANNED (containing-block trap — ORCH-1136 R2 F-2).",
  );
  for (const v of violations) console.error(`  ✗ ${v}`);
  console.error("");
  process.exit(1);
}

console.log(
  "OK [I-PROPOSED-TOPSHEET-WEB-OVERLAY-NO-FIXED]: TopSheet overlay root is bare StyleSheet.absoluteFill (position:absolute); no banned position:'fixed'.",
);
