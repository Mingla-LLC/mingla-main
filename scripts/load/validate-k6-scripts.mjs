#!/usr/bin/env node
/**
 * #426 — Static validation for k6 scripts (no k6 binary required in CI).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOAD_DIR = __dirname;

const REQUIRED_SNIPPETS = ["export const options", "export default function"];

/** PR3 — scripts that must exist for load harness completeness (#426). */
const REQUIRED_SCRIPT_NAMES = [
  "smoke.js",
  "discover-merged-events.js",
  "ticket-checkout-status.js",
  "ticket-checkout-create.js",
  "agent-chat.js",
];

const LIB_EXPORTS = ["postJsonAuthed", "edgeHeadersWithJwt", "checkNot5xx"];

function listK6Scripts(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "lib") continue;
      out.push(...listK6Scripts(full));
      continue;
    }
    if (entry.endsWith(".js") && entry !== "validate-k6-scripts.mjs") {
      out.push(full);
    }
  }
  return out;
}

function validate(path) {
  const text = readFileSync(path, "utf8");
  const missing = REQUIRED_SNIPPETS.filter((s) => !text.includes(s));
  return missing;
}

function main() {
  const scripts = listK6Scripts(LOAD_DIR).filter((p) => !p.endsWith("validate-k6-scripts.mjs"));
  const scriptBasenames = scripts.map((p) => p.split(/[/\\]/).pop());

  if (scripts.length < REQUIRED_SCRIPT_NAMES.length) {
    console.error(
      `FAIL: expected at least ${REQUIRED_SCRIPT_NAMES.length} k6 scripts, found ${scripts.length}`,
    );
    process.exit(1);
  }

  for (const name of REQUIRED_SCRIPT_NAMES) {
    if (!scriptBasenames.includes(name)) {
      console.error(`FAIL: missing required script ${name}`);
      process.exit(1);
    }
  }

  const libPath = join(LOAD_DIR, "lib", "supabase-edge.js");
  const libText = readFileSync(libPath, "utf8");
  const missingExports = LIB_EXPORTS.filter((s) => !libText.includes(s));
  if (missingExports.length > 0) {
    console.error(`FAIL: lib/supabase-edge.js missing exports: ${missingExports.join(", ")}`);
    process.exit(1);
  }

  let failed = 0;
  for (const script of scripts) {
    const missing = validate(script);
    if (missing.length > 0) {
      console.error(`FAIL: ${script} missing: ${missing.join(", ")}`);
      failed += 1;
    }
  }

  if (failed > 0) process.exit(1);
  console.log(`PASS: ${scripts.length} k6 script(s) structurally valid`);
  process.exit(0);
}

main();
