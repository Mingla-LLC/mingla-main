#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0809 mobile-side regression check.
 *
 * Mirrors the in-repo CI script pattern used by ORCH-0749 / ORCH-0751 (no
 * Jest infrastructure exists for app-mobile/; tests are Node assertions
 * against the on-disk source of truth).
 *
 * Asserts the M2 + M2.1 contracts that aren't fully covered by the
 * strict-grep gates:
 *   1. `NightOutCache` interface includes `fallbackActive: boolean`.
 *   2. `saveNightOutCache` writes `fallbackActive` into the cached payload.
 *   3. Cache-hit branch in `fetchNightOutEvents` restores fallbackActive via
 *      `setFallbackActive(cached.fallbackActive ?? false)`.
 *   4. Error catch branch in `fetchNightOutEvents` resets fallbackActive to false.
 *   5. AsyncStorage cache key includes city, segment, date, and genre.
 *   6. `selectedFilters` initial shape uses `segment` (not `price`).
 *   7. Service `search` method validates "exactly one of city or location".
 *   8. `CityPickerSheet` persists all five `discover_city_*` fields.
 *   9. `UserPreferences` type declares all five `discover_city_*` fields.
 *  10. Zustand registry shape uses `segment` (post-ORCH-0809-M2).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail });
};

const discover = read("src/components/DiscoverScreen.tsx");
const service = read("src/services/nightOutExperiencesService.ts");
const picker = read("src/components/discover/CityPickerSheet.tsx");
const prefs = read("src/types/preferences.ts");
const store = read("src/store/appStore.ts");

// 1 — NightOutCache interface includes fallbackActive.
check(
  "T-01 NightOutCache.fallbackActive field present",
  /interface\s+NightOutCache\s*\{[\s\S]*?fallbackActive\s*:\s*boolean/.test(
    discover,
  ),
  "DiscoverScreen.tsx: NightOutCache interface must include `fallbackActive: boolean` (ORCH-0809 M2.1 P1-1 fix)",
);

// 2 — saveNightOutCache writes fallbackActive.
check(
  "T-02 saveNightOutCache writes fallbackActive into payload",
  /saveNightOutCache\s*=\s*async\s*\([^)]*fallbackActiveAtSave\s*:\s*boolean/.test(
    discover,
  ) && /fallbackActive\s*:\s*fallbackActiveAtSave/.test(discover),
  "DiscoverScreen.tsx: saveNightOutCache must accept and write fallbackActiveAtSave",
);

// 3 — Cache-hit branch restores fallbackActive.
check(
  "T-03 cache-hit branch restores fallbackActive via cached.fallbackActive ?? false",
  /setFallbackActive\s*\(\s*cached\.fallbackActive\s*\?\?\s*false\s*\)/.test(
    discover,
  ),
  "DiscoverScreen.tsx: cache-hit branch must call setFallbackActive(cached.fallbackActive ?? false) (M2.1 P1-1)",
);

// 4 — Error catch branch resets fallbackActive.
check(
  "T-04 error catch branch resets fallbackActive to false",
  /catch\s*\(\s*err[\s\S]*?setFallbackActive\s*\(\s*false\s*\)/.test(discover),
  "DiscoverScreen.tsx: catch block must call setFallbackActive(false) (M2.1 P2-1)",
);

// 5 — AsyncStorage cache key includes city + segment + date + genre.
// The cache key composes from two templates: `nightOutCityKey` (city:<name> OR
// geo:<lat>:<lng>) and the main `nightOutCacheKey` (which interpolates
// nightOutCityKey + seg: + date: + gen:). Verify all four tokens are present
// somewhere in the file AND that the main key contains seg:, date:, and gen:
// directly (city: must come from the cityKey path).
check(
  "T-05 AsyncStorage cache key includes all four filter dimensions",
  /city:\$\{/.test(discover) &&
    /nightOutCacheKey\s*=\s*`[^`]*seg:\$\{[^`]*date:\$\{[^`]*gen:\$\{/.test(
      discover,
    ),
  "DiscoverScreen.tsx: nightOutCityKey must compose `city:${...}` AND nightOutCacheKey must include seg:, date:, and gen: tokens (M2 hotfixes)",
);

// 6 — selectedFilters initial shape uses segment, not price.
check(
  "T-06 selectedFilters initial shape uses segment (not price)",
  /\{\s*date:\s*["']any["'],\s*segment:\s*["']music["'],\s*genre:\s*["']all["']\s*\}/.test(
    discover,
  ),
  "DiscoverScreen.tsx: selectedFilters default must be { date: 'any', segment: 'music', genre: 'all' } (M2 surgery)",
);

// 7 — Service search method validates exactly one of city or location.
check(
  "T-07 service search validates `exactly one of city or location`",
  /pass either city or location, not both/.test(service) &&
    /city or location is required/.test(service),
  "nightOutExperiencesService.ts: search() must validate exactly-one-of city/location (M2 + M2.1)",
);

// 8 — CityPickerSheet persists all five discover_city_* fields.
check(
  "T-08 CityPickerSheet persists all five discover_city_* fields",
  /discover_city_name\s*:[\s\S]*?discover_city_state_code\s*:[\s\S]*?discover_city_country_code\s*:[\s\S]*?discover_city_lat\s*:[\s\S]*?discover_city_lng\s*:/.test(
    picker,
  ),
  "CityPickerSheet.tsx: handlePick must call updateUserPreferences with all five discover_city_* fields",
);

// 9 — UserPreferences declares all five discover_city_* fields.
check(
  "T-09 UserPreferences type declares all five discover_city_* fields",
  /discover_city_name\?\s*:\s*string\s*\|\s*null/.test(prefs) &&
    /discover_city_state_code\?\s*:\s*string\s*\|\s*null/.test(prefs) &&
    /discover_city_country_code\?\s*:\s*string\s*\|\s*null/.test(prefs) &&
    /discover_city_lat\?\s*:\s*number\s*\|\s*null/.test(prefs) &&
    /discover_city_lng\?\s*:\s*number\s*\|\s*null/.test(prefs),
  "preferences.ts: UserPreferences interface must declare all five discover_city_* optional nullable fields",
);

// 10 — Zustand registry shape uses segment.
check(
  "T-10 Zustand discoverFilters registry shape uses `segment`",
  /discoverFilters\s*:\s*\{\s*date:\s*string;\s*segment:\s*string;\s*genre:\s*string\s*\}/.test(
    store,
  ),
  "appStore.ts: discoverFilters shape must be { date, segment, genre } — `price` field removed (M2 surgery)",
);

// ─── Report ─────────────────────────────────────────────────────────────────

let failed = 0;
for (const c of checks) {
  if (c.pass) {
    console.log(`  PASS  ${c.name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${c.name}`);
    console.error(`        ${c.detail}`);
  }
}
console.log(`\nORCH-0809 regression check: ${checks.length - failed}/${checks.length} passed.`);
process.exit(failed > 0 ? 1 : 0);
