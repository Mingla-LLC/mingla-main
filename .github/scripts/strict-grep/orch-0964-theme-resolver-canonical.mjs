#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const resolverRel = "packages/offering-rendering/themeResolver.ts";
const failures = [];

const walk = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if ([".git", "node_modules", "dist", "build", ".expo"].includes(entry)) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) out.push(path);
  }
  return out;
};

for (const file of walk(root)) {
  const rel = relative(root, file);
  const src = readFileSync(file, "utf8");
  if (rel !== resolverRel && /\b(function\s+resolveTheme|const\s+resolveTheme\s*=|export\s+const\s+resolveTheme\s*=)/.test(src)) {
    failures.push(`${rel}: duplicate resolveTheme implementation`);
  }
  if (rel !== resolverRel && /\bthemeColor\s*=/.test(src)) {
    failures.push(`${rel}: themeColor assignment bypasses canonical resolver`);
  }
}

const resolver = readFileSync(join(root, resolverRel), "utf8");
if (!/export\s+const\s+resolveTheme\s*=/.test(resolver)) {
  failures.push(`${resolverRel}: canonical resolveTheme export missing`);
}

if (failures.length > 0) {
  console.error("ORCH-0964 theme resolver canonical gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-0964 theme resolver canonical gate passed.");
