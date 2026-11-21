#!/usr/bin/env node
// Enforces I-PRIVACY-BAR-NEVER-OCCLUDES (declared in mingla-business/playwright/issue2331/strip-clearance.spec.ts): Static leg: every fixed layer in mingla-marketing that reaches the bottom of the viewport ends at the privacy strip's top edge via var(--mingla-privacy-strip).
//
// usemingla.com keeps document scrolling, so a `position: fixed` layer resolves
// against the viewport and the strip (fixed, bottom 0, top z-layer) would cover
// its bottom 28px. Each such layer therefore uses the one shared bottom edge,
// `var(--mingla-privacy-strip)`. This check fails on any fixed layer in
// app/ or components/ that is anchored to the bottom by ANY offset or is full
// height (CSS `bottom:<any>` / `inset` / `100vh|dvh|svh|lvh`; Tailwind
// `bottom-*` / `inset-*` / `inset-y-*` / `h-screen` / `h-dvh`, with or without
// a variant prefix such as `md:`; inline `{ position: 'fixed', bottom: 16 }`)
// without that token. The browser gate
// (mingla-business/playwright/issue2331-marketing/strip-clearance.spec.ts)
// proves the rendered result.
//
// Exceptions: the internal preview routes (not public pages) and the strip's
// own rule (`.mps`, which IS the band). Nothing else is allowlisted.
//
// Usage: node scripts/issue-2331-strip-token-check.mjs [--self-test]

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["app", "components"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".css"]);
const TOKEN = "--mingla-privacy-strip";

// Internal preview routes and the design-preview banner are not public pages.
export const ALLOWLIST = [
  "app/event-preview/",
  "app/trip-preview/",
  "app/venue-preview/",
  "components/design-preview/",
];

const FIXED_CSS = /position\s*:\s*fixed\b/;
// Anchored to the bottom by ANY offset (bottom:0, bottom:12px, inset:0, an
// inset whose 3rd value is not auto, inset-block-end), or a full-height layer
// (100vh / dvh / svh / lvh).
/** Is a declaration block anchored to the bottom by any offset? */
function bottomAnchoredCss(decls) {
  for (const m of decls.matchAll(/(?:^|[;{\s])(bottom|inset|inset-block|inset-block-end)\s*:\s*([^;}]+)/g)) {
    const prop = m[1];
    const parts = m[2].replace(/!important/, '').trim().split(/\s+(?![^(]*\))/);
    let bottom = parts[0];
    if (prop === 'inset') bottom = parts.length >= 3 ? parts[2] : parts[0];
    if (prop === 'inset-block') bottom = parts.length >= 2 ? parts[1] : parts[0];
    if (bottom !== undefined && bottom !== 'auto') return true;
  }
  return false;
}
const FULL_HEIGHT_CSS = /(?:^|[;{\s])(?:min-|max-)?height\s*:\s*[^;}]*\b100(?:vh|dvh|svh|lvh)\b/;
// Tailwind, after dropping variant prefixes (md:, lg:, focus:, ...).
const TW_BOTTOM = /^(?:-?bottom-(?!auto$)\S+|inset-(?!x-)\S+|inset-y-\S+|(?:min-|max-)?h-(?:screen|dvh|svh|lvh|\[100(?:vh|dvh|svh|lvh)\]))$/;
const INLINE_FIXED = /position\s*:\s*['"]fixed['"]/;
const INLINE_BOTTOM = /(?:^|[{,\s])(?:bottom\s*:(?!\s*['"]auto['"])\s*[^,}\s]+|inset\s*:\s*[^,}]+|(?:min|max)?[hH]eight\s*:\s*['"][^'"]*100(?:vh|dvh|svh|lvh)[^'"]*['"])/;

/** Class tokens of a string, without variant prefixes (`md:fixed` -> `fixed`). */
const twTokens = (value) => value.split(/\s+/).filter(Boolean).map((token) => token.slice(token.lastIndexOf(':') + 1));

/** Rule blocks of a CSS text (selector + declarations), nesting-aware. */
function cssBlocks(raw) {
  // Blank out comments (same length, so offsets keep their line numbers).
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  const blocks = [];
  const stack = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{") {
      stack.push({ selector: text.slice(start, i).split(/[;}]/).pop().trim(), open: i });
      start = i + 1;
    } else if (ch === "}") {
      const top = stack.pop();
      if (top !== undefined) blocks.push({ selector: top.selector, body: text.slice(top.open + 1, i), at: top.open });
      start = i + 1;
    }
  }
  return blocks;
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

/** Every violation in one source text. */
export function violationsIn(file, text) {
  const found = [];
  const isCss = file.endsWith(".css");
  // CSS: stylesheets, and CSS held in template strings inside TS/TSX.
  const cssSources = isCss ? [{ text, offset: 0 }] : [...text.matchAll(/`([^`]*)`/g)].map((m) => ({ text: m[1], offset: m.index + 1 }));
  for (const source of cssSources) {
    for (const block of cssBlocks(source.text)) {
      // Only the declarations directly in this block (strip nested blocks).
      const own = block.body.replace(/\{[^{}]*\}/g, "");
      if (!FIXED_CSS.test(own) || !(bottomAnchoredCss(own) || FULL_HEIGHT_CSS.test(own)) || own.includes(TOKEN)) continue;
      if (/^\.mps$/.test(block.selector.replace(/\s+/g, ""))) continue;
      found.push({ file, line: lineOf(text, source.offset + block.at), what: `CSS \`${block.selector}\` is fixed at the bottom without var(${TOKEN})` });
    }
  }
  if (isCss) return found;
  // Tailwind class strings (any quoted string literal).
  for (const match of text.matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)) {
    const value = match[2];
    const tokens = twTokens(value);
    if (!tokens.includes('fixed') || !tokens.some((token) => TW_BOTTOM.test(token)) || value.includes(TOKEN)) continue;
    found.push({ file, line: lineOf(text, match.index), what: `class "${value.slice(0, 90)}" is fixed at the bottom without bottom-[var(${TOKEN})]` });
  }
  // Inline style objects: `{ position: 'fixed', inset: 0 }`.
  for (const match of text.matchAll(/\{[^{}]*\}/g)) {
    const body = match[0];
    if (!INLINE_FIXED.test(body) || !INLINE_BOTTOM.test(body) || body.includes(TOKEN)) continue;
    found.push({ file, line: lineOf(text, match.index), what: "inline style is fixed at the bottom without the strip token" });
  }
  return found;
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTENSIONS.has(path.extname(name))) out.push(full);
  }
  return out;
}

export function scan(root = ROOT) {
  const files = SCAN_DIRS.flatMap((dir) => walk(path.join(root, dir), []));
  const violations = [];
  let checked = 0;
  for (const full of files) {
    const rel = path.relative(root, full).split(path.sep).join("/");
    if (ALLOWLIST.some((prefix) => rel.startsWith(prefix))) continue;
    checked += 1;
    violations.push(...violationsIn(rel, readFileSync(full, "utf8")));
  }
  return { checked, violations };
}

function selfTest() {
  const cases = [
    ["a.css", ".x { position: fixed; inset: 0; z-index: 9; }", 1],
    ["a.css", ".x { position: fixed; top: 0; right: 0; bottom: 0; }", 1],
    ["a.css", ".x {\n  position: fixed;\n  inset: 0;\n}", 1],
    ["a.css", ".x { position: fixed; inset: 0 0 var(--mingla-privacy-strip) 0; }", 0],
    ["a.css", ".x { position: fixed; top: 0; bottom: var(--mingla-privacy-strip); }", 0],
    ["a.css", ".x { position: fixed; inset: 0 0 auto; }", 0],
    ["a.css", ".x { position: absolute; inset: 0; }", 0],
    ["a.css", "@media (min-width: 1px) { .x { position: fixed; bottom: 0; } }", 1],
    ["a.tsx", "const CSS = `.mps{position:fixed;left:0;right:0;bottom:0}`", 0],
    ["a.tsx", "const CSS = `.other{position:fixed;left:0;right:0;bottom:0}`", 1],
    ["a.tsx", '<div className="fixed inset-0 z-50" />', 1],
    ["a.tsx", '<div className="fixed inset-x-0 bottom-0" />', 1],
    ["a.tsx", "cn('fixed inset-y-0 z-[101] flex')", 1],
    ["a.tsx", '<div className="fixed inset-0 bottom-[var(--mingla-privacy-strip)]" />', 0],
    ["a.tsx", '<div className="fixed inset-x-0 top-0 z-40" />', 0],
    ["a.tsx", '<div className="absolute inset-0" />', 0],
    ["a.tsx", "<div style={{ position: 'fixed', inset: 0 }} />", 1],
    ["a.tsx", "<div style={{ position: 'fixed', top: 0, bottom: 'var(--mingla-privacy-strip)' }} />", 0],
    // #2331 D4 — any bottom offset, full-height layers, variants, inline offsets.
    ["a.tsx", '<button className="fixed bottom-4 right-4" />', 1],
    ["a.tsx", '<div className="fixed inset-x-0 bottom-2" />', 1],
    ["a.css", ".x { position: fixed; right: 0; bottom: 12px; }", 1],
    ["a.tsx", '<aside className="fixed top-0 left-0 h-screen w-80" />', 1],
    ["a.css", ".x { position: fixed; top: 0; height: 100dvh; }", 1],
    ["a.tsx", '<div className="md:fixed md:inset-0" />', 1],
    ["a.tsx", "<div style={{ position: 'fixed', bottom: 16 }} />", 1],
    ["a.tsx", "<div style={{ position: 'fixed', top: 0, height: '100vh' }} />", 1],
    ["a.tsx", '<div className="fixed bottom-[var(--mingla-privacy-strip)] right-4" />', 0],
    ["a.tsx", '<div className="fixed top-4 right-4" />', 0],
    ["a.tsx", '<div className="fixed bottom-auto top-0" />', 0],
    ["a.css", ".x { position: fixed; top: 0; bottom: auto; }", 0],
    ["a.css", ".x { position: fixed; top: calc(100vh - 40px); }", 0],
    ["a.tsx", '<section className="relative h-screen" />', 0],
  ];
  let failed = 0;
  for (const [file, text, expected] of cases) {
    const got = violationsIn(file, text).length;
    if (got !== expected) {
      failed += 1;
      console.error(`SELF-TEST FAIL: ${file} ${JSON.stringify(text)} -> ${got} violation(s), expected ${expected}`);
    }
  }
  if (failed > 0) process.exit(1);
  console.log(`SELF-TEST PASS: ${cases.length} cases (I-PRIVACY-BAR-NEVER-OCCLUDES static leg).`);
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  if (process.argv.includes("--self-test")) {
    selfTest();
  } else {
    const { checked, violations } = scan();
    if (violations.length > 0) {
      for (const v of violations) console.error(`${v.file}:${v.line}: ${v.what}`);
      console.error(`FAIL [I-PRIVACY-BAR-NEVER-OCCLUDES]: ${violations.length} fixed bottom layer(s) without var(${TOKEN}). Use bottom: var(${TOKEN}) (Tailwind bottom-[var(${TOKEN})]).`);
      process.exit(1);
    }
    console.log(`OK [I-PRIVACY-BAR-NEVER-OCCLUDES]: ${checked} files; every fixed bottom layer ends at var(${TOKEN}) (preview routes allowlisted: ${ALLOWLIST.join(", ")}).`);
  }
}
