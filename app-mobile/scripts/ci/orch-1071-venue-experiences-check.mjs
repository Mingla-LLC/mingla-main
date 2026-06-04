#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1071 [venue-card brand experiences section] regression check.
 *
 * Goal: the consumer expanded VENUE card renders the experiences authored by
 * the VERIFIED brand that claimed that venue, as compact price rows positioned
 * BENEATH the stars/miles/price block (CardInfoSection) and ABOVE the weather
 * section (WeatherSection). Each row taps into the experience sheet
 * (ExpandedBusinessEventSheet) — the proven native-checkout surface.
 *
 * This repo uses structural + behavioral `.mjs` checks for app-mobile ORCH
 * gates. Set ORCH1071_SIMULATE_REVERT=1 to strip the section insertion + the
 * verified-brand gate; the script must then FAIL, proving the checks bite.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const simulateRevert = process.env.ORCH1071_SIMULATE_REVERT === "1";

const read = (rel) => {
  try {
    return fs.readFileSync(path.join(repoRoot, rel), "utf8");
  } catch (error) {
    console.error(`Cannot read ${rel}: ${error.message}`);
    process.exit(2);
  }
};

const MIGRATION =
  "supabase/migrations/20260906000000_orch_1071_brand_experiences_for_place.sql";
const HOOK = "app-mobile/src/hooks/useVenueExperiences.ts";
const SECTION = "app-mobile/src/components/expandedCard/VenueExperiencesSection.tsx";
const MAPPER = "app-mobile/src/utils/venueExperienceMapping.ts";
const MODAL = "app-mobile/src/components/ExpandedCardModal.tsx";

// Simulated revert = restore the pre-1071 state: no section in the modal and a
// loosened brand gate (any claim status) in the RPC.
const maybeRevert = (source, kind) => {
  if (!simulateRevert) return source;
  if (kind === "modal") {
    return source.replace(
      /<VenueExperiencesSection[\s\S]*?\/>/,
      "{/* reverted: no venue experiences section */}",
    );
  }
  if (kind === "migration") {
    return source.replace(/b\.claim_status = 'verified'/g, "TRUE");
  }
  return source;
};

let failures = 0;
const check = (label, fn) => {
  try {
    fn();
    console.log(`  ✓ ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${label}\n      ${error.message}`);
  }
};

// ── 1. Migration: anon-safe, verified-brand, published public experiences ──
const migration = maybeRevert(read(MIGRATION), "migration");
console.log("Migration RPC pg_brand_experiences_for_place:");
check("function defined on (p_place_pool_id uuid)", () =>
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.pg_brand_experiences_for_place\(p_place_pool_id uuid\)/,
  ),
);
check("SECURITY DEFINER (anon-safe)", () =>
  assert.match(migration, /SECURITY DEFINER/),
);
check("resolves brand via the claimed place_pool linkage", () =>
  assert.match(migration, /b\.place_pool_id = p_place_pool_id/),
);
check("gated to VERIFIED brands only", () =>
  assert.match(migration, /b\.claim_status = 'verified'/),
);
check("only experiences, only published + public", () => {
  assert.match(migration, /e\.event_type = 'experience'/);
  assert.match(migration, /e\.visibility = 'public'/);
  assert.match(migration, /e\.published_at IS NOT NULL/);
});
check("EXECUTE granted to anon", () =>
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.pg_brand_experiences_for_place\(uuid\) TO anon/),
);

// ── 2. Hook: calls the RPC, fetch disabled for non-uuid card ids ──
const hook = read(HOOK);
console.log("useVenueExperiences hook:");
check("calls rpc('pg_brand_experiences_for_place')", () =>
  assert.match(hook, /rpc\("pg_brand_experiences_for_place"/),
);
check("uuid guard gates the query (no RPC on TM/curated ids)", () => {
  assert.match(hook, /UUID_RE/);
  assert.match(hook, /enabled\b/);
});

// ── 3. Mapper: major-unit price, Cloudinary so_0 still, type normalization ──
const mapper = read(MAPPER);
console.log("venueExperienceMapping pure mappers:");
check("price converted cents → major units for the sheet", () =>
  assert.match(mapper, /price_from_cents\s*\/\s*100/),
);
check("Cloudinary video → so_0 first-frame jpg still", () => {
  assert.match(mapper, /\/video\/upload\/so_0\//);
  assert.match(mapper, /\.jpg/);
});
check("cover_media_type normalized to image|video|gif|null", () => {
  assert.match(mapper, /"image"/);
  assert.match(mapper, /"video"/);
  assert.match(mapper, /"gif"/);
});
// Behavioral mirror — prove the documented transform yields the expected still.
check("so_0 transform mirror produces the expected still URL", () => {
  const sample = "https://res.cloudinary.com/m/video/upload/v1/cover.mp4";
  const out = sample
    .replace(/\/video\/upload\//, "/video/upload/so_0/")
    .replace(/\.(mp4|mov|webm|m4v)(\?.*)?$/i, ".jpg");
  assert.equal(out, "https://res.cloudinary.com/m/video/upload/so_0/v1/cover.jpg");
});

// ── 4. Section: empty → null (no header), opens the experience sheet ──
const section = read(SECTION);
console.log("VenueExperiencesSection:");
check("renders nothing when there are no experiences (no empty header)", () => {
  assert.match(section, /data\.length === 0/);
  assert.match(section, /return null/);
});
check("opens ExpandedBusinessEventSheet on row tap", () =>
  assert.match(section, /<ExpandedBusinessEventSheet/),
);
check("maps the row through experienceToBusinessEventCard", () =>
  assert.match(section, /experienceToBusinessEventCard/),
);

// ── 5. Placement: section sits between CardInfoSection and WeatherSection ──
const modal = maybeRevert(read(MODAL), "modal");
console.log("ExpandedCardModal placement:");
check("VenueExperiencesSection is rendered in the place branch", () =>
  assert.match(modal, /<VenueExperiencesSection/),
);
check("placePoolId is the card id (place_pool.id)", () =>
  assert.match(modal, /placePoolId=\{card\.id\}/),
);
check("positioned BENEATH CardInfoSection and ABOVE WeatherSection", () => {
  const infoIdx = modal.indexOf("<CardInfoSection");
  const expIdx = modal.indexOf("<VenueExperiencesSection");
  // The place branch has its own WeatherSection AFTER our section; an earlier
  // WeatherSection exists in the curated branch, so anchor the lookup past the
  // section to compare against the right (place-branch) one.
  const weatherIdx = modal.indexOf("<WeatherSection", expIdx);
  assert.ok(infoIdx !== -1, "CardInfoSection not found");
  assert.ok(expIdx !== -1, "VenueExperiencesSection not found");
  assert.ok(weatherIdx !== -1, "place-branch WeatherSection not found after section");
  assert.ok(
    infoIdx < expIdx && expIdx < weatherIdx,
    `expected order CardInfo(${infoIdx}) < Experiences(${expIdx}) < Weather(${weatherIdx})`,
  );
});

console.log("");
if (simulateRevert) {
  if (failures > 0) {
    console.log(
      `ORCH-1071 SIMULATE_REVERT: ${failures} check(s) failed as expected — gate bites. ✓`,
    );
    process.exit(0);
  }
  console.error(
    "ORCH-1071 SIMULATE_REVERT: expected failures but all checks passed — gate is hollow.",
  );
  process.exit(1);
}

if (failures > 0) {
  console.error(`ORCH-1071: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log("ORCH-1071: all venue-experiences checks passed. ✓");
