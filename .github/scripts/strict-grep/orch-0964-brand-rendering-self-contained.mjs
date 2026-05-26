#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const packageRoot = join(root, "packages/brand-rendering");
const failures = [];

const walk = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx|js|jsx)$/.test(entry)) out.push(path);
  }
  return out;
};

for (const file of walk(packageRoot)) {
  const rel = relative(root, file);
  const src = readFileSync(file, "utf8");
  if (/from\s+["'][^"']*(mingla-business\/src|app-mobile\/src|\/src\/components\/brand)/.test(src)) {
    failures.push(`${rel}: packages/brand-rendering must not import app src code`);
  }
}

if (failures.length > 0) {
  console.error("ORCH-0964 brand-rendering self-contained gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-0964 brand-rendering self-contained gate passed.");
