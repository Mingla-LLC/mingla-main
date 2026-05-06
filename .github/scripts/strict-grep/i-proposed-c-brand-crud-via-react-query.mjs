#!/usr/bin/env node
/**
 * I-PROPOSED-C strict-grep gate — no setBrands() callers in mingla-business/src/.
 *
 * Gate logic:
 *   For every .ts / .tsx file in mingla-business/src/ + mingla-business/app/:
 *     If line matches `\bsetBrands\s*\(` → VIOLATION (exit 1)
 *     Unless line immediately above has:
 *       // orch-strict-grep-allow setBrands-call — <reason>
 *
 * Per Cycle 17e-A SPEC §5.2 + INVARIANT_REGISTRY I-PROPOSED-C — registry pattern.
 * Brand list state is owned by React Query (useBrands hook) per Const #5;
 * Zustand `setBrands` action was removed at Cycle 17e-A. CI gate prevents
 * future engineers from re-introducing parallel Zustand-side cache that
 * diverges from React Query truth.
 *
 * Regex-based (NOT AST-based): `setBrands\(` is unambiguous — no function
 * call by that name exists outside the deprecated Zustand action.
 *
 * Exit codes:
 *   0 — no violations (clean)
 *   1 — at least one violation
 *   2 — script error (file system error)
 *
 * Established by: Cycle 17e-A SPEC §5.2 + DEC-109 [DEC ID confirmed at CLOSE].
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const SCAN_DIRS = [
  join(REPO_ROOT, "mingla-business", "app"),
  join(REPO_ROOT, "mingla-business", "src"),
];

const ALLOWLIST_TAG = "orch-strict-grep-allow setBrands-call";

// Regex matches `setBrands(` — word-boundary so `unsetBrands(` doesn't false-match
const SETBRANDS_REGEX = /\bsetBrands\s*\(/;

let violations = 0;
let filesScanned = 0;
let readFailures = 0;

function* walkTsTsx(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".git" || entry === ".expo") {
        continue;
      }
      yield* walkTsTsx(full);
    } else if (
      st.isFile() &&
      (entry.endsWith(".ts") || entry.endsWith(".tsx"))
    ) {
      yield full;
    }
  }
}

function reportViolation(filePath, lineNumber, lineText) {
  const rel = relative(REPO_ROOT, filePath).split(sep).join("/");
  console.error(`ERROR: I-PROPOSED-C violation in ${rel}:${lineNumber}`);
  console.error(`  ${lineText.trim()}`);
  console.error(
    `    Brand list state lives in React Query (useBrands hook), NOT Zustand setBrands.`,
  );
  console.error(
    `    Cycle 17e-A removed the setBrands action; this gate prevents re-introduction.`,
  );
  console.error(
    `    Fix: use useCreateBrand / useUpdateBrand / useSoftDeleteBrand mutations.`,
  );
  console.error(
    `    Allowlist: add // orch-strict-grep-allow setBrands-call — <reason>`,
  );
  console.error(`               immediately above the call site.`);
  console.error(
    `    See: Mingla_Artifacts/INVARIANT_REGISTRY.md I-PROPOSED-C`,
  );
  console.error("");
  violations += 1;
}

function scanFile(filePath) {
  filesScanned += 1;
  let source;
  try {
    source = readFileSync(filePath, "utf8");
  } catch (err) {
    const rel = relative(REPO_ROOT, filePath).split(sep).join("/");
    console.error(`READ-FAIL: ${rel} — ${err.message}`);
    readFailures += 1;
    return;
  }

  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!SETBRANDS_REGEX.test(line)) continue;
    // Skip comment-only lines (// or /* */ context)
    const trimmed = line.trim();
    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("/*")
    ) {
      continue;
    }
    // Check allowlist: line above
    if (i > 0 && lines[i - 1].includes(ALLOWLIST_TAG)) {
      continue;
    }
    reportViolation(filePath, i + 1, line);
  }
}

// Main
try {
  for (const dir of SCAN_DIRS) {
    for (const file of walkTsTsx(dir)) {
      scanFile(file);
    }
  }
} catch (err) {
  console.error(`SCRIPT ERROR: ${err.message}`);
  process.exit(2);
}

console.error("");
console.error(
  `I-PROPOSED-C gate: scanned ${filesScanned} .ts/.tsx files · ${violations} violations · ${readFailures} read failures`,
);

if (readFailures > 0 && filesScanned === readFailures) {
  process.exit(2);
}
if (violations > 0) {
  process.exit(1);
}
process.exit(0);
