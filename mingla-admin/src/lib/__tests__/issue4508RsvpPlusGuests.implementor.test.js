// Issue #4508 1.26: the admin RSVP attendee view shows who invited each plus-one
// and whether they claimed, and tolerates guests with no name and no email.
//
// MINGLA-INVARIANT: I-4508-ADMIN-PLUS-GUESTS-NULL-SAFE | issue #4508 | Admin RSVP plus-one rows render invitedByName and claimed and never throw or print null for a guest with no name or email
//
// FAILS-ON-REVERT: restore the old `pg.name || pg.email` join in OfferingDetailView.jsx
// or drop the null guards in rsvpPlusGuests.js and these checks fail.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { describePlusGuest, plusGuestSummary } from "../rsvpPlusGuests.js";

test("a guest with no name and no email still reads as a person", () => {
  const d = describePlusGuest({ name: null, email: null, phone: "+2348012345678", invitedByName: "Ada O.", claimed: false });
  assert.equal(d.name, "Ada's guest");
  assert.equal(d.invitedBy, "Invited by Ada O.");
  assert.equal(d.claimLabel, "Not claimed");
  assert.equal(d.contact, "+2348012345678");
});

test("claimed guests and the Guest fallback", () => {
  assert.equal(describePlusGuest({ name: "Sam", claimed: true }).claimLabel, "Claimed");
  const bare = describePlusGuest({});
  assert.equal(bare.name, "Guest");
  assert.equal(bare.contact, null);
  assert.equal(describePlusGuest(null).name, "Guest");
  assert.equal(describePlusGuest({ name: "null", email: "undefined" }).name, "Guest");
});

test("summary never contains null or undefined", () => {
  const rows = plusGuestSummary([{ name: null, email: null, phone: null }, { name: "Sam", email: "s@x.co", claimed: true, invitedByName: "Ada O." }]);
  assert.equal(rows.length, 2);
  for (const r of rows) assert.ok(!/null|undefined/.test(r), r);
  assert.equal(plusGuestSummary(undefined).length, 0);
});

test("OfferingDetailView renders through the helper", () => {
  const src = readFileSync(new URL("../../pages/OfferingDetailView.jsx", import.meta.url), "utf8");
  assert.ok(src.includes("describePlusGuest(pg)"));
  assert.ok(src.includes("d.claimLabel"));
  assert.ok(!src.includes("pg.name || pg.email"));
});
