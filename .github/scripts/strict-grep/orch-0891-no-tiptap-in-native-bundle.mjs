#!/usr/bin/env node

/**
 * I-TIPTAP-WEB-ONLY (ORCH-0891 invariant).
 *
 * Files importing `@tiptap/*` MUST live under `*.web.tsx` / `*.web.ts`
 * extension OR inside a `Platform.OS === "web"`-gated dynamic import.
 * Native bundles must never resolve `@tiptap/*` because Tiptap is a
 * web-only library; bundling it on iOS/Android would (a) bloat the
 * mobile bundle by ~110 KB unnecessarily, (b) potentially trigger
 * SSR-style window/document evaluation crashes since Tiptap depends on
 * DOM APIs at module-load.
 *
 * Scope: mingla-business/src/**\/*.ts and mingla-business/src/**\/*.tsx
 *   EXCLUDING any file matching `*.web.ts` or `*.web.tsx`.
 *
 * Cross-references:
 *   - SPEC_ORCH-0891 §5 (new invariants)
 *   - INVESTIGATION_ORCH-0891 §6 (new invariants proposed)
 *   - feedback_strict_grep_registry_pattern.md (one script + one job)
 *
 * Parallels existing precedent: `orch-0778-web-stripe-native-import-gate`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const TARGET_ROOT = "mingla-business/src";

const FORBIDDEN_IMPORT = /from\s+["']@tiptap\//;

// Allow-list: files that are platform-split via the `.tsx + .native.ts`
// convention (Metro picks `.native.ts` on iOS/Android, falls through to
// `.tsx` on web). These files ARE web-only by virtue of the sibling
// native override, even though they lack the explicit `.web.tsx` suffix.
//
// Verification at gate time: the file's directory MUST contain a
// `<basename>.native.ts` or `<basename>.native.tsx` sibling — otherwise
// the file is NOT platform-split and the gate flags it.
const ALLOW_LIST_PAIRED = new Set([
  "mingla-business/src/components/marketing/ComposerV2/richEditor.tsx",
]);

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
    } else if (entry.isFile()) {
      // Native + shared files only — skip `.web.tsx` and `.web.ts`.
      if (entry.name.endsWith(".web.tsx") || entry.name.endsWith(".web.ts")) continue;
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
      yield full;
    }
  }
}

const violations = [];
let filesScanned = 0;

const targetAbs = path.join(repoRoot, TARGET_ROOT);
for (const file of walk(targetAbs)) {
  const rel = path.relative(repoRoot, file);

  // Allow-list pass: if file is paired with a `.native.ts(x)` sibling AND
  // appears in ALLOW_LIST_PAIRED, the import is treated as platform-split.
  // Verify the sibling exists; otherwise the allow-list entry is stale.
  if (ALLOW_LIST_PAIRED.has(rel)) {
    const dir = path.dirname(file);
    const base = path.basename(file, path.extname(file));
    const nativeSibling = path.join(dir, `${base}.native.ts`);
    const nativeSiblingTsx = path.join(dir, `${base}.native.tsx`);
    if (!fs.existsSync(nativeSibling) && !fs.existsSync(nativeSiblingTsx)) {
      console.error(
        `ORCH-0891 allow-list entry ${rel} declared paired but no ${base}.native.ts(x) sibling found — allow-list entry is stale.`,
      );
      process.exit(1);
    }
    filesScanned++;
    continue;
  }

  filesScanned++;
  const source = fs.readFileSync(file, "utf8");
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (FORBIDDEN_IMPORT.test(line)) {
      violations.push({
        file: rel,
        line: index + 1,
        text: line.trim(),
      });
    }
  });
}

if (violations.length > 0) {
  console.error("I-TIPTAP-WEB-ONLY violation (ORCH-0891):");
  console.error(
    "  `@tiptap/*` imports found OUTSIDE `*.web.tsx`/`*.web.ts` files.",
  );
  console.error(
    "  Tiptap is a web-only library; native bundles must never resolve it.",
  );
  console.error(
    "  Fix: rename the file with the `.web.tsx` / `.web.ts` extension OR",
  );
  console.error(
    "       wrap the import inside a `Platform.OS === 'web'`-gated dynamic import().",
  );
  console.error("");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.text}`);
  }
  console.error("");
  console.error(
    `Scanned ${filesScanned} file(s) under ${TARGET_ROOT} (excluding *.web.*); found ${violations.length} violation(s).`,
  );
  process.exit(1);
}

console.log(
  `ORCH-0891 I-TIPTAP-WEB-ONLY OK: scanned ${filesScanned} non-web file(s) under ${TARGET_ROOT}; no @tiptap/* imports found.`,
);
process.exit(0);
