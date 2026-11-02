/**
 * #3355 P10 — venue_create_picker (SPEC §7.4, P9).
 *
 * B-New's owner asks for a venue, picks the place from the address search,
 * uses the place's own name and the suggested web address, picks Restaurant,
 * types the week's hours in one answer, types a phone number, and confirms
 * "Submit for review". Asserts on the SAVED venue: the picked place's
 * coordinates and address (never typed coordinates), the owner's hours for
 * all seven days, the phone, and status pending_review.
 *
 * Mutation check: make `createVenueArgs` (offerings/venue.ts) send the brand's
 * city instead of the pick's, or drop `hours`, and `address` / `hours rows`
 * fail; submit a verified listing instead of pending_review and `status`
 * fails.
 */

import { compareFacts, driveFlow, place } from "./lib.mjs";

export const meta = {
  id: "venue_create_picker",
  brand: "new",
  account: "new_owner",
  capabilities: ["ari.venue.create_listing"],
};

const PICKED_PLACE = place({
  venue: "Dishoom Shoreditch",
  address: "7 Boundary Street, London E2 7JE",
  city: "London",
  country: "GB",
  lat: 51.5246,
  lng: -0.0773,
});

// The Host's weekday numbering: Mon=0 … Sun=6 (brandsService).
const HOURS_TEXT = "Mon-Fri 12pm-11pm, Sat 10am-1am, Sun closed";

export async function run(ctx) {
  const session = await ctx.session(meta.account, meta.brand);
  let slug = null;
  const state = await driveFlow(session, {
    start: () => session.say("Create a venue"),
    confirmTools: ["create_venue_listing"],
    script: {
      brand_can_wait: () => ({ choose: "not_now" }),
      venue_place: () => ({ answer: { place: PICKED_PLACE }, text: PICKED_PLACE.venue_name }),
      venue_name: () => ({ choose: "use_place" }),
      venue_slug: (artefact) => {
        slug = (artefact.options ?? []).find((o) => o.id === "use_suggested")
          ?.label?.replace(/^Use\s+/, "") ?? null;
        return { choose: "use_suggested" };
      },
      venue_category: () => ({ choose: "restaurant" }),
      venue_hours: () => ({ answer: { response: HOURS_TEXT } }),
      venue_contact: () => ({ answer: { response: "+44 20 7123 4567" } }),
      venue_cover: () => ({ stop: true }),
    },
  });
  const rows = slug
    ? await ctx.rest.select(
      "venue_listings",
      `select=*&brand_id=eq.${ctx.brands[meta.brand]}&slug=eq.${slug}`,
    )
    : [];
  const venue = rows[0] ?? null;
  const hours = venue
    ? await ctx.rest.select(
      "brand_hours",
      `select=weekday,open_time,close_time,is_closed&venue_id=eq.${venue.id}&order=weekday`,
    )
    : [];
  const day = (weekday) => {
    const row = hours.find((candidate) => candidate.weekday === weekday);
    if (!row) return null;
    return row.is_closed
      ? "closed"
      : `${row.open_time?.slice(0, 5)}-${row.close_time?.slice(0, 5)}`;
  };
  return {
    state,
    facts: compareFacts([
      { fact: "records with this web address", expected: 1, actual: rows.length },
      { fact: "name", expected: PICKED_PLACE.venue_name, actual: venue?.name ?? null },
      { fact: "address", expected: PICKED_PLACE.address, actual: venue?.address ?? null },
      { fact: "city", expected: "London", actual: venue?.city ?? null },
      { fact: "lat (from the pick)", expected: PICKED_PLACE.lat, actual: venue?.lat ?? null },
      { fact: "lng (from the pick)", expected: PICKED_PLACE.lng, actual: venue?.lng ?? null },
      { fact: "category", expected: "restaurant", actual: venue?.venue_category ?? null },
      { fact: "status", expected: "pending_review", actual: venue?.claim_status ?? null },
      {
        fact: "phone",
        expected: "+442071234567",
        actual: venue?.contact_phone ?? null,
      },
      { fact: "hours rows", expected: 7, actual: hours.length },
      ...[0, 1, 2, 3, 4].map((weekday) => ({
        fact: `hours weekday ${weekday} (Mon=0)`,
        expected: "12:00-23:00",
        actual: day(weekday),
      })),
      { fact: "hours Saturday (overnight)", expected: "10:00-01:00", actual: day(5) },
      { fact: "hours Sunday", expected: "closed", actual: day(6) },
      {
        fact: "Ari asked for coordinates",
        expected: false,
        actual: state.texts.some((text) => /latitude|longitude/i.test(text)),
      },
    ]),
  };
}
