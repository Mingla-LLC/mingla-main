// #4490 spec 08 O1 — the Team invite carries the Till capabilities and the
// "Till device" profile (server: 20281203504490 grant CHECKs and validator).
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateInvite, venueGrantMatchesCategory } from "../index.ts";

const base = {
  brand_id: "11111111-1111-4111-8111-111111111111",
  invitee_email: "till@example.test",
  invitee_name: "Till Device",
  role: "venue_staff",
};
const tillGrant = {
  venue_id: "22222222-2222-4222-8222-222222222222",
  access_profile: "till_device",
  capabilities: ["venue.till_device", "venue.sell", "venue.kitchen", "venue.check_in"],
};

Deno.test("O1-I1 a Till device invite is accepted with its four capabilities", () => {
  const result = validateInvite({ ...base, venue_grants: [tillGrant] });
  assert(result.ok);
  if (!result.ok) return;
  assertEquals(result.payload.venue_grants[0].access_profile, "till_device");
  assertEquals(result.payload.venue_grants[0].capabilities, tillGrant.capabilities);
});

Deno.test("O1-I2 the Till device profile fits every non-Stay venue type; an unknown capability is refused", () => {
  const ok = validateInvite({ ...base, venue_grants: [tillGrant] });
  assert(ok.ok);
  if (!ok.ok) return;
  assert(venueGrantMatchesCategory(ok.payload.venue_grants[0], "bar_lounge"));
  const bad = validateInvite({ ...base, venue_grants: [{ ...tillGrant, capabilities: ["venue.sell", "venue.sell_everything"] }] });
  assertFalse(bad.ok);
});
