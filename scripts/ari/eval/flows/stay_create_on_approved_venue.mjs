/**
 * #3355 P10 — stay_create_on_approved_venue (SPEC §7.4, P9).
 *
 * B-NG owns one approved Stay venue in Lagos. Its owner asks Ari to set up a
 * stay; Ari uses that venue, asks the description and the check-in/check-out
 * times (Lagos time, from the venue's country), saves the settings, then the
 * offering: Rooms, a name, "2 guests, 5 rooms", a nightly price and the
 * cancellation policy in the owner's words. Asserts on the SAVED settings and
 * offering, read back with the service role.
 *
 * Mutation check: drop `quantity` (rooms) from the typed stay offering in
 * `offerings/stay.ts` and `rooms` fails; summarise the policy instead of
 * saving the owner's words and `cancellation policy (verbatim)` fails; price
 * in the default GBP instead of the brand's currency and `currency` fails.
 * (The time zone fact does not isolate 575d36e3b: here the brand's and the
 * venue's country are both NG.)
 */

import { compareFacts, driveFlow } from "./lib.mjs";

export const meta = {
  id: "stay_create_on_approved_venue",
  brand: "ng",
  account: "ng_owner",
  capabilities: ["ari.stay.manage_inventory"],
};

const SUMMARY = "A calm lagoon-side guesthouse with breakfast on the terrace.";
const POLICY = "Free cancellation up to 7 days before arrival; after that, one night is charged.";

export async function run(ctx) {
  const name = `Lagoon Double ${ctx.suffix}`;
  const session = await ctx.session(meta.account, meta.brand, {
    timezone: "Africa/Lagos",
  });
  const state = await driveFlow(session, {
    start: () => session.say("Set up a stay"),
    script: {
      brand_can_wait: () => ({ choose: "not_now" }),
      stay_summary: () => ({ answer: { response: SUMMARY } }),
      stay_times: () => ({
        answer: { response: "check-in 2pm, check-out 11am" },
      }),
      stay_settings_save: () => ({ choose: "save" }),
      stay_kind: () => ({ choose: "room" }),
      stay_name: () => ({ answer: { response: name } }),
      stay_size: () => ({ answer: { response: "2 guests, 5 rooms" } }),
      stay_price: () => ({ answer: { response: "₦85,000" } }),
      stay_policy: () => ({ answer: { response: POLICY } }),
      stay_create: () => ({ choose: "create" }),
      stay_publish: () => ({ stop: true }),
    },
  });
  return { state, facts: await stayFacts(ctx, name) };
}

async function stayFacts(ctx, name) {
  const venues = await ctx.rest.select(
    "venue_listings",
    `select=id,name&brand_id=eq.${ctx.brands[meta.brand]}&venue_category=eq.stay&claim_status=eq.verified`,
  );
  const venue = venues[0] ?? null;
  const settings = venue
    ? (await ctx.rest.select(
      "stay_settings",
      `select=summary,timezone,check_in_time,check_out_time&venue_id=eq.${venue.id}`,
    ))[0] ?? null
    : null;
  const offerings = venue
    ? await ctx.rest.select(
      "stay_offerings",
      `select=id,kind,name,status,inventory_basis,quantity,capacity,max_adults,max_children,venue_id&venue_id=eq.${venue.id}&name=eq.${
        encodeURIComponent(name)
      }`,
    )
    : [];
  const offering = offerings[0] ?? null;
  const prices = offering
    ? await ctx.rest.select(
      "stay_price_versions",
      `select=amount_minor,currency_code,pricing_unit&offering_id=eq.${offering.id}`,
    )
    : [];
  const policies = offering
    ? await ctx.rest.select(
      "stay_policy_versions",
      `select=cancellation_policy&offering_id=eq.${offering.id}`,
    )
    : [];
  return compareFacts([
    { fact: "settings summary", expected: SUMMARY, actual: settings?.summary ?? null },
    {
      fact: "settings time zone (venue's country)",
      expected: "Africa/Lagos",
      actual: settings?.timezone ?? null,
    },
    {
      fact: "check-in",
      expected: "14:00",
      actual: settings?.check_in_time?.slice(0, 5) ?? null,
    },
    {
      fact: "check-out",
      expected: "11:00",
      actual: settings?.check_out_time?.slice(0, 5) ?? null,
    },
    { fact: "offerings with this name", expected: 1, actual: offerings.length },
    { fact: "on the approved venue", expected: venue?.id ?? "venue", actual: offering?.venue_id ?? null },
    { fact: "kind", expected: "room", actual: offering?.kind ?? null },
    { fact: "status", expected: "draft", actual: offering?.status ?? null },
    { fact: "rooms", expected: 5, actual: offering?.quantity ?? null },
    { fact: "guests per room", expected: 2, actual: offering?.max_adults ?? null },
    { fact: "children", expected: 0, actual: offering?.max_children ?? null },
    { fact: "price versions", expected: 1, actual: prices.length },
    { fact: "price per night (kobo)", expected: 8_500_000, actual: prices[0]?.amount_minor ?? null },
    { fact: "currency (brand's)", expected: "NGN", actual: prices[0]?.currency_code ?? null },
    {
      fact: "cancellation policy (verbatim)",
      expected: POLICY,
      actual: policies[0]?.cancellation_policy ?? null,
    },
  ]);
}
