#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — #4334 · I-4334-NO-MAPBOX
 *
 * Mapbox is fully removed (Seth decision D7). No tracked file may mention it
 * except:
 *   ALLOWED TOKENS (anywhere):
 *     - `mapbox-geocode`   the address proxy's deployed function name, kept for
 *                          installed clients (one constant: ADDRESS_PROXY_FN);
 *     - `mapbox_lat`, `mapbox_lng`, `MapboxLat`, `MapboxLng`
 *                          the audit columns / trip JSON keys holding the
 *                          pre-#4334 pin (D2);
 *     - `mapboxId_retired`, `'mapboxId'`, `mapbox_id`
 *                          the retired-id error code / refused request key /
 *                          the legacy request alias the proxy answers 410.
 *   ALLOWED PATHS (history and recorded evidence):
 *     - supabase/migrations/** (applied history, never edited);
 *     - REPORTS.md (ship log), docs/INVARIANT_REGISTRY.md (frozen);
 *     - supabase/functions/mapbox-geocode/__tests__/fixtures/** (the recorded
 *       pre-#4334 answers kept as "before" values);
 *     - .github/ci-batch/MANIFEST.json (frozen workflow digests);
 *     - .github/scripts/ci-discovery/legacy-baseline.json (immutable, sealed
 *       candidate snapshot; deleted suites stay listed as history);
 *     - scripts/issue-4334/capture-rollback.sql (the pre-apply rollback
 *       generator must name the old `mapbox` health row and chat-plan columns
 *       it restores);
 *     - this gate and its registry descriptor.
 *   ALLOWED FILE NAMES (the name only; the contents are still scanned):
 *     - mingla-business/src/components/location/__tests__/
 *       mapboxAddressInputKeyboardCap{,.adversarial}.1027.test.ts — their
 *       jest commands are sealed, immutable assertion capabilities in
 *       .github/ci-batch/MANIFEST.json (Phase 2), so the files keep the name.
 *   [TRANSITIONAL] ALLOWED UNTIL THE LIVE SECRET IS UNSET:
 *     - supabase/secrets.manifest.json and
 *       scripts/secrets/issue_1436_secret_capacity_exit.adversarial.test.mjs
 *       still name MAPBOX_ACCESS_TOKEN because the secret is still set on the
 *       live project (spec v2 rollout step 7, ops cleanup: it stays until the rollback window
 *       closes). Exit condition: the PR that records the unset removes the
 *       manifest row, rewrites that test's fixture, and deletes these two
 *       entries.
 *
 * Exit codes: 0 pass · 1 fail · 2 git/fs error. --self-test checks the detector.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const ALLOWED_TOKENS = [
  /mapbox-geocode/gi,
  /mapbox_lat|mapbox_lng|MapboxLat|MapboxLng/g,
  /mapboxId_retired/g,
  /'mapboxId'/g,
  /\bmapbox_id\b/g,
  // the pre-#4334 shared field's path, kept as a sealed Phase 2 CI origin path
  // (byte-locked registry) and its reviewed liveness exemption.
  /packages\/location-input\/src\/MapboxAddressInput\.tsx/g,
];

export const ALLOWED_PATHS = [
  /^supabase\/migrations\//,
  /^REPORTS\.md$/,
  /^docs\/INVARIANT_REGISTRY\.md$/,
  /^supabase\/functions\/mapbox-geocode\/__tests__\/fixtures\//,
  /^\.github\/ci-batch\/MANIFEST\.json$/,
  /^\.github\/scripts\/ci-discovery\/legacy-baseline\.json$/,
  // [TRANSITIONAL] until MAPBOX_ACCESS_TOKEN is unset on the live project (see header).
  /^supabase\/secrets\.manifest\.json$/,
  /^scripts\/secrets\/issue_1436_secret_capacity_exit\.adversarial\.test\.mjs$/,
  // The rollback generator restores the pre-#4334 `mapbox` rows by name.
  /^scripts\/issue-4334\/capture-rollback\.sql$/,
  /^\.github\/scripts\/strict-grep\/i-no-mapbox\.mjs(\.gate\.json)?$/,
];

export const ALLOWED_FILE_NAMES = new Set([
  "mingla-business/src/components/location/__tests__/mapboxAddressInputKeyboardCap.1027.test.ts",
  "mingla-business/src/components/location/__tests__/mapboxAddressInputKeyboardCap.adversarial.1027.test.ts",
]);

const SKIP_EXT = /\.(svg|png|jpg|jpeg|gif|webp|ico|pdf|ttf|otf|woff2?|mp4|mov|zip|lock)$|package-lock\.json$|deno\.lock$/i;

/** Lines of `text` that still mention Mapbox after the allowed tokens are removed. */
export function offendingLines(text) {
  const hits = [];
  text.split("\n").forEach((line, i) => {
    let rest = line;
    for (const re of ALLOWED_TOKENS) rest = rest.replace(re, "");
    if (/mapbox/i.test(rest)) hits.push({ line: i + 1, text: line.trim().slice(0, 160) });
  });
  return hits;
}

export function pathAllowed(rel) {
  return ALLOWED_PATHS.some((re) => re.test(rel));
}

if (process.argv.includes("--self-test")) {
  const cases = [
    [offendingLines('export const ADDRESS_PROXY_FN = "mapbox-geocode";').length, 0],
    [offendingLines("  location_mapbox_lat double precision NULL,").length, 0],
    [offendingLines("RAISE ... DETAIL = 'p_place.mapboxId_retired';").length, 0],
    [offendingLines("import { MapboxAddressInput } from './x';").length, 1],
    [offendingLines("const url = 'https://api.mapbox.com/styles';").length, 1],
    [offendingLines("// Mapbox Search Box").length, 1],
    [pathAllowed("supabase/migrations/20260101_x.sql") ? 1 : 0, 1],
    [pathAllowed("app-mobile/src/x.ts") ? 1 : 0, 0],
  ];
  const bad = cases.filter(([got, want]) => got !== want);
  if (bad.length === 0) {
    console.log("SELF-TEST OK: I-4334-NO-MAPBOX detector behaves");
    process.exit(0);
  }
  console.error(`SELF-TEST FAIL: ${JSON.stringify(bad)}`);
  process.exit(1);
}

let files;
try {
  files = execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, maxBuffer: 256 * 1024 * 1024 })
    .toString("utf8").split("\0").filter(Boolean);
} catch (e) {
  console.error(`git error: ${e.message}`);
  process.exit(2);
}

let failures = 0;
for (const rel of files) {
  if (SKIP_EXT.test(rel) || pathAllowed(rel)) continue;
  const abs = path.join(REPO_ROOT, rel);
  if (/mapbox/i.test(rel) && !/mapbox-geocode/.test(rel) && !ALLOWED_FILE_NAMES.has(rel)) {
    failures += 1;
    console.error(`FAIL [I-4334-NO-MAPBOX] file name mentions Mapbox: ${rel}`);
  }
  let text;
  try {
    text = fs.readFileSync(abs, "utf8");
  } catch {
    continue; // deleted in the working tree
  }
  if (!/mapbox/i.test(text)) continue;
  for (const hit of offendingLines(text)) {
    failures += 1;
    console.error(`FAIL [I-4334-NO-MAPBOX] ${rel}:${hit.line}: ${hit.text}`);
  }
}
if (failures === 0) console.log("OK   [I-4334-NO-MAPBOX] no Mapbox reference outside the allowlist");
process.exit(failures > 0 ? 1 : 0);
