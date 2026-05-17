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
 *   under `app/(tabs)/hub/` (parent `_layout.tsx:82` already provides
 *   `paddingTop: insets.top` for every hub child).
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
//   - (tabs)/hub/_layout.tsx:82 → paddingTop: insets.top
//   - (tabs)/marketing/_layout.tsx:45 → paddingTop: insets.top
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
    } else if (/\.(tsx|ts)$/.test(entry) && !/\.test\.(tsx|ts)$/.test(entry)) {
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

function checkFile(file) {
  const source = readFileSync(file, "utf8");
  // Allowlist check: scan the whole file (allowlist tag may sit anywhere
  // — typically at the top of imports per convention).
  if (source.includes(ALLOWLIST_TAG)) return;
  // SafeArea check: any of the three patterns satisfies.
  if (SAFE_SCREEN_IMPORT_RE.test(source)) return;
  if (SAFE_AREA_VIEW_IMPORT_RE.test(source)) return;
  if (USE_INSETS_IMPORT_RE.test(source) && PADDING_TOP_RE.test(source)) return;
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
