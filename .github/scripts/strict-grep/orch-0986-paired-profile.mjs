#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

let failures = 0;
function fail(check, message) {
  failures += 1;
  console.error(`FAIL [${check}] ${message}`);
}
function ok(check, message) {
  console.log(`OK   [${check}] ${message}`);
}
function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const profilePath = "app-mobile/src/components/profile/ViewFriendProfileScreen.tsx";
const holidayPath = "app-mobile/src/components/PersonHolidayView.tsx";
const servicePath = "app-mobile/src/services/personHeroCardsService.ts";
const singleEdgePath = "supabase/functions/get-person-hero-cards/index.ts";
const batchedEdgePath = "supabase/functions/get-paired-profile-cards/index.ts";

const profile = read(profilePath);
const holiday = read(holidayPath);
const service = read(servicePath);
const singleEdge = read(singleEdgePath);
const batchedEdge = read(batchedEdgePath);

if (/<Icon[^>]+name=["']heart/.test(profile) || /saveProfile|profileSave|saveButton/i.test(profile)) {
  fail("C1: no-profile-heart-save", `${profilePath} contains a heart/save profile control.`);
} else {
  ok("C1: no-profile-heart-save", "profile hero has no heart/save control");
}

if (/location\s*:/.test(service) || /useUserLocation/.test(profile)) {
  fail("C2: no-client-location-param", "paired cards still pass client location or read viewer location.");
} else if (!/resolveFriendLocation/.test(singleEdge) || !/resolveFriendLocation/.test(batchedEdge)) {
  fail("C2: no-client-location-param", "edge functions must resolve friend GPS server-side.");
} else {
  ok("C2: no-client-location-param", "paired cards use server-side friend GPS only");
}

if (/Ideal night out/i.test(profile) || /Ideal night out/i.test(holiday)) {
  fail("C3: no-ideal-night-out", "profile components contain forbidden Ideal night out copy.");
} else {
  ok("C3: no-ideal-night-out", "Ideal night out copy absent");
}

if (failures > 0) {
  console.error(`\nORCH-0986 strict-grep failed with ${failures} failure(s).`);
  process.exit(1);
}

console.log("\nORCH-0986 strict-grep passed.");
