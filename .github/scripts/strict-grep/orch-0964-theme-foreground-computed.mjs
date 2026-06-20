#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const failures = [];

const walk = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if ([".git", "node_modules", "dist", "build", ".expo"].includes(entry)) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx|js|jsx|mjs|sql)$/.test(entry)) out.push(path);
  }
  return out;
};

for (const file of walk(root)) {
  const rel = relative(root, file);
  if (rel === ".github/scripts/strict-grep/orch-0964-theme-foreground-computed.mjs") {
    continue;
  }
  const src = readFileSync(file, "utf8");
  if (/\b(theme_foreground_color|themeForegroundColor|foreground_theme_color)\b/i.test(src)) {
    failures.push(`${rel}: foreground theme color must be computed, not persisted`);
  }
}

const resolver = readFileSync(join(root, "packages/offering-rendering/themeResolver.ts"), "utf8");
if (!/export\s+const\s+computeForeground\s*=/.test(resolver)) {
  failures.push("packages/offering-rendering/themeResolver.ts: computeForeground export missing");
}
if (!/foregroundColor:\s*computeForeground\(/.test(resolver)) {
  failures.push("packages/offering-rendering/themeResolver.ts: resolveTheme must call computeForeground");
}

if (failures.length > 0) {
  console.error("ORCH-0964 foreground-computed gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-0964 foreground-computed gate passed.");
