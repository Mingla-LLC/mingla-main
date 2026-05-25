#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0957 — no metered Supabase image-transformation reads for place photos.
 *
 * The only allowed use of the Supabase Storage render endpoint is the
 * explicitly labeled emergency fallback block in _shared/imageCollage.ts,
 * guarded by USE_PLACE_PHOTO_THUMBS=false.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const FUNCTIONS_ROOT = path.join(REPO_ROOT, "supabase", "functions");
const NEEDLE = "/storage/v1/" + "render/image/";
const ALLOWED_FILE = "supabase/functions/_shared/imageCollage.ts";
const ALLOWLIST_MARKER = "ORCH-0957 LEGACY FALLBACK ALLOWLIST";

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && full.endsWith(".ts")) out.push(full);
  }
  return out;
}

function rel(file) {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

const offenders = [];
for (const file of walk(FUNCTIONS_ROOT)) {
  const relative = rel(file);
  const lines = fs.readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].includes(NEEDLE)) continue;

    const nearby = lines.slice(Math.max(0, i - 8), i + 1).join("\n");
    const allowed = relative === ALLOWED_FILE && nearby.includes(ALLOWLIST_MARKER);
    if (!allowed) {
      offenders.push(`${relative}:${i + 1}: ${lines[i].trim()}`);
    }
  }
}

if (offenders.length > 0) {
  console.error("FAIL [ORCH-0957] metered Supabase Storage render endpoint found outside legacy fallback:");
  console.error(offenders.map((line) => `  ${line}`).join("\n"));
  process.exit(1);
}

console.log("OK [ORCH-0957] no metered Supabase Storage render endpoint outside legacy fallback");
