#!/usr/bin/env node
/**
 * ORCH-0847 [Consumer ticket purchase parity with public business page]
 * strict-grep gate #4 — `TicketClaimConfirmModal.tsx` deletion lock.
 *
 * After Phase C replaces the single-ticket confirmation modal with the
 * multi-tier `TicketCartSheet`, the prior file is dead code. This gate
 * locks the deletion so a future cherry-pick / rebase can't silently
 * resurrect the file.
 *
 * What this gate enforces:
 *
 *   1. `app-mobile/src/components/expandedCard/TicketClaimConfirmModal.tsx`
 *      MUST NOT exist on disk.
 *
 *   2. No import of `TicketClaimConfirmModal` remains in any app-mobile
 *      source file — confirms the orphan dependency is fully gone.
 *
 * Note: the two locked CI regression scripts that previously asserted
 * the modal's presence (`orch-0829a-regression-check.mjs` T-A1/T-A2/T-A4
 * and `orch-0834-rescoped-regression-check.mjs` T-A5/T-A6) are retired
 * in the same ORCH-0847 close commit using the `[TEST-MOD-APPROVED
 * ORCH-0847]` append-only override token per the
 * `.github/workflows/tests-append-only.yml` rule.
 *
 * Exit codes:
 *   0 — clean (file gone, no imports)
 *   1 — violation
 *
 * Per ORCH-0847 SPEC §9 Gate 4.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..", "..", "..");

const violations = [];
const note = (file, msg) => violations.push({ file, msg });

// Check 1 — file does NOT exist
const modalPath = join(
  ROOT,
  "app-mobile/src/components/expandedCard/TicketClaimConfirmModal.tsx",
);
if (existsSync(modalPath)) {
  note(
    "app-mobile/src/components/expandedCard/TicketClaimConfirmModal.tsx",
    "File MUST be deleted — replaced by TicketCartSheet per ORCH-0847 Phase C.",
  );
}

// Check 2 — no consumer-source imports remain
const SCAN_ROOTS = [
  join(ROOT, "app-mobile/src"),
  join(ROOT, "app-mobile/app"),
];

const IMPORT_REGEX = /\bTicketClaimConfirmModal\b/;

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...walk(p));
    } else if (/\.(tsx?|jsx?)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const files = [...SCAN_ROOTS.flatMap(walk)];

for (const f of files) {
  let src;
  try {
    src = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  // Skip a residual comment-only reference (e.g., "replaces TicketClaimConfirmModal")
  // — accept ONLY if it's inside a comment line. Strict gate: any non-comment
  // mention is a violation.
  // Quick heuristic: strip block + line comments and re-scan.
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  if (IMPORT_REGEX.test(stripped)) {
    note(
      relative(ROOT, f),
      "Contains a non-comment reference to `TicketClaimConfirmModal` — remove the import / usage. The component is deleted per ORCH-0847 Phase C.",
    );
  }
}

if (violations.length > 0) {
  console.error(
    "\n[ORCH-0847 gate #4 — ticket-claim-confirm-modal-removed] VIOLATIONS:\n",
  );
  for (const v of violations) {
    console.error(`  • ${v.file}\n    ${v.msg}\n`);
  }
  console.error(
    "Per ORCH-0847 SPEC §9 Gate 4 — the deleted modal stays deleted.",
  );
  process.exit(1);
}

console.log(
  "[ORCH-0847 gate #4 — ticket-claim-confirm-modal-removed] PASS — TicketClaimConfirmModal.tsx is gone and no source code imports it.",
);
process.exit(0);
