#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1237 — ADVERSARIAL regression for the ticket-address Google Maps
 * deep-link helper `buildMapsUrl`. DIFFERENT ANGLE from the happy-path test:
 * boundary/fuzz coordinate inputs, legacy-scheme-can-NEVER-return, and
 * label-independence.
 *
 * Like the implementor's happy-path test, TicketPdfSheet.tsx imports
 * react-native so it cannot be `import`ed under a plain node harness. We
 * therefore use the IDENTICAL extraction mechanism: read the real .tsx source,
 * extract the PURE `buildMapsUrl` body, strip TS annotations, and evaluate it
 * via `new Function` with a stubbed `Platform` in scope. This tests the REAL
 * shipped function body (not a copy), and provides `Platform` so that a
 * reverted Platform.OS-branching body still evaluates (and its Apple/geo
 * scheme output is then caught by the assertions below).
 *
 * A-1  For a battery of realistic + edge coords (negative/western/southern,
 *      high-precision decimals, 0/0, extremes), the URL NEVER contains a
 *      legacy `maps://` or `geo:` scheme — for ANY platform stub.
 * A-2  Every URL starts with https://www.google.com/maps/ and the
 *      `query=<lat>,<lng>` pair round-trips the inputs VERBATIM (lat first,
 *      comma-separated, no rounding/reordering).
 * A-3  The label argument has ZERO effect: null, "", spaces, ampersands,
 *      unicode — output is byte-identical, proving coords are the sole anchor
 *      and no unescaped label can break the URL.
 *
 * FAILS-ON-REVERT: restoring a Platform.OS branch that returns
 * `maps://?q=...&ll=...` (iOS) or `geo:<lat>,<lng>` (android) re-introduces
 * the legacy scheme → A-1 and A-2 both flip to FAIL on the relevant platform
 * run.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// app-mobile/src/components/activity/__tests__ → repo root is 6 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");

const SRC = fs.readFileSync(
  path.join(
    REPO_ROOT,
    "app-mobile/src/components/activity/TicketPdfSheet.tsx",
  ),
  "utf8",
);

// Identical extraction to the happy-path test: from `function buildMapsUrl`
// to the first standalone `}`.
function extractBuildMapsUrl(src) {
  const start = src.indexOf("function buildMapsUrl");
  assert.notEqual(start, -1, "buildMapsUrl must exist in TicketPdfSheet.tsx");
  const tail = src.slice(start);
  const endRel = tail.indexOf("\n}");
  assert.notEqual(endRel, -1, "could not find end of buildMapsUrl");
  return tail.slice(0, endRel + 2);
}

const fnSource = extractBuildMapsUrl(SRC);

// Strip TS annotations so plain node can eval it (mirrors happy-path test).
const jsSource = fnSource
  .replace(/export\s+/, "")
  .replace(/:\s*number/g, "")
  .replace(/:\s*string\s*\|\s*null/g, "")
  .replace(/\)\s*:\s*string\s*\{/, ") {");

function makeFn(platformOs) {
  const Platform = { OS: platformOs };
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    "Platform",
    `${jsSource}\nreturn buildMapsUrl;`,
  );
  return factory(Platform);
}

// ---- Coordinate battery: realistic + edge cases -------------------------
const COORDS = [
  // Realistic western/northern (negative lng — the explicit ask)
  { lat: 40.7484, lng: -73.9857 }, // Empire State Building, NYC
  { lat: 51.5007, lng: -0.1246 }, // Big Ben, London (small negative lng)
  // Southern + western hemisphere
  { lat: -33.8568, lng: 151.2153 }, // Sydney Opera House (southern)
  { lat: -22.9519, lng: -43.2105 }, // Christ the Redeemer (south + west)
  // Lagos (the app's home market)
  { lat: 6.4281, lng: 3.4219 },
  // High-precision decimals (must NOT be rounded)
  { lat: 6.428100123456789, lng: 3.421900987654321 },
  // Zero island / null island
  { lat: 0, lng: 0 },
  // Axis edges
  { lat: 0, lng: -180 },
  { lat: 90, lng: 180 },
  { lat: -90, lng: -180 },
  // Tiny magnitudes
  { lat: 0.0000001, lng: -0.0000001 },
];

// A large fuzz set via a loop (deterministic, covers all-sign quadrants).
for (let i = 0; i < 200; i++) {
  const lat = ((i * 7.13) % 180) - 90; // sweeps -90..+90, incl. negatives
  const lng = ((i * 11.37) % 360) - 180; // sweeps -180..+180, incl. negatives
  COORDS.push({ lat, lng });
}

// ---- Label battery: must have ZERO effect on output ----------------------
const LABELS = [
  null,
  "",
  "Simple Street",
  "12 Adeola Odeku St, Victoria Island, Lagos 101241, Nigeria",
  "Cafe & Bar #1 — spaces & ampersands & ?query=hack",
  "https://evil.example.com/?injected=1",
  "  leading and trailing spaces  ",
  "unicode: café ☕ naïve Ø 東京",
  "newline\nand\ttabs",
];

const LEGACY_SCHEME = /maps:\/\/|geo:/;

function run() {
  const platforms = ["ios", "android", undefined];

  for (const os of platforms) {
    const buildMapsUrl = makeFn(os);

    for (const { lat, lng } of COORDS) {
      // Baseline with the first label; all other labels must match it byte-for-byte.
      const baseline = buildMapsUrl(lat, lng, LABELS[0]);

      // A-1: never a legacy Apple/geo scheme, anywhere in the URL, any platform.
      assert.doesNotMatch(
        baseline,
        LEGACY_SCHEME,
        `A-1 [os=${os}] legacy maps://|geo: scheme leaked for (${lat},${lng}): ${baseline}`,
      );

      // A-2: canonical https google maps prefix.
      assert.match(
        baseline,
        /^https:\/\/www\.google\.com\/maps\//,
        `A-2 [os=${os}] must be https google.com/maps URL for (${lat},${lng}): ${baseline}`,
      );

      // A-2: query=<lat>,<lng> round-trips verbatim — lat first, comma sep,
      // no rounding, no reordering. Parse the actual query param and compare
      // the exact string the source produced from these inputs.
      const expectedPair = `${lat},${lng}`;
      const m = baseline.match(/[?&]query=([^&]+)/);
      assert.ok(
        m,
        `A-2 [os=${os}] URL has no query= param for (${lat},${lng}): ${baseline}`,
      );
      assert.equal(
        m[1],
        expectedPair,
        `A-2 [os=${os}] query must round-trip "${expectedPair}" verbatim, got "${m[1]}" in ${baseline}`,
      );

      // A-3: label-independence — every label yields byte-identical URL.
      for (const label of LABELS) {
        const withLabel = buildMapsUrl(lat, lng, label);
        assert.equal(
          withLabel,
          baseline,
          `A-3 [os=${os}] label=${JSON.stringify(label)} changed the URL for (${lat},${lng}): "${withLabel}" !== "${baseline}"`,
        );
      }
    }
  }

  const totalUrls = platforms.length * COORDS.length * LABELS.length;
  console.log(
    `ORCH-1237 adversarial (boundary + legacy-scheme-never + label-independence): PASS (A-1..A-3, ${COORDS.length} coords × ${LABELS.length} labels × ${platforms.length} platforms = ${totalUrls} URLs)`,
  );
}

run();
