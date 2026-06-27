#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1237 — ticket address must deep-link to Google Maps (not Apple Maps)
 * and work identically on iOS + Android.
 *
 * TicketPdfSheet.tsx imports react-native, so it cannot be `import`ed under a
 * plain node harness. Instead we extract the PURE `buildMapsUrl` function body
 * from the source and evaluate it directly (it has no RN dependency in its
 * body after the ORCH-1237 fix). We run the extracted helper twice — once with
 * a stubbed `Platform.OS = "ios"` and once with `"android"` in scope — to prove
 * the output is identical and platform-independent.
 *
 * T-1  buildMapsUrl returns a https://www.google.com/maps URL containing the
 *      exact "<lat>,<lng>" query, on BOTH iOS and Android.
 * T-2  buildMapsUrl NEVER returns an Apple Maps `maps://` scheme (the old bug).
 * T-3  The source no longer branches on Platform.OS for the maps URL.
 *
 * FAILS-ON-REVERT: restoring the Platform.OS branch that returns
 * `maps://?q=...&ll=...` on iOS re-introduces the `maps://` scheme → T-1/T-2
 * flip and the extraction either yields the Apple scheme on the iOS run.
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

// Extract the `buildMapsUrl` function body from `(` after the params to the
// closing brace of the function. We match the function declaration and grab
// everything up to the first standalone `}` at column 0 that ends it.
function extractBuildMapsUrl(src) {
  const start = src.indexOf("function buildMapsUrl");
  assert.notEqual(start, -1, "buildMapsUrl must exist in TicketPdfSheet.tsx");
  // The function ends at the first line that is exactly "}".
  const tail = src.slice(start);
  const endRel = tail.indexOf("\n}");
  assert.notEqual(endRel, -1, "could not find end of buildMapsUrl");
  return tail.slice(0, endRel + 2);
}

const fnSource = extractBuildMapsUrl(SRC);

// Build a callable from the extracted TS source. Strip the TS type
// annotations (param types + return type) so plain node can eval it.
const jsSource = fnSource
  .replace(/export\s+/, "")
  .replace(/:\s*number/g, "")
  .replace(/:\s*string\s*\|\s*null/g, "")
  .replace(/\)\s*:\s*string\s*\{/, ") {");

function makeFn(platformOs) {
  // `Platform` is provided in scope so that IF the reverted code references
  // Platform.OS, the extracted function still evaluates (and would return the
  // Apple Maps scheme on iOS — which the assertions then catch).
  const Platform = { OS: platformOs };
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    "Platform",
    `${jsSource}\nreturn buildMapsUrl;`,
  );
  return factory(Platform);
}

function run() {
  const lat = 6.4281;
  const lng = 3.4219;
  const label = "12 Adeola Odeku St, Victoria Island, Lagos 101241, Nigeria";

  for (const os of ["ios", "android"]) {
    const buildMapsUrl = makeFn(os);
    const url = buildMapsUrl(lat, lng, label);

    // T-1: canonical cross-platform Google Maps link with the exact coords.
    assert.match(
      url,
      /^https:\/\/www\.google\.com\/maps\//,
      `T-1 [${os}] must be a https google.com/maps URL, got: ${url}`,
    );
    assert.ok(
      url.includes(`${lat},${lng}`),
      `T-1 [${os}] URL must contain "${lat},${lng}", got: ${url}`,
    );

    // T-2: never the Apple Maps scheme (the reported bug).
    assert.doesNotMatch(
      url,
      /^maps:\/\//,
      `T-2 [${os}] must NOT be an Apple Maps maps:// scheme, got: ${url}`,
    );
    assert.doesNotMatch(
      url,
      /^geo:/,
      `T-2 [${os}] must NOT be a geo: scheme, got: ${url}`,
    );
  }

  // T-3: the source no longer branches on Platform.OS inside buildMapsUrl.
  assert.doesNotMatch(
    fnSource,
    /Platform\.OS/,
    "T-3 buildMapsUrl must not branch on Platform.OS (universal link)",
  );

  console.log(
    "ORCH-1237 ticket address → Google Maps deep-link: PASS (T-1..T-3)",
  );
}

run();
