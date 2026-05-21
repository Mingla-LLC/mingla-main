#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const roots = [
  path.join(repoRoot, "app-mobile/src/services"),
  path.join(repoRoot, "app-mobile/src/contexts"),
];
const forbidden = [
  "no curated parallel path",
  "that pattern is solo-only",
];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const failures = [];
for (const root of roots) {
  for (const file of walk(root)) {
    const text = fs.readFileSync(file, "utf8");
    for (const needle of forbidden) {
      if (text.includes(needle)) {
        failures.push(`${path.relative(repoRoot, file)} contains "${needle}"`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("FAIL ORCH-0906 resurrected solo-only comment gate");
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log("PASS ORCH-0906 resurrected solo-only comment gate");
