// #2829 W5 (amendment A1.3) — the history import script.
//  - the committed example is valid, invented, and names no real brand;
//  - only finished trips are history (in the trip's own timezone, date line
//    included); every record needs a source note; reviews point at trips in
//    the same file; keys are unique;
//  - local imports need the loopback stack; a production import needs the
//    production URL AND an explicit per-brand confirmation (Seth-owned);
//  - runs of the same trip become the block's series groups.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  PRODUCTION_CORE_URL,
  recordProblems,
  seriesGroups,
  targetProblems,
} from "../import-historical-trips.mjs";

const fixturePath = fileURLToPath(new URL("../local/fixtures/historical-import.neutral.json", import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const NOW = new Date("2026-10-26T12:00:00Z");

test("the committed example is valid and invented", () => {
  assert.deepEqual(recordProblems(fixture, NOW), []);
  assert.equal(fixture.brand_id, "00000000-0000-4000-8000-000000000000");
  for (const trip of fixture.trips) assert.match(trip.source_note, /Invented local fixture/);
  assert.doesNotMatch(readFileSync(fixturePath, "utf8"), /young|stamped|wetravel/i);
});

test("only finished trips are history, in the trip's own timezone", () => {
  const withTrip = (patch) => ({ ...fixture, reviews: [], trips: [{ ...fixture.trips[0], ...patch }] });
  assert.match(recordProblems(withTrip({ start_date: "2026-11-01", end_date: "2026-11-05" }), NOW).join(" "), /has not ended yet/);
  // 2026-10-26T12:00Z is already 27 October in Kiritimati (UTC+14): a trip ending 27 October has not ended there.
  assert.match(recordProblems(withTrip({ start_date: "2026-10-20", end_date: "2026-10-27", timezone: "Pacific/Kiritimati" }), NOW).join(" "), /has not ended yet/);
  assert.deepEqual(recordProblems(withTrip({ start_date: "2026-10-20", end_date: "2026-10-25", timezone: "Pacific/Kiritimati" }), NOW), []);
  assert.match(recordProblems(withTrip({ end_date: "2024-06-01" }), NOW).join(" "), /end_date/);
  assert.match(recordProblems(withTrip({ timezone: "Mars/Olympus" }), NOW).join(" "), /timezone/);
});

test("every record says where it comes from, keys are unique, reviews point at known trips", () => {
  const missingNote = { ...fixture, trips: [{ ...fixture.trips[0], source_note: "" }], reviews: [] };
  assert.match(recordProblems(missingNote, NOW).join(" "), /source_note is required/);
  const duplicate = { ...fixture, trips: [fixture.trips[0], { ...fixture.trips[1], import_key: fixture.trips[0].import_key }], reviews: [] };
  assert.match(recordProblems(duplicate, NOW).join(" "), /used twice/);
  const strayReview = { ...fixture, reviews: [{ ...fixture.reviews[0], trip_import_key: "fixture:nope" }] };
  assert.match(recordProblems(strayReview, NOW).join(" "), /does not name a trip/);
  const unconfirmed = { ...fixture, reviews: [{ ...fixture.reviews[0], confirmed_real: "yes" }] };
  assert.match(recordProblems(unconfirmed, NOW).join(" "), /confirmed_real must be true or false/);
});

test("local imports need the local stack; production needs the URL and a per-brand confirmation", () => {
  const brandId = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(targetProblems({ target: "local", apply: true, coreUrl: "http://127.0.0.1:55321", brandId }), []);
  assert.match(targetProblems({ target: "local", apply: true, coreUrl: PRODUCTION_CORE_URL, brandId }).join(" "), /loopback/);
  assert.match(targetProblems({ target: "production", apply: true, coreUrl: PRODUCTION_CORE_URL, brandId }).join(" "), /confirm-production-import/);
  assert.match(targetProblems({ target: "production", apply: true, confirm: "someone-else", coreUrl: PRODUCTION_CORE_URL, brandId }).join(" "), /confirm-production-import/);
  assert.deepEqual(targetProblems({ target: "production", apply: true, confirm: brandId, coreUrl: PRODUCTION_CORE_URL, brandId }), []);
  assert.deepEqual(targetProblems({ target: "production", apply: false, coreUrl: PRODUCTION_CORE_URL, brandId }), []);
  assert.match(targetProblems({ target: "production", apply: true, confirm: brandId, coreUrl: "https://elsewhere.supabase.co", brandId }).join(" "), /production Core URL/);
  assert.match(targetProblems({ target: "staging", coreUrl: PRODUCTION_CORE_URL, brandId }).join(" "), /--target/);
});

test("runs of the same trip become the block's series groups", () => {
  const mapping = {
    "fixture:coast-2024": { event_id: "a" },
    "fixture:ski-riverton": { event_id: "b" },
    "fixture:ski-lakeside": { event_id: "c" },
    "fixture:valley-2023": { event_id: "d" },
  };
  assert.deepEqual(seriesGroups(fixture.trips, mapping), [{ label: "Mountain ski series", offering_ids: ["b", "c"] }]);
});
