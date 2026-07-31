#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const files = {
  shell: "mingla-business/src/components/stay/StaySuiteShell.tsx",
  manager: "mingla-business/src/components/stay/StayInventoryManager.tsx",
  service: "mingla-business/src/services/stayInventoryService.ts",
  media: "mingla-business/src/services/stayMediaService.ts",
  types: "mingla-business/src/types/stayInventory.ts",
  migration:
    "supabase/migrations/20270131014250_issue_1425_stay_inventory_projection.sql",
};

const required = {
  shell: [
    "StayInventoryManager",
    "mode={",
    'activeModule === "rooms_places" ? "inventory" : "availability"',
  ],
  manager: [
    "bulkCreateStayOfferings",
    "changeStayOfferingStatus",
    "pickStayOfferingPhotos",
    "upsertStayRoomNights",
    "upsertStayPlaceSchedule",
    "materializeStayPlaceWindows",
    "upsertStayPlaceWindows",
    "formatCurrency",
    "minorFromMajor",
    "stayOfferingReadinessErrors",
  ],
  service: [
    'action: "create_offering"',
    'action: "bulk_create"',
    'action: "update_offering"',
    'action: "change_status"',
    'action: "set_price"',
    'action: "replace_fees"',
    'action: "set_policy"',
    'action: "attach_media"',
    'action: "remove_media"',
    'action: "upsert_room_nights"',
    'action: "upsert_place_schedule"',
    'action: "upsert_place_windows"',
  ],
  media: [
    'const BUCKET = "brand_covers"',
    "${input.brandId}/stays/${input.venueId}/",
    "storageObjectId: data.id",
    "upsert: false",
  ],
  types: [
    "roomNights?: StayRoomNightRecord[]",
    "placeScheduleRules?: StayPlaceScheduleRuleRecord[]",
    "placeWindows?: StayPlaceWindowRecord[]",
    "nextAvailability?: string | null",
  ],
  migration: [
    "'roomNights'",
    "public.stay_room_nights",
    "'placeScheduleRules'",
    "public.stay_place_schedule_rules",
    "'placeWindows'",
    "public.stay_place_windows",
    "'nextAvailability'",
    "REVOKE EXECUTE ON FUNCTION public.issue_1387_stay_inventory_snapshot(uuid)",
    "FROM anon",
  ],
};

function check(source) {
  const failures = [];
  for (const [key, needles] of Object.entries(required)) {
    for (const needle of needles) {
      if (!source[key]?.includes(needle)) {
        failures.push(`${files[key]} missing ${JSON.stringify(needle)}`);
      }
    }
  }
  for (const forbidden of ['"USD"', '"GBP"', '"hotel"', '"resort"']) {
    if (source.manager?.includes(forbidden)) {
      failures.push(
        `${files.manager} contains forbidden product/currency fallback ${forbidden}`,
      );
    }
  }
  if (/\.from\(\s*["']stay_/u.test(source.manager ?? "")) {
    failures.push(
      `${files.manager} bypasses the managed Stay inventory boundary`,
    );
  }
  if (
    (source.shell ?? "").includes(
      "Single and bulk Room/Place editors attach here",
    )
  ) {
    failures.push(`${files.shell} restored the #1424 placeholder`);
  }
  return failures;
}

function load() {
  return Object.fromEntries(
    Object.entries(files).map(([key, relative]) => [
      key,
      fs.readFileSync(path.join(root, relative), "utf8"),
    ]),
  );
}

if (process.argv.includes("--self-test")) {
  const good = Object.fromEntries(
    Object.entries(required).map(([key, needles]) => [key, needles.join("\n")]),
  );
  const baseline = check(good);
  if (baseline.length > 0) {
    console.error(
      `issue-1425 self-test fixture invalid:\n${baseline.join("\n")}`,
    );
    process.exit(2);
  }
  let reversions = 0;
  for (const [key, needles] of Object.entries(required)) {
    const bad = { ...good, [key]: good[key].replace(needles[0], "") };
    if (check(bad).length === 0) {
      console.error(`issue-1425 self-test missed ${key} reversion`);
      process.exit(1);
    }
    reversions += 1;
  }
  const directWrite = {
    ...good,
    manager: `${good.manager}\nsupabase.from("stay_offerings")`,
  };
  if (check(directWrite).length === 0) process.exit(1);
  reversions += 1;
  console.log(`issue-1425 self-test PASS (${reversions} reversions)`);
  process.exit(0);
}

try {
  const failures = check(load());
  if (failures.length > 0) {
    console.error(
      [
        "I-1425-STAY-ROOMS-PLACES violation:",
        ...failures.map((failure) => `- ${failure}`),
        "Restore the single managed Rooms/Places boundary; do not add a parallel hotel/resort product.",
      ].join("\n"),
    );
    process.exit(1);
  }
  console.log("I-1425-STAY-ROOMS-PLACES PASS");
} catch (error) {
  console.error(`I-1425-STAY-ROOMS-PLACES inconclusive: ${error.message}`);
  process.exit(2);
}
