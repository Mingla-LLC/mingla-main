#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0857 [Hub Events filter pill row "weird space on top"] regression check.
 *
 * Asserts the four edits in `mingla-business/app/(tabs)/hub/events.tsx`:
 *
 *   E1. `pill.borderColor` is the literal `"rgba(255, 255, 255, 0.55)"`
 *       (idle border alpha raised from 0.08 → 0.55 to match accent.border —
 *       visual polish: toggling pillActive now changes color only, never
 *       perceived bounding rect). The `pill` style block must NOT reference
 *       `glass.border.profileBase` (would indicate a revert).
 *   E2. The filter-pill `<Pressable>` carries `hitSlop={{ top: 5, bottom: 5,
 *       left: 0, right: 0 }}` (WCAG AA / I-38 44pt hit target while visual
 *       height stays at 34pt for row compactness).
 *   E3. `pillLabel` style declares `lineHeight: 16` (deterministic dot/label
 *       cross-axis baseline alignment on the Live pill).
 *   E4. `pillsScroll` style declares `flexGrow: 0` AND `flexShrink: 0` —
 *       THIS IS THE ROOT-CAUSE FIX for the operator-reported "weird space
 *       on top" symptom. Without these, React Native's ScrollView default
 *       `flexGrow: 1` made the pills ScrollView and events ScrollView
 *       compete for the host's leftover vertical space; for filters with
 *       short content (Live=2, Drafts=0), pills greedily took ~200pt extra
 *       and rendered empty space below the pills inside its stretched
 *       frame, pushing the events list ~150pt down. Pinning pillsScroll
 *       to its 50pt intrinsic height eliminates the competition.
 *
 * Fails-on-revert key: E4 — removing either `flexGrow: 0` or `flexShrink: 0`
 * from `pillsScroll` reintroduces the original gap-above-events bug.
 *
 * The tester writes the adversarial second check from a different angle
 * (parsing alpha math, hitSlop arithmetic, cross-style independence) per
 * CLOSE Step 0.5 — see `orch-0857-tester-adversarial-check.mjs` (not yet
 * landed; that's the tester phase).
 *
 * Exit 1 on any FAIL.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
const EVENTS_PATH = resolve(
  REPO_ROOT,
  "mingla-business/app/(tabs)/hub/events.tsx",
);

const results = [];
let failed = 0;

function check(id, label, passed, detail) {
  results.push({ id, label, passed, detail });
  if (!passed) failed += 1;
}

const source = readFileSync(EVENTS_PATH, "utf8");

// ---------------------------------------------------------------------------
// Locate the `pill:` style block (between `pill: {` and the matching `},`).
// ---------------------------------------------------------------------------
const pillBlockMatch = source.match(/\n  pill:\s*\{([\s\S]*?)\n  \},/);
const pillBlock = pillBlockMatch ? pillBlockMatch[1] : "";

// ---------------------------------------------------------------------------
// Locate the `pillLabel:` style block.
// ---------------------------------------------------------------------------
const pillLabelBlockMatch = source.match(/\n  pillLabel:\s*\{([\s\S]*?)\n  \},/);
const pillLabelBlock = pillLabelBlockMatch ? pillLabelBlockMatch[1] : "";

// ---------------------------------------------------------------------------
// Locate the `pillsScroll:` style block (the root-cause fix).
// ---------------------------------------------------------------------------
const pillsScrollBlockMatch = source.match(/\n  pillsScroll:\s*\{([\s\S]*?)\n  \},/);
const pillsScrollBlock = pillsScrollBlockMatch ? pillsScrollBlockMatch[1] : "";
// Strip comments — the ORCH-0857 protective comment intentionally mentions
// `flexGrow: 1` in prose to explain what we're fixing; we only want to flag
// the actual style values.
const pillsScrollBlockNoComments = pillsScrollBlock
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

// ---------------------------------------------------------------------------
// E1 — pill.borderColor literal rgba 0.55 white, and no glass.border.profileBase.
// ---------------------------------------------------------------------------
check(
  "E1.a",
  "pill style contains borderColor literal rgba(255, 255, 255, 0.55)",
  /borderColor:\s*"rgba\(255,\s*255,\s*255,\s*0\.55\)"/.test(pillBlock),
  "Expected the exact literal rgba(255, 255, 255, 0.55) in the `pill` style.",
);

// Strip line-comments before checking — the protective comment intentionally
// names `glass.border.profileBase` to explain what was replaced; we only want
// to flag a regression in the actual `borderColor:` style line.
const pillBlockNoComments = pillBlock
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

check(
  "E1.b",
  "pill style's borderColor line does NOT reference glass.border.profileBase (revert guard)",
  pillBlockNoComments.length > 0 &&
    !/borderColor:\s*glass\.border\.profileBase/.test(pillBlockNoComments),
  "Found `borderColor: glass.border.profileBase` as the active style — indicates a revert of ORCH-0857 Edit 1.",
);

check(
  "E1.c",
  "ORCH-0857 protective comment present in pill style",
  /ORCH-0857 \[Hub pill active-state visual parity\]/.test(pillBlock),
  "Expected the ORCH-0857 protective comment so future tidy-ups don't silently restore the token reference.",
);

// ---------------------------------------------------------------------------
// E2 — Pressable carries hitSlop {top:5, bottom:5, left:0, right:0}.
// ---------------------------------------------------------------------------
check(
  "E2.a",
  "pill Pressable declares hitSlop={{ top: 5, bottom: 5, left: 0, right: 0 }}",
  /hitSlop=\{\{\s*top:\s*5,\s*bottom:\s*5,\s*left:\s*0,\s*right:\s*0\s*\}\}/.test(
    source,
  ),
  "Expected the exact hitSlop literal on the filter-pill Pressable for 44pt I-38 compliance.",
);

check(
  "E2.b",
  "ORCH-0857 protective comment present near hitSlop",
  /ORCH-0857 \[Hub pill 44pt hit target\]/.test(source),
  "Expected the ORCH-0857 protective comment so the hitSlop isn't silently removed by future cleanup.",
);

// ---------------------------------------------------------------------------
// E3 — pillLabel.lineHeight: 16.
// ---------------------------------------------------------------------------
check(
  "E3.a",
  "pillLabel style declares lineHeight: 16",
  /lineHeight:\s*16/.test(pillLabelBlock),
  "Expected `lineHeight: 16` in the `pillLabel` style for deterministic dot/label baseline.",
);

check(
  "E3.b",
  "ORCH-0857 protective comment present in pillLabel style",
  /ORCH-0857 \[Hub pill dot\/label baseline\]/.test(pillLabelBlock),
  "Expected the ORCH-0857 protective comment so future tidy-ups don't silently drop the explicit lineHeight.",
);

// ---------------------------------------------------------------------------
// E4 — ROOT-CAUSE FIX: pillsScroll.flexGrow:0 AND flexShrink:0.
// ---------------------------------------------------------------------------
check(
  "E4.a",
  "pillsScroll style declares flexGrow: 0 (prevents space competition with events ScrollView)",
  /flexGrow:\s*0/.test(pillsScrollBlockNoComments),
  "Expected `flexGrow: 0` in pillsScroll. Without it, RN ScrollView default flexGrow:1 makes pills compete with events for leftover vertical space — reproducing the operator-reported gap-above-events bug on filters with short content (Live, Drafts).",
);

check(
  "E4.b",
  "pillsScroll style declares flexShrink: 0 (defensive pairing with flexGrow:0)",
  /flexShrink:\s*0/.test(pillsScrollBlockNoComments),
  "Expected `flexShrink: 0` alongside flexGrow:0 to fully pin pillsScroll to its 50pt intrinsic height regardless of parent constraints.",
);

check(
  "E4.c",
  "ORCH-0857 root-cause-fix comment present in pillsScroll style",
  /ORCH-0857 \[Hub events list flush-with-pills\]/.test(pillsScrollBlock),
  "Expected the ORCH-0857 root-cause-fix comment so future maintainers understand why flexGrow:0 + flexShrink:0 must stay (the bug they prevent is non-obvious).",
);

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------
console.log("\nORCH-0857 pill visual parity regression check\n");
for (const r of results) {
  const tag = r.passed ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${r.id}  ${r.label}`);
  if (!r.passed) {
    console.log(`         → ${r.detail}`);
  }
}
console.log(
  `\n${results.length - failed}/${results.length} checks passed.\n`,
);

process.exit(failed === 0 ? 0 : 1);
