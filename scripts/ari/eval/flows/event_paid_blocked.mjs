/**
 * #3355 P10 — event_paid_blocked (SPEC §7.4, Script B).
 *
 * B-New (no payment setup) asks for a paid event, keeps going past the money
 * card, builds the draft, gets it ready (party type, description, a paid
 * ticket), picks Public, then taps "Publish it". Asserts on the SAVED event:
 * the paid ticket is on the draft at the owner's price and number, and the
 * event is still an unpublished draft after the owner asked to publish.
 *
 * Mutation check: drop the readiness blockers from `publishBlockers` in
 * `offerings/event.ts` (return only the Host gaps) and the run reaches a
 * publish proposal, so `status after publish request` fails; drop the
 * price from `ticketSaveStep`'s tool_args and `ticket price` fails.
 */

import { compareFacts, driveFlow } from "./lib.mjs";
import { eventBasicsScript, readEvent } from "./event_create_minimal.mjs";

export const meta = {
  id: "event_paid_blocked",
  brand: "new",
  account: "new_owner",
  capabilities: ["ari.ticket.upsert_tier", "ari.event.update"],
};

const DESCRIPTION = "A candlelit supper with live strings and three courses.";

export async function run(ctx) {
  const title = `Lantern Paid ${ctx.suffix}`;
  const session = await ctx.session(meta.account, meta.brand);
  let publishAsked = 0;
  let refusalText = null;
  const state = await driveFlow(session, {
    start: () => session.say(`Create a paid event called ${title}`),
    confirmTools: ["create_event", "update_event", "upsert_ticket_tier"],
    script: {
      ...eventBasicsScript({
        startText: "Friday 11 December 2026 at 7pm",
        endText: "11pm",
      }),
      // No payment setup: build it now, sell later.
      money_gate: () => ({ choose: "continue" }),
      event_publish_ready: () => ({ choose: "yes" }),
      event_cover: () => ({ choose: "not_now" }),
      event_party_types: () => ({ answer: { choices: ["Themed Party"] } }),
      event_description: () => ({ answer: { response: DESCRIPTION } }),
      event_details_save: () => ({ choose: "save" }),
      event_ticket_kind: () => ({ choose: "paid" }),
      event_ticket_details: () => ({
        answer: { response: "£15, 60 tickets" },
      }),
      event_tickets_save: () => ({ choose: "save" }),
      event_visibility: () => ({ choose: "public" }),
      event_publish: (artefact) => {
        if (publishAsked > 0) {
          refusalText = artefact.text;
          return { stop: true };
        }
        publishAsked += 1;
        return { choose: "publish" };
      },
    },
  });
  const rows = await readEvent(ctx.rest, ctx.brands[meta.brand], title);
  const event = rows[0] ?? null;
  const draft = event?.theme?.business_draft ?? {};
  const tickets = Array.isArray(draft.tickets) ? draft.tickets : [];
  const ticket = tickets[0] ?? {};
  const full = event
    ? (await ctx.rest.select(
      "events",
      `select=description,party_types,published_at&id=eq.${event.id}`,
    ))[0]
    : {};
  return {
    state,
    facts: compareFacts([
      { fact: "records with this title", expected: 1, actual: rows.length },
      { fact: "paid tickets on the draft", expected: 1, actual: tickets.length },
      { fact: "ticket is paid", expected: false, actual: ticket.isFree ?? null },
      { fact: "ticket price", expected: 15, actual: ticket.priceGbp ?? null },
      { fact: "ticket capacity", expected: 60, actual: ticket.capacity ?? null },
      { fact: "description", expected: DESCRIPTION, actual: full?.description ?? null },
      {
        fact: "party types",
        expected: ["themed-party"],
        actual: full?.party_types ?? null,
      },
      { fact: "owner asked to publish", expected: 1, actual: publishAsked },
      {
        fact: "status after publish request",
        expected: "draft",
        actual: event?.status ?? null,
      },
      { fact: "published_at", expected: null, actual: full?.published_at ?? null },
      {
        fact: "refusal names payment setup",
        expected: (value) => /payment setup/i.test(value ?? ""),
        label: "mentions payment setup",
        actual: refusalText,
      },
      {
        fact: "publish proposals",
        expected: 0,
        actual: state.proposals.filter((p) => p.tool === "publish_event").length,
      },
    ]),
  };
}
