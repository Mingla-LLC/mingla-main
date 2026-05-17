#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0857 [Hub Events filter pill row "weird space on top"] TESTER adversarial check.
 *
 * Companion to `orch-0857-pill-visual-parity-check.mjs` (implementor happy-path).
 *
 * The implementor check verifies the four edits are present in source. This
 * adversarial check attacks DIFFERENT angles per ORCH-0840 [Regression-test
 * enforcement + append-only CI] Step 0.5:
 *
 *   TA1. ASYMMETRY guard — pillsScroll must have flexGrow:0 AND the events
 *        ScrollView outer style must NOT have flexGrow:0. The fix relies on
 *        an ASYMMETRIC pinning: pills shrink to intrinsic, events keeps
 *        default flexGrow:1 to fill remaining space. If a future maintainer
 *        "balances" things by adding flexGrow:0 to both, the events ScrollView
 *        will collapse to its content size and the bug re-emerges differently
 *        (content gets pushed down by sibling-stretch in the OTHER direction).
 *        The implementor check doesn't catch this; we do.
 *
 *   TA2. HITSLOP MATH guard — pill visual height (34pt from `pill.height: 34`)
 *        + hitSlop.top + hitSlop.bottom MUST sum to >= 44pt to satisfy
 *        WCAG AA / Mingla I-38 touch target. Parses the actual literal values
 *        instead of asserting presence — catches future drift that reduces
 *        the hitSlop without removing it entirely.
 *
 *   TA3. ALPHA-PARITY guard — operator-approved cosmetic invariant
 *        I-PROPOSED-PILL-ACTIVE-STATE-VISUAL-PARITY: the pill's idle border
 *        alpha (0.55 white) must be within ±0.10 of the active border alpha
 *        (accent.border = 0.55 orange). Parses both alpha values from source
 *        and asserts the delta. The implementor check only asserts the
 *        literal rgba string; this check asserts the SEMANTIC invariant.
 *
 *   TA4. ORCH-0855 ISOLATION guard — verifies the ORCH-0857 fix did NOT
 *        accidentally touch `designSystem.ts` or any file owned by the
 *        in-flight ORCH-0855 [TR1 Trip Planner Brand Onboarding] close.
 *        Asserts `glass.border.profileBase` literal in designSystem.ts is
 *        UNCHANGED at `"rgba(255, 255, 255, 0.08)"` (would indicate a global
 *        token mutation that violates SPEC §2 non-goals).
 *
 *   TA5. CROSS-SCROLLVIEW-COUNT sanity — asserts events.tsx has exactly 2
 *        `<ScrollView>` elements (pills row + events list). If a future
 *        refactor adds a 3rd sibling ScrollView without applying the
 *        flexGrow:0 fix to it as well, the same class of bug returns.
 *        This check forces re-audit when the count changes.
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
const DESIGN_SYSTEM_PATH = resolve(
  REPO_ROOT,
  "mingla-business/src/constants/designSystem.ts",
);

const results = [];
let failed = 0;

function check(id, label, passed, detail) {
  results.push({ id, label, passed, detail });
  if (!passed) failed += 1;
}

const eventsSource = readFileSync(EVENTS_PATH, "utf8");
const dsSource = readFileSync(DESIGN_SYSTEM_PATH, "utf8");

// Helpers for comment-stripped block matching.
function stripComments(block) {
  return block
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

function matchBlock(source, name) {
  const re = new RegExp(`\\n  ${name}:\\s*\\{([\\s\\S]*?)\\n  \\},`);
  const m = source.match(re);
  return m ? stripComments(m[1]) : "";
}

const pillsScrollBlock = matchBlock(eventsSource, "pillsScroll");
const pillBlock = matchBlock(eventsSource, "pill");

// ---------------------------------------------------------------------------
// TA1 — Asymmetric pinning: pillsScroll flexGrow:0 AND events ScrollView NOT
// pinned. Parse pillsScroll and locate any other ScrollView style block.
// ---------------------------------------------------------------------------
const pillsScrollHasGrowZero = /flexGrow:\s*0/.test(pillsScrollBlock);
// Look for the events ScrollView JSX — it should NOT carry style={...flexGrow:0}.
// In the current code the events ScrollView has no `style` prop, only
// `contentContainerStyle`. Assert no `style={` prop on the second
// ScrollView OR if there is one, it must not declare flexGrow:0.
const scrollViewMatches = [
  ...eventsSource.matchAll(/<ScrollView\b([\s\S]*?)>/g),
];
const eventsScrollViewJsx =
  scrollViewMatches.length >= 2 ? scrollViewMatches[1][1] : "";
const eventsHasExplicitGrowZero =
  /style=\{[^}]*flexGrow:\s*0/.test(eventsScrollViewJsx);

check(
  "TA1.a",
  "pillsScroll style has flexGrow: 0 (asymmetric pinning - shrink side)",
  pillsScrollHasGrowZero,
  "Without flexGrow:0 on pillsScroll, the pills ScrollView competes with the events ScrollView for space and re-introduces the bug.",
);

check(
  "TA1.b",
  "events ScrollView does NOT have flexGrow:0 (asymmetric pinning - fill side)",
  !eventsHasExplicitGrowZero,
  "Adding flexGrow:0 to the events ScrollView too would collapse it to content size and re-introduce the gap-above bug in a different mode. The fix MUST be asymmetric: pills pinned, events default-grow.",
);

// ---------------------------------------------------------------------------
// TA2 — Hit-target math: pill.height + hitSlop.top + hitSlop.bottom >= 44.
// ---------------------------------------------------------------------------
const pillHeightMatch = pillBlock.match(/height:\s*(\d+)/);
const pillHeight = pillHeightMatch ? parseInt(pillHeightMatch[1], 10) : 0;
const hitSlopMatch = eventsSource.match(
  /hitSlop=\{\{\s*top:\s*(\d+),\s*bottom:\s*(\d+)/,
);
const hitSlopTop = hitSlopMatch ? parseInt(hitSlopMatch[1], 10) : 0;
const hitSlopBottom = hitSlopMatch ? parseInt(hitSlopMatch[2], 10) : 0;
const totalTouchHeight = pillHeight + hitSlopTop + hitSlopBottom;

check(
  "TA2",
  `total touch target height >= 44pt (got ${totalTouchHeight}pt = ${pillHeight} pill + ${hitSlopTop} top + ${hitSlopBottom} bottom)`,
  totalTouchHeight >= 44,
  `WCAG AA + Mingla I-38 require >= 44pt. Current ${totalTouchHeight}pt fails. Increase pill.height or hitSlop.top/bottom.`,
);

// ---------------------------------------------------------------------------
// TA3 — Alpha-parity invariant (I-PROPOSED-PILL-ACTIVE-STATE-VISUAL-PARITY).
// Parse idle border alpha from pill.borderColor literal, active border alpha
// from designSystem.ts accent.border literal. Delta must be <= 0.10.
// ---------------------------------------------------------------------------
const idleAlphaMatch = pillBlock.match(
  /borderColor:\s*"rgba\(\d+,\s*\d+,\s*\d+,\s*([\d.]+)\)"/,
);
const idleAlpha = idleAlphaMatch ? parseFloat(idleAlphaMatch[1]) : NaN;
const accentBorderMatch = dsSource.match(
  /border:\s*"rgba\(\d+,\s*\d+,\s*\d+,\s*([\d.]+)\)"/,
);
const activeAlpha = accentBorderMatch ? parseFloat(accentBorderMatch[1]) : NaN;
const alphaDelta = Math.abs(idleAlpha - activeAlpha);

check(
  "TA3",
  `idle border alpha (${idleAlpha}) and active border alpha (${activeAlpha}) within ±0.10 (delta=${alphaDelta.toFixed(3)})`,
  !Number.isNaN(idleAlpha) && !Number.isNaN(activeAlpha) && alphaDelta <= 0.1,
  `I-PROPOSED-PILL-ACTIVE-STATE-VISUAL-PARITY: toggling pillActive must change color only, never perceived bounding rect. Current delta ${alphaDelta.toFixed(3)} > 0.10 will re-introduce the active-pill-looks-bigger visual asymmetry.`,
);

// ---------------------------------------------------------------------------
// TA4 — Isolation: ORCH-0857 fix must NOT have mutated the global
// glass.border.profileBase token (would silently change every other glass
// component in mingla-business).
// ---------------------------------------------------------------------------
const profileBaseStillO8 = /profileBase:\s*"rgba\(255,\s*255,\s*255,\s*0\.08\)"/.test(dsSource);

check(
  "TA4",
  "glass.border.profileBase in designSystem.ts UNCHANGED at rgba(255,255,255,0.08)",
  profileBaseStillO8,
  "ORCH-0857 SPEC §2 non-goals forbade touching the global token. If profileBase was mutated, every glass-bordered component in mingla-business is silently affected — out of scope and risky.",
);

// ---------------------------------------------------------------------------
// TA5 — ScrollView count sanity. Force re-audit if a 3rd sibling appears.
// ---------------------------------------------------------------------------
const scrollViewCount = (eventsSource.match(/<ScrollView\b/g) || []).length;

check(
  "TA5",
  `events.tsx contains exactly 2 ScrollView elements (got ${scrollViewCount})`,
  scrollViewCount === 2,
  "ORCH-0857 fix's asymmetric flexGrow:0 pinning was designed for exactly 2 sibling ScrollViews. A 3rd ScrollView reintroduces the space-competition class — re-audit the fix and apply flexGrow:0 to N-1 of them, OR update this check's expected count after confirming the new layout is correct.",
);

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------
console.log("\nORCH-0857 tester adversarial regression check\n");
for (const r of results) {
  const tag = r.passed ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${r.id}  ${r.label}`);
  if (!r.passed) {
    console.log(`         → ${r.detail}`);
  }
}
console.log(
  `\n${results.length - failed}/${results.length} adversarial checks passed.\n`,
);

process.exit(failed === 0 ? 0 : 1);
