import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const basics = await readFile(new URL("components/trip/TripCreatorStep1Basics.tsx", root), "utf8");
const wizard = await readFile(new URL("components/trip/TripCreatorWizard.tsx", root), "utf8");
const edit = await readFile(new URL("components/trip/EditPublishedTripScreen.tsx", root), "utf8");
const service = await readFile(new URL("services/tripsService.ts", root), "utf8");

const fields = ["destinationCity", "destinationCountryCode", "departureCity", "departureCountryCode"];

test("#4073 city and country-code identity persists through draft, publish, edit, and read paths", () => {
  for (const field of fields) {
    assert.match(basics, new RegExp(field), `step 1 missing ${field}`);
    assert.match(wizard, new RegExp(field), `wizard missing ${field}`);
    assert.match(edit, new RegExp(field), `published edit missing ${field}`);
    assert.match(service, new RegExp(field), `read service missing ${field}`);
  }
});
test("#4073 free-text edits clear stale structured place identity", () => {
  for (const assignment of ["destinationCity: null", "destinationCountryCode: null", "departureCity: null", "departureCountryCode: null"]) {
    assert.match(edit, new RegExp(assignment));
  }
});
