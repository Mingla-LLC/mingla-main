#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0861 [Lint/CI gate for sibling <ScrollView> without flexGrow: 0]
 * — INFORMATIONAL gate (exit 0 always; emits WARN lines for review).
 *
 * The bug class: React Native's `<ScrollView>` outer container defaults to
 * `flexGrow: 1` + `flexShrink: 1`. When two ScrollView siblings share a
 * flex parent, they compete for leftover space; the smaller one greedily
 * takes extra and renders empty space inside its stretched frame, pushing
 * the larger sibling's content away. Symptom: filter/tab/state-dependent
 * gap between sections that varies with data size.
 *
 * Canonical case: ORCH-0857 [Hub Events filter pill row "weird space on
 * top"]. The fix was 2 lines: `flexGrow: 0, flexShrink: 0` on the smaller
 * ScrollView's outer style.
 *
 * Pre-existing canonical fix sites confirmed safe (these prove the
 * codebase knows the pattern — the gate's job is to keep new screens
 * from forgetting it):
 *   - mingla-business/app/event/[id]/orders/index.tsx (filtersScroll)
 *   - app-mobile/src/components/activity/CardFilterBar.tsx (chipScroll)
 *   - mingla-business/app/(tabs)/hub/events.tsx (pillsScroll — post-ORCH-0857)
 *
 * **Heuristic (intentionally simple to avoid JSX-AST dependency):**
 *   - Scan all .tsx files in mingla-business/ + app-mobile/
 *   - Count `<ScrollView` occurrences (case-sensitive, excludes commented lines)
 *   - If count >= 2 AND the file does NOT contain `flexGrow: 0` anywhere → WARN
 *
 * **False positives are EXPECTED** — conditional rendering (only one
 * ScrollView active at a time), nested ScrollViews, Modal/Sheet-bounded
 * containers, and StyleSheet.absoluteFill-positioned ScrollViews are all
 * safe but trip the heuristic. Hence INFORMATIONAL only — the warnings
 * are a prompt for human review, not a CI failure.
 *
 * **False negatives are POSSIBLE** — if a file has `flexGrow: 0` somewhere
 * unrelated (e.g., a non-ScrollView style), the gate passes even if the
 * ScrollView pair is actually vulnerable. Acceptable tradeoff for v1.
 *
 * **Allowlist mechanism (operator escape valve):** files with a top-level
 * comment `// ORCH-0861-OK: <reason>` are skipped — for false positives
 * the heuristic can't avoid, the operator can suppress per-file with
 * an explanation.
 *
 * **Exit 0 always.** Counts WARN lines and prints summary.
 *
 * Promote to FAIL (exit 1) only after operator confirms the heuristic
 * has acceptable signal/noise ratio post-rollout.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
const SCAN_ROOTS = [
  resolve(REPO_ROOT, "mingla-business"),
  resolve(REPO_ROOT, "app-mobile"),
];

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".expo",
  "dist",
  "build",
  "ios",
  "android",
  "Pods",
  ".git",
  "coverage",
]);

function walkTsxFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const path = resolve(dir, name);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walkTsxFiles(path, out);
    } else if (stat.isFile() && name.endsWith(".tsx")) {
      out.push(path);
    }
  }
  return out;
}

function stripLineComments(content) {
  return content
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

function stripBlockComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, "");
}

function countScrollViewOccurrences(content) {
  const cleaned = stripBlockComments(stripLineComments(content));
  return (cleaned.match(/<ScrollView\b/g) || []).length;
}

function hasFlexGrowZero(content) {
  const cleaned = stripBlockComments(stripLineComments(content));
  return /flexGrow:\s*0/.test(cleaned);
}

function hasAllowlistComment(content) {
  // Match `// ORCH-0861-OK: <reason>` on any line (case-sensitive).
  return /\/\/\s*ORCH-0861-OK:\s*.+/.test(content);
}

const warnings = [];
let scannedCount = 0;
let allowlistedCount = 0;
let safeCount = 0;

for (const root of SCAN_ROOTS) {
  const files = walkTsxFiles(root);
  for (const path of files) {
    scannedCount += 1;
    const content = readFileSync(path, "utf8");
    const scrollViewCount = countScrollViewOccurrences(content);
    if (scrollViewCount < 2) continue;
    if (hasAllowlistComment(content)) {
      allowlistedCount += 1;
      continue;
    }
    if (hasFlexGrowZero(content)) {
      safeCount += 1;
      continue;
    }
    warnings.push({
      path: relative(REPO_ROOT, path),
      scrollViewCount,
    });
  }
}

console.log("\nORCH-0861 sibling-ScrollView flexGrow:0 informational gate");
console.log(
  `Scanned ${scannedCount} .tsx files under mingla-business/ + app-mobile/.\n`,
);
console.log(`  ${safeCount} file(s) with 2+ <ScrollView> already have flexGrow:0 ✅`);
console.log(`  ${allowlistedCount} file(s) explicitly allowlisted via ORCH-0861-OK comment\n`);

if (warnings.length === 0) {
  console.log("PASS — all sibling-ScrollView files declare flexGrow:0 or are allowlisted.\n");
  process.exit(0);
}

console.log(
  `WARN — ${warnings.length} file(s) with 2+ <ScrollView> and no flexGrow:0 (review for ORCH-0857 [Hub Events filter pill row "weird space on top"] bug class):\n`,
);
for (const w of warnings) {
  console.log(`  ${w.scrollViewCount}x  ${w.path}`);
}
console.log("");
console.log(
  "Each WARN above is a CANDIDATE for the sibling-ScrollView footgun, NOT a confirmed bug.\n" +
    "False positives are expected — conditional rendering, nested ScrollViews, Modal-bounded,\n" +
    "and StyleSheet.absoluteFill containers all trip the heuristic but are safe.\n",
);
console.log("Review options:");
console.log(
  "  1. CONFIRMED VULNERABLE → add `flexGrow: 0, flexShrink: 0` to the smaller ScrollView's outer style.",
);
console.log(
  '  2. SAFE (conditional/nested/bounded) → add `// ORCH-0861-OK: <one-line reason>` somewhere in the file.',
);
console.log(
  "  3. Reference: feedback_rn_scrollview_flex_grow_default_one_silent_footgun.md memory.\n",
);

// Informational only — never fails CI.
process.exit(0);
