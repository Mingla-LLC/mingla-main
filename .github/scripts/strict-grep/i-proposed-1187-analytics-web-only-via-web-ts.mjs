#!/usr/bin/env node

/**
 * I-PROPOSED-1187-ANALYTICS-WEB-ONLY-VIA-WEB-TS
 *   (META-ORCH-1187 [Growth Analytics Hub] Phase 1)
 *
 * WHY: the browser-only analytics SDK `posthog-js` (and the gtag/GA loader) must
 * NEVER load on native. On the Expo apps it may be referenced ONLY from `.web.ts`
 * / `.web.tsx` modules (Metro resolves `.web.*` on web, the `.ts` no-op on
 * native) — mirroring the existing `mixpanelService.web.ts` contract. On the
 * Next.js marketing site, `posthog-js` may be referenced only from `'use client'`
 * components (it cannot run in a server component).
 *
 * GATE:
 *   1. marketing: any file importing `posthog-js` must be a `'use client'`
 *      component (or be imported only into client code). We assert the import
 *      sites declare `'use client'`.
 *   2. mingla-business: `posthog-js` may appear ONLY in `*.web.ts(x)` files.
 *   3. app-mobile: `posthog-js` must NOT appear at all (native uses
 *      posthog-react-native).
 *
 * NOTE: LEG 1 ships only the marketing surface. Rules 2/3 are zero-violation
 * today and guard the later legs (buyer-web / native) the moment they land.
 *
 * FAILS-ON-REVERT: importing posthog-js into a server component, a non-.web
 * mingla-business module, or app-mobile, fails this gate.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const POSTHOG_JS_IMPORT = /from\s+['"]posthog-js['"]|require\(\s*['"]posthog-js['"]\s*\)/;

function isExempt(rel) {
  if (rel.includes("__tests__")) return true;
  if (/\.test\.[tj]sx?$/.test(rel)) return true;
  if (rel.includes("node_modules")) return true;
  if (rel.includes(".next/")) return true;
  return false;
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      walk(full, out);
    } else if (CODE_EXT.has(path.extname(e.name))) {
      out.push(full);
    }
  }
}

const errors = [];

// (1) marketing — posthog-js import sites must be 'use client'.
{
  const files = [];
  walk(path.join(repoRoot, "mingla-marketing"), files);
  for (const file of files) {
    const rel = path.relative(repoRoot, file);
    if (isExempt(rel)) continue;
    const contents = fs.readFileSync(file, "utf8");
    if (POSTHOG_JS_IMPORT.test(contents)) {
      const firstNonEmpty = contents
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("/*") && !l.startsWith("*"));
      if (!/^'use client'|^"use client"/.test(firstNonEmpty ?? "")) {
        errors.push(
          `${rel}: imports posthog-js but is not a 'use client' component (must run client-only).`,
        );
      }
    }
  }
}

// (2) mingla-business — posthog-js only in *.web.ts(x).
{
  const files = [];
  walk(path.join(repoRoot, "mingla-business"), files);
  for (const file of files) {
    const rel = path.relative(repoRoot, file);
    if (isExempt(rel)) continue;
    const contents = fs.readFileSync(file, "utf8");
    if (POSTHOG_JS_IMPORT.test(contents) && !/\.web\.tsx?$/.test(rel)) {
      errors.push(
        `${rel}: imports posthog-js in a non-.web module (native bundle would pull it). Move to a .web.ts split.`,
      );
    }
  }
}

// (3) app-mobile — posthog-js forbidden entirely.
{
  const files = [];
  walk(path.join(repoRoot, "app-mobile"), files);
  for (const file of files) {
    const rel = path.relative(repoRoot, file);
    if (isExempt(rel)) continue;
    const contents = fs.readFileSync(file, "utf8");
    if (POSTHOG_JS_IMPORT.test(contents)) {
      errors.push(
        `${rel}: app-mobile must not import posthog-js (native uses posthog-react-native).`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error("FAIL: I-PROPOSED-1187-ANALYTICS-WEB-ONLY-VIA-WEB-TS violated");
  for (const e of errors) console.error(`  - ${e}`);
  console.error(
    "\nposthog-js / gtag are web-only — client components (marketing) or .web.ts splits (Expo). (META-ORCH-1187)",
  );
  process.exit(1);
}

console.log(
  "OK: I-PROPOSED-1187-ANALYTICS-WEB-ONLY-VIA-WEB-TS — web-only analytics isolation intact",
);
