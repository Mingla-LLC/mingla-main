#!/usr/bin/env node

/**
 * I-STICKY-FOOTER-VIA-HOOK (ORCH-0889 invariant)
 *
 * Rejects inline `insets.bottom + 96` (or similar mobile-bottom-nav
 * reservation arithmetic) for FAB / sticky-footer positioning inside
 * marketing routes. The 96pt reservation is correct on native + narrow
 * web (clears the floating BottomNav capsule) but wrong on wide-desktop
 * (≥1024px) where the BottomNav is replaced by a fixed-left rail —
 * `insets.bottom` is 0 on web, so the FAB floats 96pt above the
 * viewport floor with an empty gutter underneath.
 *
 * Correct shape: import + use `useStickyFooterOffset()` from
 * `src/hooks/useStickyFooterOffset.ts` (single source of truth — gates
 * on `useResponsiveLayout().isWideDesktop`).
 *
 * Scope: mingla-business/app/(tabs)/marketing/**\/*.tsx
 *
 * Allow-list: none — every marketing route's FAB MUST use the hook.
 *
 * Cross-references:
 *   - SPEC_ORCH-0889 §3.5.1 + §5 (invariants)
 *   - feedback_strict_grep_registry_pattern.md (one script + one job)
 *   - INVESTIGATION_ORCH-0889_*.md CF-1
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const TARGET_ROOT = "mingla-business/app/(tabs)/marketing";

/**
 * Match `insets.bottom + 96`, `inset.bottom + 96`, or even
 * `safeArea.bottom + 96` — variations on the legacy mobile-bottom-nav
 * reservation. The trailing `96` is the canonical magic number from
 * pre-ORCH-0889 marketing routes; reservations of other sizes (e.g.,
 * +120 for a different chrome) are out of scope for this gate.
 */
const BRITTLE = /\b(?:insets?|safeArea)\.bottom\s*\+\s*96\b/;

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_err) {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      yield* walk(full);
    } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
      yield full;
    }
  }
}

const violations = [];
let filesScanned = 0;

const targetAbs = path.join(repoRoot, TARGET_ROOT);
for (const file of walk(targetAbs)) {
  const rel = path.relative(repoRoot, file);
  filesScanned++;
  const source = fs.readFileSync(file, "utf8");
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (BRITTLE.test(line)) {
      violations.push({
        file: rel,
        line: index + 1,
        text: line.trim(),
      });
    }
  });
}

if (violations.length > 0) {
  console.error(
    "I-STICKY-FOOTER-VIA-HOOK violation (ORCH-0889):",
  );
  console.error(
    "  inline `insets.bottom + 96` FAB / sticky-footer positioning " +
      "found in marketing route.",
  );
  console.error(
    "  The 96pt reservation is correct on native + narrow web but " +
      "wrong on wide-desktop where insets.bottom is 0 and there is no " +
      "bottom nav to clear.",
  );
  console.error(
    "  Fix: import { useStickyFooterOffset } from " +
      "'.../hooks/useStickyFooterOffset' and apply " +
      "`{ bottom: useStickyFooterOffset() }` to the FAB style.",
  );
  console.error("");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.text}`);
  }
  console.error("");
  console.error(
    `Scanned ${filesScanned} file(s) under ${TARGET_ROOT}; found ${violations.length} violation(s).`,
  );
  process.exit(1);
}

console.log(
  `ORCH-0889 sticky-footer-via-hook OK: scanned ${filesScanned} file(s) under ${TARGET_ROOT}; no inline insets.bottom + 96 FAB positioning found.`,
);
process.exit(0);
