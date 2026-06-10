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
  if (scripts.length < 3) {
    console.error("FAIL: expected at least 3 k6 scripts");
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
