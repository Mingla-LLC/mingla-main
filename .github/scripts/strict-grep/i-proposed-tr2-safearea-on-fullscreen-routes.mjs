#!/usr/bin/env node
/**
 * I-PROPOSED-TR2-SAFEAREA-ON-FULLSCREEN-ROUTES strict-grep gate.
 *
 * Every full-screen route file under `mingla-business/app/` MUST either:
 *   (a) import `SafeScreen` from `src/components/ui/SafeScreen`, OR
 *   (b) import `useSafeAreaInsets` from `react-native-safe-area-context`
 *       AND apply `paddingTop: insets.top` somewhere in the render path,
 *       OR import `SafeAreaView` from `react-native-safe-area-context`, OR
 *   (c) be preceded by an allowlist comment on a line above the imports:
 *       `// orch-strict-grep-allow safearea-on-fullscreen-routes — <reason>`
 *
 * Skipped: _layout.tsx files (those PROVIDE SafeArea, don't consume), files
 *   under `app/(tabs)/hub/` (parent `_layout.tsx:257` already provides
 *   `paddingTop: insets.top` for every hub child), co-located non-route `.ts`
 *   helpers (pure logic — they render no screen chrome), the `+html.tsx` web
 *   document shell, and `.web.tsx` web-platform variants (web has no notch —
 *   SafeArea is a native-only concern). See `walkTsx` for the exact scan set.
 *
 * Why this exists: ORCH-0864 [SafeArea drift systemic + SafeScreen wrapper]
 *   forensics found 4 confirmed broken routes (trip operator dashboard
 *   bleeding into status bar — operator screenshot) plus ~10 unaudited
 *   routes that may have the same bug. Without a CI gate, new full-screen
 *   routes keep shipping without SafeArea and operators only notice on
 *   the device.
 *
 * Established by: ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 5
 *   (architectural fix for the drift bug class). Invariant flips DRAFT →
 *   ACTIVE on REWORK 5 CLOSE.
 *
 * `--self-test` drives the pure violation check and the scan-set predicate with
 *   in-memory fixtures (a top-anchored route with no SafeArea signal and no
 *   allowlist MUST flag; a SafeScreen/inset/SafeAreaView/allowlisted fixture MUST
 *   pass; `.ts`/`.web.tsx`/`+html.tsx` MUST be out of scan scope, real `.tsx`
 *   routes in). It proves the narrowed gate still has teeth without mutating any
 *   real route. Exit 0 pass / 1 fail.
 *
 * Exit codes:
 *   0 — clean
 *   1 — at least one violation
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const APP_DIR = join(REPO_ROOT, "mingla-business", "app");
// Directories whose _layout.tsx provides `paddingTop: insets.top` for ALL
// child routes. Child routes inherit and don't need their own SafeArea.
// Verified by reading each layout file:
//   - (tabs)/hub/_layout.tsx:257 → paddingTop: insets.top
//   - (tabs)/marketing/_layout.tsx:53 → paddingTop: insets.top
const TOP_INSET_PARENT_PREFIXES = [
  join(APP_DIR, "(tabs)", "hub") + "/",
  join(APP_DIR, "(tabs)", "marketing") + "/",
];

const ALLOWLIST_TAG = "orch-strict-grep-allow safearea-on-fullscreen-routes";
const SAFE_SCREEN_IMPORT_RE = /from\s+["'][^"']*SafeScreen["']/;
const USE_INSETS_IMPORT_RE = /useSafeAreaInsets/;
const SAFE_AREA_VIEW_IMPORT_RE = /SafeAreaView/;
const PADDING_TOP_RE = /paddingTop:\s*insets\.top/;

let violations = 0;
let filesScanned = 0;

// Is this directory entry a native/shared Expo-Router SCREEN route file the gate
// should scan? Only real `.tsx` route files render screen chrome that can bleed
// under the status bar. Deliberately EXCLUDED (a SafeArea check is
// category-inapplicable to them):
//   - `.test.tsx` — test files, not routes
//   - co-located `.ts` helpers — pure logic, render nothing
//   - `.web.tsx` — web-platform variants (web has no notch; SafeArea is native-only)
//   - `+html.tsx` — the Expo Router web HTML document shell (web-only, no SafeArea)
// Narrowed here (was `/\.(tsx|ts)$/`) to reconcile the detector with its intent —
// the gate's teeth are on NEW top-level `.tsx` routes that render their own chrome.
export function isScannableRouteFile(entry) {
  return (
    /\.tsx$/.test(entry) &&
    !/\.test\.tsx$/.test(entry) &&
    !/\.web\.tsx$/.test(entry) &&
    entry !== "+html.tsx"
  );
}

function* walkTsx(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "__tests__" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walkTsx(full);
    } else if (isScannableRouteFile(entry)) {
      yield full;
    }
  }
}

function isLayoutFile(file) {
  return /[\/\\]_layout\.(tsx|ts)$/.test(file);
}

function isUnderTopInsetParent(file) {
  return TOP_INSET_PARENT_PREFIXES.some((p) => file.startsWith(p));
}

// Pure violation check on source text (no I/O), so --self-test can drive it with
// in-memory fixtures instead of mutating real routes. Returns true when a scanned
// route renders chrome but carries NO SafeArea signal AND NO allowlist comment.
export function isSafeAreaViolation(source) {
  // Allowlist check: scan the whole file (allowlist tag may sit anywhere
  // — typically at the top of imports per convention).
  if (source.includes(ALLOWLIST_TAG)) return false;
  // SafeArea check: any of the three patterns satisfies.
  if (SAFE_SCREEN_IMPORT_RE.test(source)) return false;
  if (SAFE_AREA_VIEW_IMPORT_RE.test(source)) return false;
  if (USE_INSETS_IMPORT_RE.test(source) && PADDING_TOP_RE.test(source)) return false;
  return true;
}

function checkFile(file) {
  const source = readFileSync(file, "utf8");
  if (!isSafeAreaViolation(source)) return;
  // Violation.
  violations += 1;
  const rel = relative(REPO_ROOT, file);
  console.error(
    `✗ ${rel} — full-screen route missing SafeArea protection (no SafeScreen import, no useSafeAreaInsets + paddingTop: insets.top, no SafeAreaView, no allowlist comment)`,
  );
  console.error(
    `    fix options:`,
  );
  console.error(
    `      (a) wrap root view in <SafeScreen> from "src/components/ui/SafeScreen"`,
  );
  console.error(
    `      (b) use useSafeAreaInsets() + paddingTop: insets.top on root style`,
  );
  console.error(
    `      (c) add allowlist comment: // ${ALLOWLIST_TAG} — <reason>`,
  );
}

// ---- Self-test (regression proof — narrowed gate must still have teeth) ----
if (process.argv.includes("--self-test")) {
  const selfFailures = [];

  // A minimal route body that renders top-anchored chrome (no centering) and no
  // SafeArea signal — exactly the ORCH-0864 defect class the gate exists to catch.
  const bare =
    `import { View, Text } from "react-native";\n` +
    `export default function Screen() {\n` +
    `  return (\n` +
    `    <View style={{ flex: 1 }}>\n` +
    `      <Text>Dashboard</Text>\n` +
    `    </View>\n` +
    `  );\n` +
    `}\n`;

  // (a) NO SafeArea signal + NO allowlist → MUST be flagged (proves teeth).
  if (!isSafeAreaViolation(bare)) {
    selfFailures.push(
      "(a) a top-anchored route with no SafeArea signal was NOT flagged — the gate has no teeth",
    );
  }

  // (b) each satisfier → MUST pass.
  const satisfiers = {
    "SafeScreen import":
      `import { SafeScreen } from "../src/components/ui/SafeScreen";\n` + bare,
    "useSafeAreaInsets + paddingTop: insets.top":
      `import { useSafeAreaInsets } from "react-native-safe-area-context";\n` +
      `export default function S() {\n` +
      `  const insets = useSafeAreaInsets();\n` +
      `  return <View style={{ flex: 1, paddingTop: insets.top }} />;\n` +
      `}\n`,
    "SafeAreaView import":
      `import { SafeAreaView } from "react-native-safe-area-context";\n` + bare,
    "allowlist comment":
      `// ${ALLOWLIST_TAG} — renders GroupChatPanel, which wraps in SafeScreen\n` +
      bare,
  };
  for (const [label, src] of Object.entries(satisfiers)) {
    if (isSafeAreaViolation(src)) {
      selfFailures.push(`(b) a route with ${label} was wrongly flagged`);
    }
  }

  // (c) scan-set precision: real `.tsx` routes IN scope; `.ts` helpers / `.web.tsx`
  // variants / `+html.tsx` shell / `.test.tsx` OUT. Reverting the walk-narrowing
  // (back to `/\.(tsx|ts)$/`) re-includes the excluded classes and fails here.
  const inScope = ["index.tsx", "[id].tsx", "group-chat.tsx", "+not-found.tsx"];
  const outOfScope = [
    "snapOutcome.ts",
    "bookableTierCount.ts",
    "autoSkipDecision.ts",
    "connect.web.tsx",
    "index.web.tsx",
    "+html.tsx",
    "Screen.test.tsx",
  ];
  for (const e of inScope) {
    if (!isScannableRouteFile(e)) {
      selfFailures.push(`(c) real route "${e}" was wrongly excluded from the scan set`);
    }
  }
  for (const e of outOfScope) {
    if (isScannableRouteFile(e)) {
      selfFailures.push(`(c) non-route "${e}" was wrongly included in the scan set`);
    }
  }

  if (selfFailures.length) {
    console.error(
      "I-PROPOSED-TR2-SAFEAREA-ON-FULLSCREEN-ROUTES self-test FAIL:",
    );
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "I-PROPOSED-TR2-SAFEAREA-ON-FULLSCREEN-ROUTES self-test PASS (all cases).",
  );
  process.exit(0);
}

// ---- Live mode ----
for (const file of walkTsx(APP_DIR)) {
  if (isLayoutFile(file)) continue;
  if (isUnderTopInsetParent(file)) continue;
  filesScanned += 1;
  checkFile(file);
}

console.log(
  `I-PROPOSED-TR2-SAFEAREA-ON-FULLSCREEN-ROUTES: scanned ${filesScanned} files, ${violations} violations`,
);
process.exit(violations === 0 ? 0 : 1);
