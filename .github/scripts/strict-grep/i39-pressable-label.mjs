#!/usr/bin/env node
/**
 * I-39 strict-grep gate — Interactive Pressable accessibilityLabel coverage.
 *
 * Gate logic:
 *   For every <Pressable> or <TouchableOpacity> JSX element in
 *   mingla-business/app/ + mingla-business/src/:
 *     If onPress= is set (interactive) AND accessibilityLabel= is missing
 *     AND the only direct child is NOT a literal <Text>{string-literal}</Text>
 *     → VIOLATION (exit 1)
 *     Unless line immediately above has:
 *       // orch-strict-grep-allow pressable-no-label — <reason>
 *
 * Per Cycle 17c §H + INVARIANT_REGISTRY I-39 — registry pattern.
 *
 * Implicit-Text-child heuristic: a Pressable whose only non-whitespace
 * child is <Text>...</Text> with a string-literal or template-literal
 * inner content is treated as P2 implicit (logged INFO, not violated).
 *
 * Exit codes:
 *   0 — no violations (clean; implicit-Text fallbacks logged INFO)
 *   1 — at least one violation
 *   2 — script error (parse failure across all files, file system error)
 *
 * Established by: Cycle 17c SPEC §H + INVARIANT_REGISTRY I-39.
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
const REPO_ROOT = join(__dirname, "..", "..", "..");

const SCAN_DIRS = [
  join(REPO_ROOT, "mingla-business", "app"),
  join(REPO_ROOT, "mingla-business", "src"),
];

const ALLOWLIST_TAG = "orch-strict-grep-allow pressable-no-label";

const TARGET_NAMES = new Set(["Pressable", "TouchableOpacity"]);

let violations = 0;
let warnings = 0;
let implicitLabels = 0;
let filesScanned = 0;
let parseFailures = 0;

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
      if (entry === "node_modules" || entry === ".git" || entry === ".expo" || entry === "dist") {
        continue;
      }
      yield* walkTsx(full);
    } else if (st.isFile() && entry.endsWith(".tsx")) {
      yield full;
    }
  }
}

function hasAllowlistAbove(sourceLines, lineNumber1Based) {
  const idx = lineNumber1Based - 2;
  if (idx < 0 || idx >= sourceLines.length) return false;
  const above = sourceLines[idx];
  return above.includes(ALLOWLIST_TAG);
}

function hasAttr(openingElement, name) {
  return openingElement.attributes.some(
    (a) => a.type === "JSXAttribute" && a.name?.name === name
  );
}

/**
 * Determine whether a JSXElement's direct children consist only of a
 * <Text> element whose own only child is a string literal or template literal.
 * RN VoiceOver/TalkBack derive labels from inner Text in many cases, so this
 * counts as P2 implicit pass — logged INFO, not violated.
 */
function hasImplicitTextLabel(jsxElement) {
  const realChildren = (jsxElement.children ?? []).filter((c) =>
    !(c.type === "JSXText" && c.value.trim().length === 0)
  );
  if (realChildren.length !== 1) return false;
  const child = realChildren[0];
  if (child.type !== "JSXElement") return false;
  if (child.openingElement.name?.type !== "JSXIdentifier") return false;
  if (child.openingElement.name.name !== "Text") return false;
  const textRealChildren = (child.children ?? []).filter((c) =>
    !(c.type === "JSXText" && c.value.trim().length === 0)
  );
  if (textRealChildren.length !== 1) return false;
  const textChild = textRealChildren[0];
  if (textChild.type === "JSXText") return true; // raw literal
  if (textChild.type === "JSXExpressionContainer") {
    const expr = textChild.expression;
    if (!expr) return false;
    if (expr.type === "StringLiteral") return true;
    if (expr.type === "TemplateLiteral") return true;
    return false;
  }
  return false;
}

function reportViolation(filePath, line, elementName) {
  const rel = relative(REPO_ROOT, filePath).split(sep).join("/");
  console.error(`ERROR: I-39 violation in ${rel}:${line}`);
  console.error(`  <${elementName} onPress={...}> with no accessibilityLabel and no inner <Text> literal child.`);
  console.error(`    Add accessibilityLabel="..." to the element, OR allowlist with reason.`);
  console.error(`    See: Mingla_Artifacts/INVARIANT_REGISTRY.md I-39`);
  console.error(`    Allowlist: add // orch-strict-grep-allow pressable-no-label — <reason>`);
  console.error(`               immediately above the JSX block if intentional.`);
  console.error("");
  violations += 1;
}

function reportImplicit(filePath, line, elementName) {
  const rel = relative(REPO_ROOT, filePath).split(sep).join("/");
  console.error(`INFO: ${rel}:${line} — <${elementName} onPress={...}> uses implicit Text-derived label (P2). Explicit accessibilityLabel preferred for cross-platform consistency.`);
  implicitLabels += 1;
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
    JSXElement(path) {
      const opening = path.node.openingElement;
      if (opening.name?.type !== "JSXIdentifier") return;
      if (!TARGET_NAMES.has(opening.name.name)) return;

      // Interactive check: must have onPress=
      if (!hasAttr(opening, "onPress")) return;

      const line = opening.loc?.start?.line ?? 0;

      // Has explicit accessibilityLabel? → pass
      if (hasAttr(opening, "accessibilityLabel")) return;

      // Implicit Text-child label? → log INFO, pass
      if (hasImplicitTextLabel(path.node)) {
        reportImplicit(filePath, line, opening.name.name);
        return;
      }

      // VIOLATION candidate — check allowlist
      if (hasAllowlistAbove(sourceLines, line)) {
        return;
      }

      reportViolation(filePath, line, opening.name.name);
    },
  });
}

// Main
try {
  for (const dir of SCAN_DIRS) {
    for (const file of walkTsx(dir)) {
      scanFile(file);
    }
  }
} catch (err) {
  console.error(`SCRIPT ERROR: ${err.message}`);
  process.exit(2);
}

console.error("");
console.error(
  `I-39 gate: scanned ${filesScanned} .tsx files · ${violations} violations · ${implicitLabels} implicit-text labels (INFO) · ${warnings} warnings · ${parseFailures} parse failures`
);

if (parseFailures > 0 && filesScanned === parseFailures) {
  process.exit(2);
}

if (violations > 0) {
  process.exit(1);
}

process.exit(0);
