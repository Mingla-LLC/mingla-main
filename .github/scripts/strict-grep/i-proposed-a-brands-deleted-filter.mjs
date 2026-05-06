#!/usr/bin/env node
/**
 * I-PROPOSED-A strict-grep gate — every brands query MUST filter deleted_at IS NULL.
 *
 * Gate logic:
 *   For every `from("brands")` call expression in mingla-business/src/services/
 *   + mingla-business/src/hooks/ that READS (.select chain — not .insert/.update/.upsert):
 *     If the chain does NOT include a `.is("deleted_at", null)` call → VIOLATION (exit 1)
 *     Unless line immediately above has:
 *       // orch-strict-grep-allow brands-deleted-filter — <reason>
 *
 * Per Cycle 17e-A SPEC §5.2 + INVARIANT_REGISTRY I-PROPOSED-A — registry pattern.
 * See .github/scripts/strict-grep/README.md for "How to add a new gate".
 *
 * Scope (per invariant): src/services/ + src/hooks/ ONLY. App layer + components
 * consume via hooks/services so re-checking there is redundant. Production code
 * outside scope is presumed compliant.
 *
 * Read detection: chain includes `.select(...)` and not `.insert(`/`.update(`/
 * `.upsert(`/`.delete(` (writes don't need the filter — RLS handles).
 *
 * Exit codes:
 *   0 — no violations (clean)
 *   1 — at least one violation
 *   2 — script error (parse failure across all files, file system error)
 *
 * Established by: Cycle 17e-A SPEC §5.2 + DEC-109 [DEC ID confirmed at CLOSE].
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
  join(REPO_ROOT, "mingla-business", "src", "services"),
  join(REPO_ROOT, "mingla-business", "src", "hooks"),
];

const ALLOWLIST_TAG = "orch-strict-grep-allow brands-deleted-filter";

let violations = 0;
let filesScanned = 0;
let parseFailures = 0;

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

function hasAllowlistAbove(sourceLines, lineNumber1Based) {
  const idx = lineNumber1Based - 2;
  if (idx < 0 || idx >= sourceLines.length) return false;
  return sourceLines[idx].includes(ALLOWLIST_TAG);
}

function reportViolation(filePath, line) {
  const rel = relative(REPO_ROOT, filePath).split(sep).join("/");
  console.error(`ERROR: I-PROPOSED-A violation in ${rel}:${line}`);
  console.error(
    `  supabase.from("brands").select(...) without .is("deleted_at", null)`,
  );
  console.error(
    `    Every read of brands table MUST filter deleted_at IS NULL`,
  );
  console.error(
    `    Otherwise soft-deleted brands surface to operator UI.`,
  );
  console.error(
    `    Fix: add .is("deleted_at", null) to the chain before .select() / .single() / .maybeSingle()`,
  );
  console.error(
    `    Allowlist: add // orch-strict-grep-allow brands-deleted-filter — <reason>`,
  );
  console.error(`               immediately above the call expression.`);
  console.error(
    `    See: Mingla_Artifacts/INVARIANT_REGISTRY.md I-PROPOSED-A`,
  );
  console.error("");
  violations += 1;
}

function reportParseFailure(filePath, err) {
  const rel = relative(REPO_ROOT, filePath).split(sep).join("/");
  console.error(`PARSE-FAIL: ${rel} — ${err.message}`);
  parseFailures += 1;
}

/**
 * Walk a method-call chain bottom-up (e.g., for `a.from("brands").select().eq(...)
 * .is("deleted_at", null)` — the AST is nested CallExpressions where the outermost
 * is .is(). Climb via `path.parentPath.parentPath` (CallExpression → MemberExpression
 * → CallExpression).
 *
 * Returns the root CallExpression of the chain (highest ancestor that is a
 * MemberExpression-CallExpression chain rooted in the from("brands") call).
 */
function findChainRoot(callExpressionPath) {
  let cur = callExpressionPath;
  // Walk up while the parent is a MemberExpression whose object is the current
  // CallExpression (chain continuation pattern).
  while (
    cur.parent?.type === "MemberExpression" &&
    cur.parent.object === cur.node &&
    cur.parentPath?.parentPath?.node?.type === "CallExpression"
  ) {
    cur = cur.parentPath.parentPath; // jump to enclosing CallExpression
  }
  return cur;
}

/**
 * Walk a chain CallExpression and collect all method names invoked
 * (e.g., ["from", "select", "eq", "is"]).
 */
function collectChainMethods(rootCallExpressionPath) {
  const methods = [];
  let cur = rootCallExpressionPath.node;
  // Descend object chain until we hit something that isn't CallExpression.MemberExpression
  while (cur && cur.type === "CallExpression") {
    if (cur.callee?.type === "MemberExpression" && cur.callee.property?.name) {
      methods.unshift(cur.callee.property.name);
      cur = cur.callee.object;
    } else {
      break;
    }
  }
  return methods;
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
    CallExpression(path) {
      const node = path.node;
      // Match: <something>.from("brands")
      if (
        node.callee?.type !== "MemberExpression" ||
        node.callee.property?.name !== "from"
      ) {
        return;
      }
      const firstArg = node.arguments[0];
      if (
        !firstArg ||
        firstArg.type !== "StringLiteral" ||
        firstArg.value !== "brands"
      ) {
        return;
      }

      // Found a from("brands") call — climb to chain root
      const root = findChainRoot(path);
      const methods = collectChainMethods(root);

      // Read detection: only check chains that include `.select(...)`. Writes
      // (.insert / .update / .upsert / .delete) are RLS-enforced; this gate is
      // about read-time filtering.
      if (!methods.includes("select")) return;

      // Skip pure write paths (.update().select() chains DO read but are
      // writes overall — they read the row that was just written, which is
      // by definition not soft-deleted IF .is("deleted_at", null) is upstream
      // of the .update(). For simplicity, we skip chains that include update/
      // insert/upsert/delete since those are services we trust).
      if (
        methods.includes("update") ||
        methods.includes("insert") ||
        methods.includes("upsert") ||
        methods.includes("delete")
      ) {
        return;
      }

      // Pure read — must include .is("deleted_at", null)
      const hasIsDeletedAtNull = chainHasIsDeletedAtNull(root.node);
      if (hasIsDeletedAtNull) return;

      // Violation candidate — check allowlist on the line of the from() call
      const line = node.loc?.start?.line ?? 0;
      if (hasAllowlistAbove(sourceLines, line)) return;

      reportViolation(filePath, line);
    },
  });
}

/**
 * Walk a CallExpression tree to detect any `.is("deleted_at", null)` call.
 * Scans the entire chain depth-first.
 */
function chainHasIsDeletedAtNull(node) {
  if (!node || node.type !== "CallExpression") return false;
  if (
    node.callee?.type === "MemberExpression" &&
    node.callee.property?.name === "is" &&
    node.arguments.length >= 2 &&
    node.arguments[0].type === "StringLiteral" &&
    node.arguments[0].value === "deleted_at" &&
    node.arguments[1].type === "NullLiteral"
  ) {
    return true;
  }
  // Recurse into the chain — the outer CallExpression's callee.object is the
  // previous CallExpression in the chain.
  if (node.callee?.type === "MemberExpression") {
    return chainHasIsDeletedAtNull(node.callee.object);
  }
  return false;
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
  `I-PROPOSED-A gate: scanned ${filesScanned} .ts/.tsx files · ${violations} violations · ${parseFailures} parse failures`,
);

if (parseFailures > 0 && filesScanned === parseFailures) {
  process.exit(2);
}
if (violations > 0) {
  process.exit(1);
}
process.exit(0);
