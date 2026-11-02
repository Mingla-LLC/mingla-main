/**
 * #3355 P10 — experience_create_two_stops (SPEC §7.4, P9).
 *
 * B-New's owner asks for an experience, gives its name, description and
 * vibe, adds two stops (name, what happens, a place from the address search
 * with its search id), the date and times, says Free, and confirms the one
 * create card. Asserts on the SAVED experience and its stops: the stops are
 * the owner's, in order, at the picked places; free; one record.
 *
 * Mutation check: drop the second stop from `experience_create`'s tool_args
 * (or stop carrying `place_id` from the pick in `parseFlowPlace`) and `stop
 * count` / `stop 2 place id` fail; make the price default to paid and
 * `whole price` fails.
 */

import { compareFacts, driveFlow, place } from "./lib.mjs";

export const meta = {
  id: "experience_create_two_stops",
  brand: "new",
  account: "new_owner",
  capabilities: ["ari.experience.create"],
};

const DESCRIPTION = "A slow evening walk through Spitalfields with two tastings.";
const STOPS = [
  {
    name: "Market welcome",
    description: "Meet the group and taste fresh bread.",
    place: place({
      venue: "Old Spitalfields Market",
      address: "16 Horner Square, London E1 6EW",
      city: "London",
      country: "GB",
      lat: 51.5197,
      lng: -0.0754,
      placeId: "dXJuOm1ieHBvaTpmbG93ZXZhbDE",
    }),
  },
  {
    name: "Cheese cellar",
    description: "Three cheeses and a short talk.",
    place: place({
      venue: "Neal's Yard Dairy",
      address: "9 Park Street, London SE1 9AB",
      city: "London",
      country: "GB",
      lat: 51.5054,
      lng: -0.0909,
      placeId: "dXJuOm1ieHBvaTpmbG93ZXZhbDI",
    }),
  },
];

export async function run(ctx) {
  const title = `Spitalfields Walk ${ctx.suffix}`;
  const session = await ctx.session(meta.account, meta.brand);
  let stopIndex = 0;
  const state = await driveFlow(session, {
    start: () => session.say("Create an experience"),
    confirmTools: ["create_experience"],
    script: {
      brand_can_wait: () => ({ choose: "not_now" }),
      experience_title: () => ({ answer: { response: title } }),
      experience_description: () => ({ answer: { response: DESCRIPTION } }),
      experience_vibe: () => ({ answer: { choices: ["Group Fun"] } }),
      experience_stop_name: () => ({
        answer: { response: STOPS[stopIndex].name },
      }),
      experience_stop_description: () => ({
        answer: { response: STOPS[stopIndex].description },
      }),
      experience_stop_place: () => {
        const stop = STOPS[stopIndex];
        stopIndex += 1;
        return { answer: { place: stop.place }, text: stop.place.venue_name };
      },
      experience_stop_more: () =>
        stopIndex < STOPS.length ? { choose: "another" } : { choose: "done" },
      experience_start: () => ({
        answer: { response: "Saturday 12 December 2026 at 2pm" },
      }),
      experience_end: () => ({ answer: { response: "5pm" } }),
      experience_price_kind: () => ({ choose: "free" }),
      experience_publish: () => ({ stop: true }),
    },
  });
  const rows = await ctx.rest.select(
    "events",
    `select=id,title,status,event_type,description,experience_intents,timezone,whole_price_cents,theme&brand_id=eq.${
      ctx.brands[meta.brand]
    }&title=eq.${encodeURIComponent(title)}&deleted_at=is.null`,
  );
  const experience = rows[0] ?? null;
  const stops = experience
    ? await ctx.rest.select(
      "experience_stops",
      `select=*&event_id=eq.${experience.id}`,
    )
    : [];
  const ordered = [...stops].sort((a, b) => a.stop_order - b.stop_order);
  // A draft experience keeps its date the way the Host wizard does.
  const whenDraft = experience?.theme?.experience_meta?.when_draft ?? {};
  return {
    state,
    stops: ordered,
    facts: compareFacts([
      { fact: "records with this title", expected: 1, actual: rows.length },
      { fact: "kind", expected: "experience", actual: experience?.event_type ?? null },
      { fact: "status", expected: "draft", actual: experience?.status ?? null },
      { fact: "description", expected: DESCRIPTION, actual: experience?.description ?? null },
      {
        fact: "vibe",
        expected: ["group-fun"],
        actual: experience?.experience_intents ?? null,
      },
      { fact: "stop count", expected: 2, actual: ordered.length },
      ...STOPS.flatMap((stop, index) => [
        {
          fact: `stop ${index + 1} name`,
          expected: stop.name,
          actual: ordered[index]?.place_name ?? null,
        },
        {
          fact: `stop ${index + 1} what happens`,
          expected: stop.description,
          actual: ordered[index]?.ai_description ?? null,
        },
        {
          fact: `stop ${index + 1} address`,
          expected: stop.place.address,
          actual: ordered[index]?.address ?? null,
        },
        {
          fact: `stop ${index + 1} place id`,
          expected: stop.place.place_id,
          actual: ordered[index]?.place_id ?? null,
        },
      ]),
      { fact: "date", expected: "2026-12-12", actual: whenDraft.when?.date ?? null },
      { fact: "start time", expected: "14:00", actual: whenDraft.when?.doorsOpen ?? null },
      { fact: "end time", expected: "17:00", actual: whenDraft.when?.endsAt ?? null },
      { fact: "time zone", expected: "Europe/London", actual: whenDraft.timezone ?? null },
      {
        fact: "whole price",
        expected: 0,
        actual: experience?.whole_price_cents ?? null,
      },
    ]),
  };
}
