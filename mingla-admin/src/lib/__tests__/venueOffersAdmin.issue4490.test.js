// #4490 P2-7 — Admin venue offers: the row words, the one action per status,
// plain error words, and that the console page itself stays free of writes
// (they live in the venue offers service, through the audited RPC).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  venueOfferAction,
  venueOfferAdminError,
  venueOfferFromPrice,
  venueOfferKindLabel,
  venueOfferStatus,
} from "../venueOffersAdmin.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, "..", "..", rel), "utf8");

test("statuses and kinds read in plain words", () => {
  assert.equal(venueOfferStatus("live").label, "On sale");
  assert.equal(venueOfferStatus("paused").label, "Paused");
  assert.equal(venueOfferStatus("weird").label, "Unknown");
  assert.equal(venueOfferKindLabel("entry", "walk_in"), "Entry · Walk-in");
  assert.equal(venueOfferKindLabel("private_hire", null), "Private hire");
});

test("price is minor units with the currency's exponent", () => {
  assert.equal(venueOfferFromPrice(400000, "NGN"), "from ₦4,000");
  assert.equal(venueOfferFromPrice(400050, "NGN"), "from ₦4,000.50");
  assert.equal(venueOfferFromPrice(null, "NGN"), "No price yet");
});

test("one action per row: pause a live offer, resume a paused one, nothing otherwise", () => {
  assert.deepEqual(venueOfferAction({ status: "live" }), { kind: "pause", label: "Pause", next: "paused" });
  assert.deepEqual(venueOfferAction({ status: "paused" }), { kind: "resume", label: "Resume", next: "live" });
  assert.equal(venueOfferAction({ status: "draft" }), null);
  assert.equal(venueOfferAction({ status: "archived" }), null);
});

test("server codes become plain words, never raw codes", () => {
  assert.equal(venueOfferAdminError("invalid_payload"), "Add a reason of at least 3 characters.");
  assert.match(venueOfferAdminError("offer_not_ready:no_schedule"), /no days on sale/);
  assert.equal(venueOfferAdminError("not_authorized"), "Active Admin access is required.");
  assert.doesNotMatch(venueOfferAdminError("boom_42"), /boom_42/);
});

test("the console page holds no write; the audited RPC sits in the venue offers service", () => {
  const page = read("pages/OfferingsConsolePage.jsx");
  assert.doesNotMatch(page, /supabase\.rpc\(/);
  assert.match(page, /VenueOffersAdminList/);
  const service = read("services/venueOffersAdminService.js");
  assert.match(service, /rpc\("admin_list_venue_offers"/);
  assert.match(service, /rpc\("issue_4490_admin_set_offer_status"/);
  assert.doesNotMatch(service, /\.(update|insert|delete|upsert)\(/);
  const list = read("components/offerings/VenueOffersAdminList.jsx");
  assert.match(list, /HighRiskActionModal/);
});

// #4490 P6 — a membership plan's hidden offering is labelled, and is run from
// the venue's plans (no pause / resume here).
test("P6: membership offerings read 'Membership plan' and have no moderation action", () => {
  assert.equal(venueOfferKindLabel("membership", null), "Membership plan");
  assert.equal(venueOfferAction({ kind: "membership", status: "live" }), null);
  assert.equal(venueOfferAction({ kind: "entry", status: "live" })?.kind, "pause");
});
