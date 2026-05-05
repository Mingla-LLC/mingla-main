#!/usr/bin/env node
/**
 * I-38 strict-grep gate — IconChrome touch-target ≥ 44 effective area.
 *
 * Gate logic:
 *   For every <IconChrome> JSX element in mingla-business/app/ + mingla-business/src/:
 *     Compute effective per-side touch extent = size_or_default + hitSlop_side
 *     If any side < 44 → VIOLATION (exit 1)
 *     Unless line immediately above has:
 *       // orch-strict-grep-allow icon-chrome-touch-target — <reason>
 *
 * Per Cycle 17c §G + INVARIANT_REGISTRY I-38 — registry pattern. See
 * .github/scripts/strict-grep/README.md for "How to add a new gate".
 *
 * Default size matches IconChrome primitive (DEFAULT_SIZE = 36).
 * Default hitSlop matches IconChrome primitive (DEFAULT_HIT_SLOP = 4 per side
 * → effective 36 + 4×2 = 44 per side, AA floor).
 *
 * Exit codes:
 *   0 — no violations (clean)
 *   1 — at least one violation
 *   2 — script error (parse failure across all files, file system error)
 *
 * Established by: Cycle 17c SPEC §G + INVARIANT_REGISTRY I-38.
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

const ALLOWLIST_TAG = "orch-strict-grep-allow icon-chrome-touch-target";

const DEFAULT_ICON_CHROME_SIZE = 36;
const DEFAULT_HIT_SLOP_PER_SIDE = 4;
const WCAG_AA_TOUCH_TARGET = 44;

let violations = 0;
let warnings = 0;
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

/**
 * Extract the numeric value of a JSXAttribute named `name`.
 * Returns { present, value (number|null), dynamic }.
 *   - { present: false, value: null, dynamic: false } — attr absent
 *   - { present: true, value: <num>, dynamic: false } — JSXExpressionContainer wrapping NumericLiteral
 *   - { present: true, value: null, dynamic: true } — anything else (variable, fn call, etc.)
 */
function getNumericAttr(openingElement, name) {
  const attr = openingElement.attributes.find(
    (a) => a.type === "JSXAttribute" && a.name?.name === name
  );
  if (!attr) return { present: false, value: null, dynamic: false };
  if (!attr.value) return { present: true, value: null, dynamic: true };
  if (
    attr.value.type === "JSXExpressionContainer" &&
    attr.value.expression?.type === "NumericLiteral"
  ) {
    return { present: true, value: attr.value.expression.value, dynamic: false };
  }
  return { present: true, value: null, dynamic: true };
}

/**
 * Parse a hitSlop= JSX attribute. RN accepts:
 *   - hitSlop={N} — uniform numeric (all 4 sides = N)
 *   - hitSlop={{top:N, bottom:N, left:N, right:N}} — per-side object
 *   - hitSlop={someExpression} — dynamic (cannot statically verify)
 *
 * Returns:
 *   - null when attribute is absent (caller falls back to primitive default)
 *   - { dynamic: true } when expression is non-static
 *   - { top, bottom, left, right } numbers otherwise (missing keys default to 0)
 */
function parseHitSlopAttr(openingElement) {
  const attr = openingElement.attributes.find(
    (a) => a.type === "JSXAttribute" && a.name?.name === "hitSlop"
  );
  if (!attr) return null;
  if (!attr.value || attr.value.type !== "JSXExpressionContainer") {
    return { dynamic: true };
  }
  const expr = attr.value.expression;
  if (expr.type === "NumericLiteral") {
    return {
      top: expr.value,
      bottom: expr.value,
      left: expr.value,
      right: expr.value,
    };
  }
  if (expr.type === "ObjectExpression") {
    const result = { top: 0, bottom: 0, left: 0, right: 0 };
    let allStatic = true;
    for (const prop of expr.properties) {
      if (prop.type !== "ObjectProperty") {
        allStatic = false;
        break;
      }
      const key = prop.key?.name ?? prop.key?.value;
      if (key !== "top" && key !== "bottom" && key !== "left" && key !== "right") continue;
      if (prop.value?.type !== "NumericLiteral") {
        allStatic = false;
        break;
      }
      result[key] = prop.value.value;
    }
    if (!allStatic) return { dynamic: true };
    return result;
  }
  // Identifier / CallExpression / MemberExpression / etc. → dynamic
  return { dynamic: true };
}

function reportViolation(filePath, line, dims, sizeValue, hitSlopValue) {
  const rel = relative(REPO_ROOT, filePath).split(sep).join("/");
  console.error(`ERROR: I-38 violation in ${rel}:${line}`);
  console.error(`  <IconChrome size={${sizeValue}} hitSlop={${JSON.stringify(hitSlopValue)}} ...>`);
  console.error(`    Effective touch area: ${dims.width}×${dims.height}pt`);
  console.error(`    Minimum dimension ${Math.min(dims.width, dims.height)} < ${WCAG_AA_TOUCH_TARGET} (WCAG AA / Apple HIG floor).`);
  console.error(`    Set size>=44 OR hitSlop summing to >=8 on each axis (so size + slop_left + slop_right >= 44 AND size + slop_top + slop_bottom >= 44).`);
  console.error(`    See: Mingla_Artifacts/INVARIANT_REGISTRY.md I-38`);
  console.error(`    Allowlist: add // orch-strict-grep-allow icon-chrome-touch-target — <reason>`);
  console.error(`               immediately above the JSX block if intentional.`);
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
      if (node.name.name !== "IconChrome") return;

      const line = node.loc?.start?.line ?? 0;

      const sizeAttr = getNumericAttr(node, "size");
      const hitSlopAttr = parseHitSlopAttr(node);

      if (sizeAttr.dynamic) {
        reportWarning(
          filePath,
          line,
          `<IconChrome size={dynamic}> — gate cannot statically verify; review manually.`,
        );
        return;
      }

      const size = sizeAttr.present ? sizeAttr.value : DEFAULT_ICON_CHROME_SIZE;

      if (hitSlopAttr !== null && hitSlopAttr.dynamic) {
        reportWarning(
          filePath,
          line,
          `<IconChrome hitSlop={dynamic}> — gate cannot statically verify; review manually.`,
        );
        return;
      }

      // If hitSlop is absent, the primitive's baked-in default applies (per Cycle 17c §A.1).
      const slop = hitSlopAttr ?? {
        top: DEFAULT_HIT_SLOP_PER_SIDE,
        bottom: DEFAULT_HIT_SLOP_PER_SIDE,
        left: DEFAULT_HIT_SLOP_PER_SIDE,
        right: DEFAULT_HIT_SLOP_PER_SIDE,
      };

      // Total touchable dimensions = visual size + sum of opposing slop.
      // For 36+4+4 default = 44×44 → AA floor met.
      const dims = {
        width: size + slop.left + slop.right,
        height: size + slop.top + slop.bottom,
      };

      if (dims.width >= WCAG_AA_TOUCH_TARGET && dims.height >= WCAG_AA_TOUCH_TARGET) return;

      // VIOLATION candidate — check allowlist
      if (hasAllowlistAbove(sourceLines, line)) {
        return;
      }

      reportViolation(filePath, line, dims, size, slop);
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
  `I-38 gate: scanned ${filesScanned} .tsx files · ${violations} violations · ${warnings} warnings · ${parseFailures} parse failures`
);

if (parseFailures > 0 && filesScanned === parseFailures) {
  process.exit(2);
}

if (violations > 0) {
  process.exit(1);
}

process.exit(0);
