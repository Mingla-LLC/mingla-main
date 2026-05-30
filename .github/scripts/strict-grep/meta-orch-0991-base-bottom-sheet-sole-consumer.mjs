#!/usr/bin/env node

/**
 * I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER (META-ORCH-0991 Wave A)
 *
 * After Wave A, the ONLY non-test file under `app-mobile/src/` permitted to
 * IMPORT from `@gorhom/bottom-sheet` is the shared primitive
 * `app-mobile/src/components/ui/BaseBottomSheet.tsx`. Every other sheet surface
 * consumes the primitive. New hand-rolled gorhom usage is forbidden — it would
 * re-fragment the sheet stack the primitive exists to unify.
 *
 * CRITICAL discrimination (orchestrator REVIEW 2026-05-29 / DESIGN §9.3): the
 * gate matches `import ... from '@gorhom/bottom-sheet'` IMPORT STATEMENTS only,
 * NOT bare string mentions. `MessageInterface.tsx` and `designSystem.ts` (and
 * NotificationsSheet.tsx) contain the literal `@gorhom/bottom-sheet` only inside
 * COMMENTS and must NOT trip the gate. The structural test file
 * `components/__tests__/NotificationsSheet.test.tsx` is EXEMPT (it reads the
 * BaseBottomSheet source as a string to assert the gorhom import lives there).
 *
 * Self-test: run with `--self-test` to assert the gate flags a synthetic
 * offender (positive fixture) and passes a comment-only / allowed file (negative
 * fixtures), proving the import-vs-comment discrimination.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const TARGET_DIR = "app-mobile/src";
const SOLE_CONSUMER = "app-mobile/src/components/ui/BaseBottomSheet.tsx";
// Test files that legitimately reference the gorhom string as data, not code.
const EXEMPT_FILES = new Set([
  "app-mobile/src/components/__tests__/NotificationsSheet.test.tsx",
]);

// Matches an ES import statement that pulls from '@gorhom/bottom-sheet'.
// Covers: `import X from '...'`, `import { a, b } from '...'`,
// `import X, { a } from '...'`, `import * as X from '...'`, and the
// `import type { ... } from '...'` form — across multiple lines. Does NOT match
// the bare string inside a `// comment` or `/* block */` because the regex
// requires a leading `import` keyword binding to the module specifier.
const IMPORT_REGEX =
  /^\s*import\b[\s\S]*?from\s+['"]@gorhom\/bottom-sheet['"]/m;

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      yield* walk(full);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
    ) {
      yield full;
    }
  }
}

/**
 * Returns true if `source` contains an actual `import ... from
 * '@gorhom/bottom-sheet'` statement, ignoring line-comments and block-comments.
 */
function hasGorhomImport(source) {
  // Strip block comments and line comments so a commented-out import or a prose
  // mention of the module specifier cannot trip the gate.
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  return IMPORT_REGEX.test(stripped);
}

function scanRepo() {
  const offenders = [];
  let filesScanned = 0;
  const absTarget = path.join(repoRoot, TARGET_DIR);
  for (const file of walk(absTarget)) {
    const rel = path.relative(repoRoot, file);
    if (EXEMPT_FILES.has(rel)) continue;
    filesScanned += 1;
    const source = fs.readFileSync(file, "utf8");
    if (hasGorhomImport(source) && rel !== SOLE_CONSUMER) {
      offenders.push(rel);
    }
  }
  return { offenders, filesScanned };
}

// ── Self-test mode ───────────────────────────────────────────────────────────
if (process.argv.includes("--self-test")) {
  let failed = 0;
  const check = (name, cond) => {
    if (cond) {
      console.log(`OK   [self-test] ${name}`);
    } else {
      failed += 1;
      console.error(`FAIL [self-test] ${name}`);
    }
  };

  // Positive fixture: a real import statement MUST be detected.
  check(
    "detects single-line named import",
    hasGorhomImport(
      `import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';`,
    ),
  );
  check(
    "detects multi-line named import",
    hasGorhomImport(
      `import {\n  BottomSheetBackdrop,\n  BottomSheetSectionList,\n} from "@gorhom/bottom-sheet";`,
    ),
  );
  check(
    "detects import type form",
    hasGorhomImport(
      `import type { BottomSheetProps } from '@gorhom/bottom-sheet';`,
    ),
  );

  // Negative fixtures: comment-only mentions MUST NOT trip the gate.
  check(
    "ignores line-comment mention",
    !hasGorhomImport(`// wraps @gorhom/bottom-sheet v5 (NOT RN Modal)`),
  );
  check(
    "ignores block-comment mention",
    !hasGorhomImport(`/* canonical for all @gorhom/bottom-sheet instances */`),
  );
  check(
    "ignores commented-out import",
    !hasGorhomImport(`// import BottomSheet from '@gorhom/bottom-sheet';`),
  );
  check(
    "ignores prose string mention",
    !hasGorhomImport(`const note = "uses @gorhom/bottom-sheet under the hood";`),
  );

  // Live repo invariant: BaseBottomSheet is the sole importer right now.
  const { offenders } = scanRepo();
  check(
    `sole consumer holds in live tree (offenders: ${offenders.join(", ") || "none"})`,
    offenders.length === 0,
  );

  if (failed > 0) {
    console.error(`\nSelf-test FAILED with ${failed} failure(s).`);
    process.exit(1);
  }
  console.log("\nSelf-test passed: import-vs-comment discrimination correct.");
  process.exit(0);
}

// ── Normal scan mode ─────────────────────────────────────────────────────────
const { offenders, filesScanned } = scanRepo();

if (offenders.length > 0) {
  console.error(
    "I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER violation:",
  );
  console.error(
    `Only ${SOLE_CONSUMER} may import @gorhom/bottom-sheet. Consume BaseBottomSheet instead.`,
  );
  console.error("");
  for (const f of offenders) {
    console.error(`  ${f}  imports @gorhom/bottom-sheet directly`);
  }
  console.error("");
  console.error(
    `Scanned ${filesScanned} file(s) under ${TARGET_DIR}; found ${offenders.length} offender(s).`,
  );
  process.exit(1);
}

console.log(
  `I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER OK: scanned ${filesScanned} file(s) under ${TARGET_DIR}; ${SOLE_CONSUMER} is the sole @gorhom/bottom-sheet importer.`,
);
process.exit(0);
