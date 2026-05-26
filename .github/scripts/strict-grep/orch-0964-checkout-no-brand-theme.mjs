#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const failures = [];
const checkoutRoots = [
  "mingla-business/app/checkout",
  "mingla-business/app/checkout-trip",
];

const walk = (dir) => {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx|js|jsx)$/.test(entry)) out.push(path);
  }
  return out;
};

for (const relRoot of checkoutRoots) {
  for (const file of walk(join(root, relRoot))) {
    const rel = relative(root, file);
    const src = readFileSync(file, "utf8");
    if (
      /@mingla\/event-rendering/.test(src) &&
      /\b(resolveTheme|ResolvedTheme|MINGLA_DEFAULT_THEME|ThemeEntranceAnimation)\b/.test(src)
    ) {
      failures.push(`${rel}: checkout route imports public-page theme primitives`);
    }
  }
}

if (failures.length > 0) {
  console.error("ORCH-0964 checkout-no-brand-theme gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-0964 checkout-no-brand-theme gate passed.");
