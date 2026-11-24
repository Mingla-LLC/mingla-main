import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateInvite, venueGrantMatchesCategory } from "../index.ts";

const base = {
  brand_id: "11111111-1111-4111-8111-111111111111",
  invitee_email: "frontdesk@example.test",
  invitee_name: "Front Desk",
  role: "venue_staff",
};

Deno.test("venue staff invitation accepts a validated venue capability grant", () => {
  const result = validateInvite({
    ...base,
    venue_grants: [{
      venue_id: "22222222-2222-4222-8222-222222222222",
      access_profile: "front_desk",
      capabilities: [
        "stay.view_reservations",
        "stay.create_reservations",
        "stay.manage_reservations",
        "stay.view_availability",
      ],
    }],
  });

  assert(result.ok);
  if (!result.ok) return;
  assertEquals(result.payload.role, "venue_staff");
  assertEquals(result.payload.venue_grants.length, 1);
  assertEquals(result.payload.venue_grants[0].capabilities, [
    "stay.view_reservations",
    "stay.create_reservations",
    "stay.manage_reservations",
    "stay.view_availability",
  ]);
});

Deno.test("venue staff invitation rejects missing, duplicated, or unknown grants", () => {
  const missing = validateInvite(base);
  const duplicate = validateInvite({
    ...base,
    venue_grants: [
      {
        venue_id: "22222222-2222-4222-8222-222222222222",
        access_profile: "front_desk",
        capabilities: ["stay.view_reservations"],
      },
      {
        venue_id: "22222222-2222-4222-8222-222222222222",
        access_profile: "front_desk",
        capabilities: ["stay.view_availability"],
      },
    ],
  });
  const unknown = validateInvite({
    ...base,
    venue_grants: [{
      venue_id: "22222222-2222-4222-8222-222222222222",
      access_profile: "front_desk",
      capabilities: ["brand.manage_everything"],
    }],
  });

  for (const result of [missing, duplicate, unknown]) {
    assert(!result.ok);
    if (!result.ok) assert(result.fields.includes("venue_grants"));
  }
});

Deno.test("brand-wide roles cannot smuggle venue grants", () => {
  const result = validateInvite({
    ...base,
    role: "brand_admin",
    venue_grants: [{
      venue_id: "22222222-2222-4222-8222-222222222222",
      access_profile: "front_desk",
      capabilities: ["stay.view_reservations"],
    }],
  });

  assert(!result.ok);
  if (!result.ok) assert(result.fields.includes("venue_grants"));
});

Deno.test("venue grants must match the operational venue category", () => {
  const stayGrant = {
    venue_id: "22222222-2222-4222-8222-222222222222",
    access_profile: "front_desk",
    capabilities: ["stay.view_reservations"],
  };
  assert(venueGrantMatchesCategory(stayGrant, "stay"));
  assert(!venueGrantMatchesCategory(stayGrant, "restaurant"));
  // #4490 — a play venue takes restaurant.* / venue.* grants, never stay.*.
  assert(!venueGrantMatchesCategory(stayGrant, "play"));
  assert(
    !venueGrantMatchesCategory({
      ...stayGrant,
      access_profile: "custom",
      capabilities: ["restaurant.view_orders"],
    }, "stay"),
  );
});

// #4490 — venue.* capabilities and every non-stay venue type (20281203064490).
Deno.test("#4490 venue capabilities validate and match every non-stay venue type", () => {
  const result = validateInvite({
    ...base,
    venue_grants: [{
      venue_id: "22222222-2222-4222-8222-222222222222",
      access_profile: "custom",
      capabilities: ["venue.manage_offers", "venue.check_in", "restaurant.view_orders"],
    }],
  });
  assert(result.ok);
  if (!result.ok) return;
  const grant = result.payload.venue_grants[0];
  for (const category of ["restaurant", "play", "creative_and_arts", "bar_lounge", "club", "cafe", "event_space", "coworking"]) {
    assert(venueGrantMatchesCategory(grant, category), category);
  }
  assert(!venueGrantMatchesCategory(grant, "stay"));
  assert(!venueGrantMatchesCategory({ ...grant, access_profile: "front_desk" }, "play"));
  const unknown = validateInvite({
    ...base,
    venue_grants: [{
      venue_id: "22222222-2222-4222-8222-222222222222",
      access_profile: "custom",
      capabilities: ["venue.everything"],
    }],
  });
  assert(!unknown.ok);
});
