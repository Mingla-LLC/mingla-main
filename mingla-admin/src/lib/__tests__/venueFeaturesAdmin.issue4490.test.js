// #4490 — the Admin venue "Features" view: rows, wording, and that the read adds
// no write path. Runs under `node --test`.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FEATURE_LABELS,
  adminMoney,
  buildFeatureRows,
  buildOfferRows,
  buildSpaceRows,
  countFeaturesOn,
} from "../venueFeaturesAdmin.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, "..", "..", rel), "utf8");

const payload = {
  features: [
    { key: "entry", enabled: true, space_ids: null, blocked_by: [] },
    { key: "private_hire", enabled: true, space_ids: ["s1"], blocked_by: [] },
    { key: "floor_plan", enabled: true, space_ids: null, blocked_by: ["table_reservations"] },
    { key: "table_ordering", enabled: true, space_ids: null, blocked_by: ["menu", "space"] },
    { key: "menu", enabled: false, space_ids: null, blocked_by: [] },
    { key: "events_here", enabled: true, space_ids: ["gone"], blocked_by: [] },
  ],
  page: {
    features: ["entry", "private_hire", "events_here"],
    currencyCode: "NGN",
    minorUnitExponent: 2,
    spaces: [
      { id: "s1", name: "The Lounge Side", setting: "covered", capacityStanding: 150 },
      { id: "s2", name: "Main floor", setting: "indoor", capacityStanding: 600, capacitySeated: 200 },
    ],
    offers: [
      { id: "o1", kind: "entry", name: "Walk-in", fromMinor: 400000, confirmationMode: "instant" },
      { id: "o2", kind: "private_hire", name: "Lounge", fromMinor: 450050, confirmationMode: "request" },
    ],
  },
};

test("each feature row says on and live, on but waiting, or off, with its scope", () => {
  const rows = Object.fromEntries(buildFeatureRows(payload).map((r) => [r.key, r]));
  assert.equal(rows.entry.state, "on_live");
  assert.equal(rows.entry.scope, null); // every space
  assert.equal(rows.private_hire.state, "on_live");
  assert.deepEqual(rows.private_hire.scope, ["The Lounge Side"]);
  assert.equal(rows.floor_plan.state, "on_waiting");
  assert.deepEqual(rows.floor_plan.waitingOn, ["Table reservations"]);
  assert.deepEqual(rows.table_ordering.waitingOn, ["Menu", "a space"]);
  assert.equal(rows.menu.state, "off");
  assert.deepEqual(rows.events_here.scope, ["A space that is no longer active"]);
  assert.equal(countFeaturesOn(Object.values(rows)), 5);
});

test("labels use the contract's words and cover all 15 feature keys", () => {
  assert.equal(Object.keys(FEATURE_LABELS).length, 15);
  assert.equal(FEATURE_LABELS.group_packages, "Group packages");
  assert.equal(FEATURE_LABELS.by_the_hour, "By the hour");
  assert.ok(!JSON.stringify(FEATURE_LABELS).toLowerCase().includes("module"));
});

test("spaces show their capacity, offers show kind, from price, mode and status", () => {
  const spaces = buildSpaceRows(payload);
  assert.deepEqual(spaces.map((s) => s.capacity), ["150 standing", "600 standing · 200 seated"]);
  const offers = buildOfferRows(payload);
  assert.deepEqual(offers.map((o) => [o.kind, o.name, o.from, o.mode, o.status]), [
    ["Entry", "Walk-in", "₦4,000", "Instant", "On sale"],
    ["Private hire", "Lounge", "₦4,500.50", "On request", "On sale"],
  ]);
});

test("an empty or missing payload yields empty rows, never a throw", () => {
  assert.deepEqual(buildFeatureRows(null), []);
  assert.deepEqual(buildSpaceRows({}), []);
  assert.deepEqual(buildOfferRows(undefined), []);
  assert.equal(adminMoney(null, "NGN"), "—");
  assert.equal(adminMoney(100, null), "—");
});

test("the read is wired on the venue page with a visible failure state and no write path", () => {
  const page = read("pages/VenueDetailView.jsx");
  assert.match(page, /getAdminVenueFeatures\(venueId\)/);
  assert.match(page, /buildVenueFeatureSections\(data\.features\)/);
  // A failed features read degrades to null (a message), never an error page.
  assert.match(page, /features degraded/);
  const sections = read("components/venue/venueFeatureSections.jsx");
  assert.match(sections, /Features could not load/);
  const service = read("services/venueFeaturesAdminService.js");
  assert.match(service, /rpc\("admin_venue_features"/);
  assert.doesNotMatch(service, /\.(update|insert|delete|upsert)\s*\(/);
  // The Offerings console gate keeps venuesService read-only: this read lives beside it.
  assert.doesNotMatch(read("services/venuesService.js"), /admin_venue_features/);
});

// #4490 P6 — labels, never raw keys: offer kinds (membership included), space
// settings, and the venue's monthly/yearly plans.
test("P6/K: offer kinds and space settings are labels; plans list with their billing period", async () => {
  const mod = await import("../venueFeaturesAdmin.js");
  assert.equal(mod.offerKindLabel("membership"), "Membership plan");
  assert.equal(mod.offerKindLabel("by_the_hour"), "By the hour");
  assert.equal(mod.offerKindLabel("some_new_kind"), "Some new kind");
  const payload = {
    page: {
      currencyCode: "NGN",
      minorUnitExponent: 2,
      spaces: [{ id: "s", name: "Boardroom", setting: "indoor", capacitySeated: 10 }],
      memberships: { plans: [{ id: "p", name: "Hot desk", priceMinor: 8500000, interval: "month", full: false }, { id: "q", name: "Office", priceMinor: 52000000, interval: "year", full: true }] },
    },
  };
  assert.equal(mod.buildSpaceRows(payload)[0].setting, "Indoor");
  assert.deepEqual(
    mod.buildPlanRows(payload).map((p) => [p.name, p.price, p.period, p.status]),
    [["Hot desk", "₦85,000 a month", "Monthly", "On sale"], ["Office", "₦520,000 a year", "Yearly", "Full"]],
  );
});
