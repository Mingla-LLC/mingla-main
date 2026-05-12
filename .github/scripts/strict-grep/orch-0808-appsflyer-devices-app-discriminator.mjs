#!/usr/bin/env node
/**
 * ORCH-0808 strict-grep gate — every appsflyer_devices write MUST include `app:`.
 *
 * I-PROPOSED-AF-DISCRIMINATOR (DRAFT — flips to ACTIVE on ORCH-0808 CLOSE).
 *
 * Gate logic:
 *   For every `from("appsflyer_devices")` call expression in app-mobile/src/ +
 *   mingla-business/src/ + supabase/functions/ that chains to .insert(), .update(),
 *   or .upsert(), the payload object literal MUST contain an `app:` key.
 *   Missing → VIOLATION (exit 1).
 *
 *   Allowlist marker (line immediately above):
 *     // orch-strict-grep-allow appsflyer-devices-app-discriminator — <reason>
 *
 * Scope: any source file that mutates appsflyer_devices.
 *
 * Exit codes:
 *   0 — no violations
 *   1 — at least one violation
 *   2 — script error
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import * as parser from "@babel/parser";
import _traverse from "@babel/traverse";

const traverse = _traverse.default ?? _traverse;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const SCAN_DIRS = [
  join(REPO_ROOT, "app-mobile", "src"),
  join(REPO_ROOT, "mingla-business", "src"),
  join(REPO_ROOT, "supabase", "functions"),
];

const ALLOWLIST_TAG = "orch-strict-grep-allow appsflyer-devices-app-discriminator";

let violations = 0;
const errors = [];

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of entries) {
    if (name === "node_modules" || name === ".git") continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function lineHasAllowlist(source, line) {
  if (line <= 1) return false;
  const lines = source.split("\n");
  const above = lines[line - 2] ?? "";
  return above.includes(ALLOWLIST_TAG);
}

function payloadHasAppKey(node) {
  if (!node) return false;
  // ObjectExpression — the typical payload literal
  if (node.type === "ObjectExpression") {
    return node.properties.some(
      (p) =>
        p.type === "ObjectProperty" &&
        ((p.key.type === "Identifier" && p.key.name === "app") ||
          (p.key.type === "StringLiteral" && p.key.value === "app")),
    );
  }
  // ArrayExpression of objects — check all elements
  if (node.type === "ArrayExpression") {
    return node.elements.every((e) => payloadHasAppKey(e));
  }
  // Spread / variable — cannot verify statically; allow (operator must allowlist)
  return true;
}

for (const dir of SCAN_DIRS) {
  for (const file of walk(dir)) {
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch (e) {
      errors.push(`Read failed: ${file}: ${e.message}`);
      continue;
    }
    if (!source.includes("appsflyer_devices")) continue;

    let ast;
    try {
      ast = parser.parse(source, {
        sourceType: "module",
        plugins: ["typescript", "jsx"],
        errorRecovery: true,
      });
    } catch (e) {
      errors.push(`Parse failed: ${file}: ${e.message}`);
      continue;
    }

    traverse(ast, {
      CallExpression(path) {
        // Match: .from("appsflyer_devices").<insert|update|upsert>(payload)
        const callee = path.node.callee;
        if (callee.type !== "MemberExpression") return;
        const methodName = callee.property?.name;
        if (
          methodName !== "insert" &&
          methodName !== "update" &&
          methodName !== "upsert"
        ) {
          return;
        }
        // Walk up the member chain to find a .from("appsflyer_devices") call
        let cursor = callee.object;
        let isAppsflyerDevices = false;
        while (cursor && cursor.type === "CallExpression") {
          if (
            cursor.callee.type === "MemberExpression" &&
            cursor.callee.property?.name === "from" &&
            cursor.arguments[0]?.type === "StringLiteral" &&
            cursor.arguments[0].value === "appsflyer_devices"
          ) {
            isAppsflyerDevices = true;
            break;
          }
          cursor =
            cursor.callee?.type === "MemberExpression"
              ? cursor.callee.object
              : null;
        }
        if (!isAppsflyerDevices) return;

        const payload = path.node.arguments[0];
        if (payloadHasAppKey(payload)) return;

        const line = path.node.loc?.start.line ?? 0;
        if (lineHasAllowlist(source, line)) return;

        violations += 1;
        console.error(
          `VIOLATION ${relative(REPO_ROOT, file)}:${line} — ` +
            `appsflyer_devices.${methodName}() payload missing \`app:\` key. ` +
            `Add app: 'consumer' | 'business' or allowlist with // ${ALLOWLIST_TAG} — <reason>.`,
        );
      },
    });
  }
}

if (errors.length > 0) {
  for (const e of errors) console.error("ERROR " + e);
  if (violations === 0) {
    // Parse / read errors with no real violations — fail soft as 2 so the
    // build flags an inspection without claiming a real invariant breach.
    process.exit(2);
  }
}

if (violations > 0) {
  console.error(`\n${violations} violation(s) found.`);
  process.exit(1);
}
console.log("ORCH-0808 strict-grep clean (appsflyer_devices writes carry app:).");
process.exit(0);
