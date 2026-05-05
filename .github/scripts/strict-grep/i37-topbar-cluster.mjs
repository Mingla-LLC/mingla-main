#!/usr/bin/env node
/**
 * I-37 strict-grep gate — TopBar primary-tab default cluster enforcement.
 *
 * Gate logic:
 *   For every <TopBar> JSX element in mingla-business/app/ + mingla-business/src/:
 *     If leftKind="brand" AND rightSlot= prop is present → VIOLATION (exit 1)
 *     Unless line immediately above has:
 *       // orch-strict-grep-allow leftKind-brand-rightSlot — <reason>
 *
 * Per DEC-101 D-17b-5 (Cycle 17b) — registry pattern. See
 * .github/scripts/strict-grep/README.md for "How to add a new gate".
 *
 * Exit codes:
 *   0 — no violations (clean)
 *   1 — at least one violation
 *   2 — script error (parse failure across all files, file system error)
 *
 * Established by: Cycle 17b SPEC §D.2 + INVARIANT_REGISTRY I-37.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import * as parser from "@babel/parser";
import _traverse from "@babel/traverse";

const traverse = _traverse.default ?? _traverse;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Repo root is two levels up from .github/scripts/strict-grep/
const REPO_ROOT = join(__dirname, "..", "..", "..");

const SCAN_DIRS = [
  join(REPO_ROOT, "mingla-business", "app"),
  join(REPO_ROOT, "mingla-business", "src"),
];

const ALLOWLIST_TAG = "orch-strict-grep-allow leftKind-brand-rightSlot";

let violations = 0;
let warnings = 0;
let filesScanned = 0;
let parseFailures = 0;

/**
 * Recursively walk a directory and yield every .tsx file path.
 */
function* walkTsx(dir) {
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
      // Skip node_modules and other heavy dirs defensively
      if (entry === "node_modules" || entry === ".git" || entry === ".expo") {
        continue;
      }
      yield* walkTsx(full);
    } else if (st.isFile() && entry.endsWith(".tsx")) {
      yield full;
    }
  }
}

/**
 * Check whether the line immediately above the given line number contains
 * the allowlist tag. Source = full file text split by newline.
 */
function hasAllowlistAbove(sourceLines, lineNumber1Based) {
  // lineNumber1Based is the line of the <TopBar... opening
  // The "line immediately above" is lineNumber1Based - 1 (convert to 0-based: -2)
  const idx = lineNumber1Based - 2;
  if (idx < 0 || idx >= sourceLines.length) return false;
  const above = sourceLines[idx];
  // Allowlist must be a comment line (// or * within JSDoc) and contain the tag
  // We accept either:
  //   // orch-strict-grep-allow leftKind-brand-rightSlot — <reason>
  //   * orch-strict-grep-allow leftKind-brand-rightSlot — <reason>
  // The tag string is checked verbatim.
  return above.includes(ALLOWLIST_TAG);
}

/**
 * Extract the string-literal value of a JSXAttribute named `name`, or null
 * if the attribute is missing, dynamic (JSXExpressionContainer), or non-string.
 */
function getStringLiteralAttr(openingElement, name) {
  const attr = openingElement.attributes.find(
    (a) => a.type === "JSXAttribute" && a.name?.name === name
  );
  if (!attr) return { present: false, value: null, dynamic: false };
  if (!attr.value) return { present: true, value: null, dynamic: false };
  if (attr.value.type === "StringLiteral") {
    return { present: true, value: attr.value.value, dynamic: false };
  }
  // JSXExpressionContainer or other — dynamic
  return { present: true, value: null, dynamic: true };
}

/**
 * Check whether an attribute (by name) is present on the JSX opening element.
 * (Does not care about value.)
 */
function hasAttr(openingElement, name) {
  return openingElement.attributes.some(
    (a) => a.type === "JSXAttribute" && a.name?.name === name
  );
}

function reportViolation(filePath, line, suggestion) {
  const rel = relative(REPO_ROOT, filePath).split(sep).join("/");
  console.error(`ERROR: I-37 violation in ${rel}:${line}`);
  console.error(`  <TopBar leftKind="brand" ... rightSlot={...}>`);
  console.error(`    Primary-tab consumers (leftKind="brand") MUST NOT pass rightSlot=.`);
  console.error(`    Use extraRightSlot= to compose with the default [search, bell] cluster.`);
  console.error(`    See: Mingla_Artifacts/INVARIANT_REGISTRY.md I-37`);
  console.error(`    Allowlist: add // orch-strict-grep-allow leftKind-brand-rightSlot — <reason>`);
  console.error(`               immediately above the JSX block if the violation is intentional.`);
  if (suggestion) console.error(`    Suggestion: ${suggestion}`);
  console.error("");
  violations += 1;
}

function reportWarning(filePath, line, message) {
  const rel = relative(REPO_ROOT, filePath).split(sep).join("/");
  console.warn(`WARN: ${rel}:${line} — ${message}`);
  warnings += 1;
}

function reportParseFailure(filePath, err) {
  const rel = relative(REPO_ROOT, filePath).split(sep).join("/");
  console.error(`PARSE-FAIL: ${rel} — ${err.message}`);
  parseFailures += 1;
}

function scanFile(filePath) {
  filesScanned += 1;
  let source;
  try {
    source = readFileSync(filePath, "utf8");
  } catch (err) {
    reportParseFailure(filePath, err);
    return;
  }

  let ast;
  try {
    ast = parser.parse(source, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
    });
  } catch (err) {
    reportParseFailure(filePath, err);
    return;
  }

  const sourceLines = source.split("\n");

  traverse(ast, {
    JSXOpeningElement(path) {
      const node = path.node;
      if (node.name?.type !== "JSXIdentifier") return;
      if (node.name.name !== "TopBar") return;

      const leftKind = getStringLiteralAttr(node, "leftKind");
      const rightSlotPresent = hasAttr(node, "rightSlot");

      // No leftKind attribute or non-string-literal value → can't statically verify
      if (!leftKind.present) return;

      if (leftKind.dynamic) {
        // Warn but don't fail — gate is static-only
        reportWarning(
          filePath,
          node.loc?.start?.line ?? 0,
          `<TopBar leftKind={dynamic}> — gate cannot statically verify; review manually.`
        );
        return;
      }

      // Only enforce for leftKind="brand"
      if (leftKind.value !== "brand") return;

      // No rightSlot prop → no violation possible
      if (!rightSlotPresent) return;

      // VIOLATION candidate — check allowlist
      const line = node.loc?.start?.line ?? 0;
      if (hasAllowlistAbove(sourceLines, line)) {
        // Allowlisted — skip silently
        return;
      }

      reportViolation(
        filePath,
        line,
        "Replace `rightSlot=` with `extraRightSlot=` to compose with the default cluster."
      );
    },
  });
}

// Main
let scanError = null;
try {
  for (const dir of SCAN_DIRS) {
    for (const file of walkTsx(dir)) {
      scanFile(file);
    }
  }
} catch (err) {
  scanError = err;
  console.error(`SCRIPT ERROR: ${err.message}`);
  process.exit(2);
}

console.error("");
console.error(
  `I-37 gate: scanned ${filesScanned} .tsx files · ${violations} violations · ${warnings} warnings · ${parseFailures} parse failures`
);

if (parseFailures > 0 && filesScanned === parseFailures) {
  // All files failed to parse — script is broken
  process.exit(2);
}

if (violations > 0) {
  process.exit(1);
}

process.exit(0);
