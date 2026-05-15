#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0839-A regression check — mobile AsyncStorage cache permanently removed.
 *
 * Asserts the F-4 fix from SPEC_ORCH-0839-A_DISCOVER_HARDENING.md:
 *
 *   app-mobile/src/components/DiscoverScreen.tsx MUST NOT contain
 *   `NightOutCache` (interface), `loadNightOutCache` / `saveNightOutCache`
 *   / `clearNightOutCache` (helpers), `nightOutCacheKey` (key derivation),
 *   or the cache-hit short-circuit predicate `cached.venues.length > 0`.
 *   The merged-discover state is fetched fresh on every filter change;
 *   server caches authoritatively.
 *
 *   ALSO: the prior orch-0835-regression-check.mjs gate MUST NOT exist —
 *   it's superseded by this gate.
 *
 * Invariant codified: I-PROPOSED-DISCOVER-NO-MOBILE-CACHE.
 * Invariant retired: I-PROPOSED-DISCOVER-CACHE-SYMMETRY (ORCH-0835) — moot
 * now that the cache is gone.
 *
 * Exit 1 on any FAIL. 5 contracts (T-C0, T-C1, T-C2, T-C3, T-C4).
 *
 * Notes on the regex strategy: protective comments in DiscoverScreen.tsx
 * may mention the removed mechanism in prose ("mobile cache", "TM cache
 * table") but MUST NOT use the verbatim identifier strings. The gate
 * uses identifier-anchored patterns (e.g. `\bNightOutCache\b` not
 * `mobile cache`) so protective comments describing the removal in
 * natural language are allowed.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

const readMaybe = (absRel) => {
  try {
    return fs.readFileSync(absRel, "utf8");
  } catch {
    return null;
  }
};

const fileExists = (absRel) => {
  try {
    fs.accessSync(absRel, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail });
};

const discover = readMaybe(
  path.join(root, "src/components/DiscoverScreen.tsx"),
);

// ─── T-C0: NightOutCache interface gone ──────────────────────────────────

check(
  "T-C0 DiscoverScreen.tsx does NOT contain NightOutCache",
  discover !== null && !/\bNightOutCache\b/.test(discover),
  "app-mobile/src/components/DiscoverScreen.tsx MUST NOT contain the identifier `NightOutCache`. The interface was deleted in F-4. If you need to describe the removal, use a different word in the protective comment (e.g. 'local cache interface'). Invariant: I-PROPOSED-DISCOVER-NO-MOBILE-CACHE.",
);

// ─── T-C1: cache helpers + key derivation gone ───────────────────────────

check(
  "T-C1 DiscoverScreen.tsx does NOT contain loadNightOutCache, saveNightOutCache, clearNightOutCache, or nightOutCacheKey",
  discover !== null &&
    !/\bloadNightOutCache\b/.test(discover) &&
    !/\bsaveNightOutCache\b/.test(discover) &&
    !/\bclearNightOutCache\b/.test(discover) &&
    !/\bnightOutCacheKey\b/.test(discover),
  "app-mobile/src/components/DiscoverScreen.tsx MUST NOT contain `loadNightOutCache`, `saveNightOutCache`, `clearNightOutCache`, or `nightOutCacheKey`. All four were deleted in F-4. Protective comments describing the removal MUST use different wording (the orch-0839-a spec uses 'loader/saver/clearer' in prose).",
);

// ─── T-C2: cache-hit predicate gone ──────────────────────────────────────

check(
  "T-C2 DiscoverScreen.tsx does NOT contain the cache-hit predicate `cached.venues.length > 0`",
  discover !== null && !/cached\.venues\.length\s*>\s*0/.test(discover),
  "app-mobile/src/components/DiscoverScreen.tsx MUST NOT contain the cache-hit short-circuit predicate `cached.venues.length > 0` (or its ORCH-0835 extension with `businessEvents.length > 0`). The entire short-circuit was removed in F-4.",
);

// ─── T-C3: the ORCH-0839-A F-4 marker is present (positive assertion) ────

check(
  "T-C3 DiscoverScreen.tsx contains the ORCH-0839-A F-4 marker comment in fetchNightOutEvents",
  discover !== null &&
    /ORCH-0839-A F-4[\s\S]{0,500}?skipCache/.test(discover),
  "app-mobile/src/components/DiscoverScreen.tsx fetchNightOutEvents MUST contain the protective comment `ORCH-0839-A F-4` explaining why the cache is gone. This positive assertion protects against silent re-introduction of mobile caching without a follow-up spec.",
);

// ─── T-C4: orch-0835-regression-check.mjs is deleted ─────────────────────

check(
  "T-C4 app-mobile/scripts/ci/orch-0835-regression-check.mjs does NOT exist (deleted)",
  !fileExists(path.join(root, "scripts/ci/orch-0835-regression-check.mjs")),
  "The ORCH-0835 cache-symmetry CI gate must be deleted as part of this ORCH. Its invariant (I-PROPOSED-DISCOVER-CACHE-SYMMETRY) is retired in favor of I-PROPOSED-DISCOVER-NO-MOBILE-CACHE.",
);

// ─── Report ────────────────────────────────────────────────────────────────

console.log("\nORCH-0839-A mobile cache removed regression check\n");
let failed = 0;
for (const c of checks) {
  const tag = c.pass ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${c.name}`);
  if (!c.pass) {
    console.log(`         ${c.detail}`);
    failed += 1;
  }
}
console.log(
  `\nSummary: ${checks.length - failed}/${checks.length} PASS${
    failed > 0 ? ` (${failed} FAIL)` : ""
  }\n`,
);
process.exit(failed > 0 ? 1 : 0);
