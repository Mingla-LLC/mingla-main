#!/usr/bin/env node

/**
 * ORCH-1117 R1 — I-PROPOSED-NO-RAW-WHITE-ON-PALETTE-SURFACE
 *
 * In packages/event-rendering/PublicEventPage.tsx, text that sits on a palette
 * surface (page / card / glass / panel / accentWash) MUST take its color from
 * the luminance-aware palette tokens, never a raw `#ffffff` / `#fff` literal —
 * otherwise it vanishes white-on-near-white on a light brand theme (the exact
 * ORCH-1117 bug on the date eyebrow + recurrence pill).
 *
 * The scan targets the JSX RENDER body only (everything BEFORE the
 * `const styles = StyleSheet.create(` line). The render body is where inline
 * `style={[..., { color: "#ffffff" }]}` overrides live; after the ORCH-1117 fix
 * the body contains ZERO such literals. Reverting the fix (re-adding the literal
 * at the date line / recurrence pill) re-introduces a body-level
 * `color: "#ffffff"` → this gate FAILS.
 *
 * The StyleSheet block (after the cut line) is NOT scanned: it legitimately
 * carries `#ffffff`/`#fff` on text that sits on a GUARANTEED-DARK accent fill
 * (brandLetter on the accent disk, venueIcon, venueMapsText, gateUnlockLabel,
 * accentText button) — those pairings are intentional and stay.
 *
 * Self-test (`--self-test`): inject a body-level `color: "#ffffff"` into a copy
 * of the source in memory and assert the scan flags it.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const TARGET = path.join(
  repoRoot,
  "packages/event-rendering/PublicEventPage.tsx",
);

// Matches a text-style color override set to raw white, in any quoting/spacing.
const FORBIDDEN = /color:\s*["'](#ffffff|#fff)["']/i;
// Where the render body ends and the StyleSheet block (allowed whites) begins.
const STYLE_CUT = /const\s+styles\s*=\s*StyleSheet\.create\s*\(/;

function scanBody(source) {
  const cutMatch = STYLE_CUT.exec(source);
  const body = cutMatch === null ? source : source.slice(0, cutMatch.index);
  const violations = [];
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (FORBIDDEN.test(lines[i])) {
      violations.push({ line: i + 1, text: lines[i].trim() });
    }
  }
  return violations;
}

function runSelfTest() {
  const source = fs.readFileSync(TARGET, "utf8");
  // Inject a body-level offender just before the StyleSheet cut.
  const cutMatch = STYLE_CUT.exec(source);
  const injectAt = cutMatch === null ? source.length : cutMatch.index;
  const poisoned =
    source.slice(0, injectAt) +
    '\nconst __orch1117_selftest = { color: "#ffffff" };\n' +
    source.slice(injectAt);
  const violations = scanBody(poisoned);
  if (violations.length === 0) {
    console.error(
      "ORCH-1117 R1 self-test FAILED: injected body-level color:\"#ffffff\" was NOT flagged.",
    );
    process.exit(1);
  }
  // And the real source must be clean.
  const real = scanBody(source);
  if (real.length > 0) {
    console.error(
      "ORCH-1117 R1 self-test FAILED: the real source already contains a forbidden raw-white in the render body:",
      real,
    );
    process.exit(1);
  }
  console.log("ORCH-1117 R1 self-test PASSED.");
  process.exit(0);
}

function run() {
  if (!fs.existsSync(TARGET)) {
    console.error(`ORCH-1117 R1 gate: target not found: ${TARGET}`);
    process.exit(1);
  }
  const source = fs.readFileSync(TARGET, "utf8");
  const violations = scanBody(source);
  if (violations.length > 0) {
    console.error(
      "ORCH-1117 R1 FAILED — raw white literal on a text element in the " +
        "PublicEventPage render body (the date eyebrow + recurrence pill must " +
        "read from the luminance-aware palette, never raw white, or they " +
        "vanish on a light brand theme):",
    );
    for (const v of violations) {
      console.error(`  L${v.line}: ${v.text}`);
    }
    process.exit(1);
  }
  console.log("ORCH-1117 R1 PASSED — no raw white on a palette surface.");
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  run();
}
