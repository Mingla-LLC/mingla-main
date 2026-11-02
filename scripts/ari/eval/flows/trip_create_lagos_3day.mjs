/**
 * #3355 P10 — trip_create_lagos_3day (SPEC §7.4, P8).
 *
 * B-New's owner asks for "a 3-day trip to Lagos from 8 to 10 January",
 * names it, picks the departure and destination from the address search,
 * and confirms the create card. Asserts on the SAVED trip: the calendar days
 * are stored the way the Host trip editor stores them (first day 00:00:00 to
 * last day 23:59:59 in the trip's time zone), departure and destination are
 * the picked places, and no package/tier was invented.
 *
 * Mutation check: revert the trip seed truth (20280302003355, the
 * `biz_create_trip_draft` change that stopped creating a placeholder
 * package) and `pricing tiers` reads 1; make `trip_dates` store the start
 * day only and `last day` fails.
 */

import { compareFacts, driveFlow, place } from "./lib.mjs";

export const meta = {
  id: "trip_create_lagos_3day",
  brand: "new",
  account: "new_owner",
  capabilities: ["ari.trip.create"],
};

const ABUJA = place({
  venue: "Nnamdi Azikiwe International Airport",
  address: "Airport Road, Abuja",
  city: "Abuja",
  country: "NG",
  lat: 9.0068,
  lng: 7.2632,
});
const LAGOS = place({
  venue: "Lagos",
  address: "Lagos, Nigeria",
  city: "Lagos",
  country: "NG",
  lat: 6.5244,
  lng: 3.3792,
  featureType: "place",
});

export async function run(ctx) {
  const title = `Lagos Weekend ${ctx.suffix}`;
  const session = await ctx.session(meta.account, meta.brand);
  const state = await driveFlow(session, {
    start: () =>
      session.say("Create a 3-day trip to Lagos from 8 to 10 January"),
    confirmTools: ["create_trip"],
    script: {
      brand_can_wait: () => ({ choose: "not_now" }),
      trip_title: () => ({ answer: { response: title } }),
      trip_departure: () => ({ answer: { place: ABUJA }, text: ABUJA.city }),
      trip_destination: () => ({ answer: { place: LAGOS }, text: LAGOS.city }),
      trip_publish_ready: () => ({ stop: true }),
    },
  });
  const rows = await ctx.rest.select(
    "events",
    `select=id,title,status,event_type,timezone,departure_text,destination_text,destination_city,destination_country_code&brand_id=eq.${
      ctx.brands[meta.brand]
    }&title=eq.${encodeURIComponent(title)}&deleted_at=is.null`,
  );
  const trip = rows[0] ?? null;
  const dates = trip
    ? await ctx.rest.select(
      "event_dates",
      `select=start_at,end_at,timezone&event_id=eq.${trip.id}&order=start_at`,
    )
    : [];
  const tiers = trip
    ? await ctx.rest.select("trip_pricing_tiers", `select=id&event_id=eq.${trip.id}`)
    : [];
  const tickets = trip
    ? await ctx.rest.select("ticket_types", `select=id&event_id=eq.${trip.id}`)
    : [];
  const iso = (value) => value ? new Date(value).toISOString() : null;
  return {
    state,
    facts: compareFacts([
      { fact: "records with this title", expected: 1, actual: rows.length },
      { fact: "kind", expected: "trip", actual: trip?.event_type ?? null },
      { fact: "status", expected: "draft", actual: trip?.status ?? null },
      { fact: "date rows", expected: 1, actual: dates.length },
      {
        fact: "first day",
        expected: "2027-01-08T00:00:00.000Z",
        actual: iso(dates[0]?.start_at),
      },
      {
        fact: "last day",
        expected: "2027-01-10T23:59:59.000Z",
        actual: iso(dates[0]?.end_at),
      },
      {
        fact: "time zone (brand's, as the Host trip editor)",
        expected: "Europe/London",
        actual: trip?.timezone ?? null,
      },
      {
        fact: "departure",
        expected: (value) => typeof value === "string" && value.includes("Abuja"),
        label: "the picked Abuja place",
        actual: trip?.departure_text ?? null,
      },
      {
        fact: "destination",
        expected: (value) => typeof value === "string" && value.includes("Lagos"),
        label: "the picked Lagos place",
        actual: trip?.destination_text ?? null,
      },
      { fact: "pricing tiers invented", expected: 0, actual: tiers.length },
      { fact: "ticket types invented", expected: 0, actual: tickets.length },
    ]),
  };
}
