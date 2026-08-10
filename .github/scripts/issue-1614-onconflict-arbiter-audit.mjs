#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE_ROOTS = [
  "app-mobile",
  "mingla-business",
  "mingla-admin",
  "mingla-marketing",
  "packages",
  "supabase/functions",
];
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const EXCLUDED_SEGMENTS = new Set([
  "node_modules", "dist", "build", ".expo", ".next", "coverage", "vendor",
  "migrations", "__tests__", "test", "tests", "fixtures", "generated",
]);

function lineAt(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

function decodeLiteral(raw, file, line) {
  const quote = raw[0];
  const body = raw.slice(1, -1);
  if (quote === "`" && body.includes("${")) {
    throw new Error(`${file}:${line}: template interpolation is forbidden in onConflict/from literals`);
  }
  return body.replace(/\\([\\'"`])/g, "$1");
}

export function maskComments(source) {
  let out = "";
  let state = "code";
  let quote = "";
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === "line") {
      if (ch === "\n") { state = "code"; out += "\n"; } else out += " ";
      continue;
    }
    if (state === "block") {
      if (ch === "*" && next === "/") { out += "  "; i += 1; state = "code"; }
      else out += ch === "\n" ? "\n" : " ";
      continue;
    }
    if (state === "string") {
      out += ch;
      if (ch === "\\") { out += next ?? ""; i += 1; continue; }
      if (ch === quote) state = "code";
      continue;
    }
    if (ch === "/" && next === "/") { out += "  "; i += 1; state = "line"; continue; }
    if (ch === "/" && next === "*") { out += "  "; i += 1; state = "block"; continue; }
    if (ch === "'" || ch === '"' || ch === "`") {
      state = "string"; quote = ch; out += ch; continue;
    }
    out += ch;
  }
  return out;
}

export function enumerateSource(source, file = "fixture.ts") {
  const clean = maskComments(source);
  const sites = [];
  const property = /\bonConflict\s*:\s*/g;
  let match;
  while ((match = property.exec(clean)) !== null) {
    const valueOffset = property.lastIndex;
    const literalMatch = clean.slice(valueOffset).match(/^(["'`])(?:\\.|(?!\1)[\s\S])*?\1/);
    const line = lineAt(source, match.index);
    if (!literalMatch) throw new Error(`${file}:${line}: onConflict must be a string literal`);
    const target = decodeLiteral(literalMatch[0], file, line);
    const columns = target.split(",").map((column) => column.trim());
    if (columns.length === 0 || columns.some((column) => column.length === 0)) {
      throw new Error(`${file}:${line}: onConflict has an empty column`);
    }
    if (new Set(columns).size !== columns.length) {
      throw new Error(`${file}:${line}: onConflict has duplicate columns`);
    }

    const statementStart = clean.lastIndexOf(";", match.index);
    const prefix = clean.slice(statementStart + 1, match.index);
    const fromPattern = /\.from\s*\(\s*(["'`])(?:\\.|(?!\1)[\s\S])*?\1\s*,?\s*\)/g;
    const fromMatches = [...prefix.matchAll(fromPattern)];
    if (fromMatches.length === 0) {
      throw new Error(`${file}:${line}: cannot resolve string-literal .from(table) in the same query expression`);
    }
    const fromRaw = fromMatches.at(-1)[0].match(/(["'`])(?:\\.|(?!\1)[\s\S])*?\1/)[0];
    const table = decodeLiteral(fromRaw, file, line);
    if (!table || table.includes("${")) {
      throw new Error(`${file}:${line}: invalid .from(table) literal`);
    }
    sites.push({ table, columns, file, line });
    property.lastIndex = valueOffset + literalMatch[0].length;
  }
  return sites;
}

function walk(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && EXCLUDED_SEGMENTS.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, files);
    else if (
      SOURCE_EXTENSIONS.has(path.extname(entry.name)) &&
      !/(?:^|\.)(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)
    ) files.push(absolute);
  }
  return files;
}

export function enumerateRepository(root = ROOT) {
  const sites = [];
  for (const sourceRoot of SOURCE_ROOTS) {
    for (const file of walk(path.join(root, sourceRoot))) {
      const relative = path.relative(root, file);
      sites.push(...enumerateSource(fs.readFileSync(file, "utf8"), relative));
    }
  }
  sites.sort((a, b) => a.table.localeCompare(b.table) ||
    a.columns.join(",").localeCompare(b.columns.join(",")) ||
    a.file.localeCompare(b.file) || a.line - b.line);
  return sites;
}

export function manifestFor(sites) {
  const grouped = new Map();
  for (const site of sites) {
    const key = `${site.table}\u0000${site.columns.join("\u0000")}`;
    const entry = grouped.get(key) ?? {
      table: site.table,
      columns: site.columns,
      callSites: [],
    };
    entry.callSites.push(`${site.file}:${site.line}`);
    grouped.set(key, entry);
  }
  return [...grouped.values()].sort((a, b) =>
    a.table.localeCompare(b.table) || a.columns.join(",").localeCompare(b.columns.join(","))
  );
}

export function quoteIdentifier(identifier) {
  if (typeof identifier !== "string" || identifier.length === 0 || identifier.includes("\0")) {
    throw new Error("SQL identifier must be a non-empty string without NUL bytes");
  }
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function emitExplainSql(manifest) {
  return manifest.map((entry) => {
    const table = quoteIdentifier(entry.table);
    const columns = entry.columns.map(quoteIdentifier).join(", ");
    const values = entry.columns.map(() => "NULL").join(", ");
    return `-- ${entry.callSites.join(", ")}\nEXPLAIN INSERT INTO public.${table} (${columns}) VALUES (${values}) ON CONFLICT (${columns}) DO NOTHING;`;
  }).join("\n\n");
}

export function emitDatabaseSelfTestSql() {
  return `BEGIN;
CREATE TEMP TABLE issue_1614_partial_fixture (id uuid);
CREATE UNIQUE INDEX issue_1614_partial_fixture_id
  ON issue_1614_partial_fixture (id) WHERE id IS NOT NULL;
CREATE TEMP TABLE issue_1614_full_fixture (id uuid UNIQUE);
DO $issue_1614_self_test$
BEGIN
  BEGIN
    EXECUTE 'EXPLAIN INSERT INTO issue_1614_partial_fixture(id) VALUES (NULL) ON CONFLICT (id) DO NOTHING';
    RAISE EXCEPTION 'issue_1614_partial_arbiter_was_incorrectly_accepted';
  EXCEPTION WHEN invalid_column_reference THEN
    NULL;
  END;
  EXECUTE 'EXPLAIN INSERT INTO issue_1614_full_fixture(id) VALUES (NULL) ON CONFLICT (id) DO NOTHING';
END
$issue_1614_self_test$;
ROLLBACK;`;
}

export function runSelfTest() {
  const fixture = `
    // onConflict: "ignored"
    /* .from("ignored").upsert({}, { onConflict: "ignored" }) */
    db.from('alpha').upsert({}, { onConflict: 'a,b' });
    db.from("alpha").upsert({}, { onConflict: "a,b" });
    db
      .from(\`future\`)
      .upsert({}, { onConflict: \`quoted\` });
  `;
  const sites = enumerateSource(fixture);
  if (sites.length !== 3 || sites[2].table !== "future") throw new Error("literal/comment self-test failed");
  if (manifestFor(sites).length !== 2) throw new Error("deduplication self-test failed");
  if (quoteIdentifier('a"b') !== '"a""b"') throw new Error("identifier quoting self-test failed");
  const databaseFixture = emitDatabaseSelfTestSql();
  if (!databaseFixture.includes("partial_arbiter_was_incorrectly_accepted") ||
      !databaseFixture.includes("full_fixture")) {
    throw new Error("PostgreSQL partial/full arbiter fixture generation failed");
  }
  for (const bad of [
    `db.from("x").upsert({}, { onConflict: target });`,
    `db.from(table).upsert({}, { onConflict: "id" });`,
    `db.from("x").upsert({}, { onConflict: "id,id" });`,
    `db.from("x").upsert({}, { onConflict: \`id_\${suffix}\` });`,
  ]) {
    let rejected = false;
    try { enumerateSource(bad); } catch { rejected = true; }
    if (!rejected) throw new Error(`invalid fixture was accepted: ${bad}`);
  }
  process.stdout.write("issue-1614 audit self-test: PASS\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
  } else {
    const sites = enumerateRepository();
    if (sites.length < 83) {
      throw new Error(`bootstrap sentinel failed: expected at least 83 executable literal sites, found ${sites.length}`);
    }
    const manifest = manifestFor(sites);
    if (process.argv.includes("--emit-self-test-sql")) {
      process.stdout.write(`${emitDatabaseSelfTestSql()}\n`);
    } else if (process.argv.includes("--emit-sql")) process.stdout.write(`${emitExplainSql(manifest)}\n`);
    else process.stdout.write(`${JSON.stringify({ siteCount: sites.length, targets: manifest }, null, 2)}\n`);
  }
}
