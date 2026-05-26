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
  const src = readFileSync(file, "utf8");
  const forbidden = [
    /theme\.theme_color\b/,
    /theme\.themeColor\b/,
    /theme\.themeFont\b/,
    /theme\.themeAnimation\b/,
    /events\.theme\s*=\s*[^;]*(theme_color|theme_font|theme_animation)/s,
    /theme:\s*\{[^}]*theme_(color|font|animation)/s,
  ];
  if (forbidden.some((pattern) => pattern.test(src))) {
    failures.push(`${rel}: theme values must not be written inside events.theme JSONB`);
  }
}

const migration = readFileSync(
  join(root, "supabase/migrations/20260729000002_orch_0964_brand_event_theme_columns.sql"),
  "utf8",
);
for (const required of [
  "brands.theme_color",
  "brands.theme_font",
  "brands.theme_animation",
  "events.theme_color_override",
  "events.theme_font_override",
  "events.theme_animation_override",
]) {
  const [table, column] = required.split(".");
  if (!new RegExp(`ALTER TABLE\\s+public\\.${table}[\\s\\S]*ADD COLUMN IF NOT EXISTS\\s+${column}`, "i").test(migration)) {
    failures.push(`migration missing typed column ${required}`);
  }
}

if (failures.length > 0) {
  console.error("ORCH-0964 theme typed-columns gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-0964 theme typed-columns gate passed.");
