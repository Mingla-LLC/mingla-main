#!/usr/bin/env node

/**
 * I-PROPOSED-1187-NO-PHX-IN-CLIENT (META-ORCH-1187 [Growth Analytics Hub] Phase 1)
 *
 * WHY: PostHog has TWO key kinds. The `phc_*` PROJECT key is public-by-design
 * and safe in client bundles. The `phx_*` PERSONAL / MCP key is a privileged
 * server-only credential that can read/modify the whole project — it MUST NEVER
 * appear in any client app source or bundle. This gate is the secret-hygiene
 * fails-on-revert catcher (SC-9 / SC-SecretHygiene).
 *
 * GATE: no `phx_` literal anywhere in the client app trees.
 *
 * FAILS-ON-REVERT: pasting a `phx_*` key into client source fails this gate.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const SCAN_DIRS = ["mingla-marketing", "mingla-business", "app-mobile"];
const CODE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".env", ".example",
]);
// Match the PostHog personal/MCP key prefix followed by a key body char.
const PHX_RE = /\bphx_[A-Za-z0-9]/;

function isExempt(rel) {
  if (rel.includes("node_modules")) return true;
  if (rel.includes(".next/")) return true;
  // DISC-B (leg-2 tester): exclude local web-export output.
  if (rel.includes("web-build/")) return true;
  if (rel.includes("dist/")) return true;
  if (rel.startsWith(".github/")) return true;
  if (rel.startsWith("Mingla_Artifacts/")) return true;
  return false;
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (
        e.name === "node_modules" ||
        e.name === ".next" ||
        e.name === "web-build" ||
        e.name === "dist"
      )
        continue;
      walk(full, out);
    } else {
      const ext = path.extname(e.name);
      if (CODE_EXT.has(ext) || e.name.startsWith(".env")) out.push(full);
    }
  }
}

const files = [];
for (const d of SCAN_DIRS) walk(path.join(repoRoot, d), files);

const offenders = [];
for (const file of files) {
  const rel = path.relative(repoRoot, file);
  if (isExempt(rel)) continue;
  const contents = fs.readFileSync(file, "utf8");
  if (PHX_RE.test(contents)) offenders.push(rel);
}

if (offenders.length > 0) {
  console.error("FAIL: I-PROPOSED-1187-NO-PHX-IN-CLIENT violated");
  console.error(
    `\n${offenders.length} client file(s) contain a phx_* (PostHog personal/MCP) key — server-only, NEVER ship to clients:`,
  );
  for (const f of offenders) console.error(`  - ${f}`);
  console.error(
    "\nUse the public phc_* PROJECT key in clients. The phx_* key stays server/MCP-only.",
  );
  process.exit(1);
}

console.log(
  `OK: I-PROPOSED-1187-NO-PHX-IN-CLIENT — ${files.length} client files scanned, 0 phx_ literals`,
);
