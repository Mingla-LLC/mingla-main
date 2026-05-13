#!/usr/bin/env node

/**
 * I-ARI-NO-OKLCH (ORCH-0821 invariant)
 *
 * Bans `oklch(`, `color-mix(`, and `lab(` color-function syntax in the Ari
 * mobile surface. React Native's `@react-native/normalize-colors` silently
 * rejects these — they render transparent on iOS+Android and invisible
 * under dark overlays on web Chrome (Cycle 7 FX2 incident).
 *
 * Ari MUST use HSL / hex / rgb only.
 *
 * Scope: mingla-business/src/components/ari/, mingla-business/src/screens/ari/
 *
 * Self-test: this script is allowed to mention the forbidden tokens in its
 * own filename/comments — the scan target is the Ari source only.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const TARGET_DIRS = [
  "mingla-business/src/components/ari",
  "mingla-business/src/screens/ari",
];

const FORBIDDEN_PATTERNS = [
  { name: "oklch(", regex: /oklch\s*\(/i },
  { name: "color-mix(", regex: /color-mix\s*\(/i },
  { name: "lab(", regex: /\blab\s*\(/i },
];

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
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

const violations = [];
let filesScanned = 0;

for (const rel of TARGET_DIRS) {
  const abs = path.join(repoRoot, rel);
  for (const file of walk(abs)) {
    filesScanned++;
    const source = fs.readFileSync(file, "utf8");
    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const { name, regex } of FORBIDDEN_PATTERNS) {
        if (regex.test(line)) {
          violations.push({
            file: path.relative(repoRoot, file),
            line: index + 1,
            pattern: name,
            text: line.trim(),
          });
        }
      }
    });
  }
}

if (violations.length > 0) {
  console.error(
    "I-ARI-NO-OKLCH violation: Ari surface must use HSL/hex/rgb only.",
  );
  console.error(
    "Fix: replace oklch()/color-mix()/lab() with hsl() or hex.",
  );
  console.error(
    "Cross-reference: ARI_DESIGN.md §13.3, feedback_rn_color_formats.md (Cycle 7 FX2).",
  );
  console.error("");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.pattern}]  ${v.text}`);
  }
  console.error("");
  console.error(
    `Scanned ${filesScanned} files in ${TARGET_DIRS.join(", ")}; found ${violations.length} violation(s).`,
  );
  process.exit(1);
}

console.log(
  `I-ARI-NO-OKLCH OK: scanned ${filesScanned} file(s) in ${TARGET_DIRS.join(", ")}; no oklch/color-mix/lab color functions found.`,
);
process.exit(0);
