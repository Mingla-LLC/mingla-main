/**
 * #3355 P10 — event_create_minimal (SPEC §7.4, Script A).
 *
 * B-New's owner asks Ari for an event and answers each card the way the Host
 * does (start, end, format, picked place), then confirms the one create card.
 * Asserts on the SAVED event, read back with the service role: title, date,
 * start, end, time zone and place equal the owner's answers; no tickets;
 * never private; exactly one record with that title.
 *
 * Mutation check (run live 2026-11-02): in `offerings/event.ts`
 * `eventEndStep.onAnswer`, save the suggested end instead of the owner's
 * (`owner(suggestedEventEnd(start_at))`) and `end time` reads "21:00", not
 * "22:30" — FAIL. Flip the create default visibility to "private" and
 * `requested visibility` fails.
 */

import { compareFacts, driveFlow, place } from "./lib.mjs";

export const meta = {
  id: "event_create_minimal",
  brand: "new",
  account: "new_owner",
  capabilities: ["ari.event.create"],
};

export const SHOREDITCH = place({
  venue: "Shoreditch Town Hall",
  address: "380 Old Street, London EC1V 9LT",
  city: "London",
  country: "GB",
  lat: 51.5262,
  lng: -0.0794,
});

/** The owner's answers to the event cards every event eval shares. */
export function eventBasicsScript({ startText, endText }) {
  return {
    // A brand-new brand is offered its can-wait profile items once.
    brand_can_wait: () => ({ choose: "not_now" }),
    event_start: () => ({ answer: { response: startText } }),
    event_end: () => ({ answer: { response: endText } }),
    event_format: () => ({ choose: "in_person" }),
    event_place: () => ({
      answer: { place: SHOREDITCH },
      text: SHOREDITCH.venue_name,
    }),
  };
}

export async function readEvent(rest, brandId, title) {
  const rows = await rest.select(
    "events",
    `select=id,title,status,visibility,timezone,city,location_text,theme,deleted_at&brand_id=eq.${brandId}&title=eq.${
      encodeURIComponent(title)
    }&deleted_at=is.null`,
  );
  return rows;
}

export async function run(ctx) {
  const title = `Lantern Supper ${ctx.suffix}`;
  const session = await ctx.session(meta.account, meta.brand);
  const state = await driveFlow(session, {
    start: () => session.say(`Create an event called ${title}`),
    confirmTools: ["create_event"],
    script: {
      ...eventBasicsScript({
        startText: "Friday 4 December 2026 at 7pm",
        endText: "10:30pm",
      }),
      // The draft is saved; stop before "get it ready to publish".
      event_publish_ready: () => ({ stop: true }),
    },
  });
  const rows = await readEvent(ctx.rest, ctx.brands[meta.brand], title);
  const event = rows[0] ?? null;
  const draft = event?.theme?.business_draft ?? {};
  const tickets = event
    ? await ctx.rest.select("ticket_types", `select=id&event_id=eq.${event.id}`)
    : [];
  return {
    state,
    facts: compareFacts([
      { fact: "records with this title", expected: 1, actual: rows.length },
      { fact: "title", expected: title, actual: event?.title ?? null },
      { fact: "status", expected: "draft", actual: event?.status ?? null },
      { fact: "date", expected: "2026-12-04", actual: draft.when?.date ?? null },
      {
        fact: "start time",
        expected: "19:00",
        actual: draft.when?.doorsOpen ?? null,
      },
      { fact: "end time", expected: "22:30", actual: draft.when?.endsAt ?? null },
      {
        fact: "time zone",
        expected: "Europe/London",
        actual: event?.timezone ?? null,
      },
      { fact: "format", expected: "in_person", actual: draft.format ?? null },
      {
        fact: "place",
        expected: SHOREDITCH.venue_name,
        actual: draft.location?.venueName ?? null,
      },
      {
        fact: "address",
        expected: SHOREDITCH.address,
        actual: draft.location?.address ?? null,
      },
      { fact: "city", expected: "London", actual: event?.city ?? null },
      {
        fact: "tickets saved",
        expected: 0,
        actual: tickets.length + (draft.tickets?.length ?? 0),
      },
      {
        fact: "visibility",
        expected: (value) => value !== "private",
        label: "not private",
        actual: event?.visibility ?? null,
      },
      {
        fact: "requested visibility",
        expected: (value) => value !== "private",
        label: "not private",
        actual: draft.requestedVisibility ?? null,
      },
      {
        fact: "description invented",
        expected: (value) => !value,
        label: "none",
        actual: event ? (draft.description ?? null) : null,
      },
    ]),
  };
}
