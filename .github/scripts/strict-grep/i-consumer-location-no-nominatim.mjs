#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — META-ORCH-1060 [Mapbox consumer migration]
 * INV-1 · I-CONSUMER-LOCATION-NO-NOMINATIM
 *
 * The consumer app (app-mobile/src) must contain ZERO Nominatim /
 * OpenStreetMap geocoding references after the Mapbox migration. The clean
 * sweep is enforced permanently: any reintroduction of Nominatim (host string,
 * the legacy User-Agent, or the literal "nominatim") fails the PR.
 *
 * FORBID (case-insensitive) anywhere under app-mobile/src (.ts/.tsx):
 *   - "nominatim"
 *   - "nominatim.openstreetmap.org"
 *   - "Mingla-Mobile-App/1.0"   (the old Nominatim User-Agent)
 *
 * Pass condition: zero matches.
 *
 * Exit codes: 0 pass · 1 fail · 2 fs error
 * Self-test mode (--self-test) validates the detector against fixtures.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const SCAN_ROOT = path.join(REPO_ROOT, "app-mobile", "src");
const FORBIDDEN = [/nominatim/i, /nominatim\.openstreetmap\.org/i, /Mingla-Mobile-App\/1\.0/];

let failures = 0;
function fail(check, msg) {
  failures += 1;
  console.error(`FAIL [${check}] ${msg}`);
}
function ok(check, msg) {
  console.log(`OK   [${check}] ${msg}`);
}

function walk(dir, acc) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    console.error(`fs error reading ${dir}: ${e.message}`);
    process.exit(2);
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === "__snapshots__") continue;
      walk(full, acc);
    } else if (/\.(ts|tsx)$/.test(ent.name)) {
      acc.push(full);
    }
  }
}

function scanForbidden(text) {
  const hits = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const re of FORBIDDEN) {
      if (re.test(line)) hits.push({ line: i + 1, re: re.source });
    }
  });
  return hits;
}

function runSelfTest() {
  const bad = `const r = await fetch("https://nominatim.openstreetmap.org/search?q=" + q);`;
  const bad2 = `headers: { "User-Agent": "Mingla-Mobile-App/1.0" }`;
  const good = `const details = await forwardGeocodeMapbox(query, { invoke });`;
  let selfFail = 0;
  if (scanForbidden(bad).length === 0) {
    console.error("SELF-TEST FAIL: nominatim host not flagged");
    selfFail++;
  }
  if (scanForbidden(bad2).length === 0) {
    console.error("SELF-TEST FAIL: legacy User-Agent not flagged");
    selfFail++;
  }
  if (scanForbidden(good).length !== 0) {
    console.error("SELF-TEST FAIL: Mapbox line wrongly flagged");
    selfFail++;
  }
  if (selfFail > 0) {
    console.error(`SELF-TEST: ${selfFail} expectation(s) failed`);
    process.exit(1);
  }
  console.log("SELF-TEST OK: I-CONSUMER-LOCATION-NO-NOMINATIM detector behaves");
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
}

const files = [];
walk(SCAN_ROOT, files);

let total = 0;
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const hits = scanForbidden(text);
  if (hits.length > 0) {
    total += hits.length;
    const rel = path.relative(REPO_ROOT, file);
    for (const h of hits) {
      fail("INV-1: no-nominatim", `${rel}:${h.line} matches /${h.re}/i`);
    }
  }
}

if (total === 0) {
  ok("INV-1: no-nominatim", `scanned ${files.length} files under app-mobile/src — zero Nominatim/OSM references`);
}

process.exit(failures > 0 ? 1 : 0);
