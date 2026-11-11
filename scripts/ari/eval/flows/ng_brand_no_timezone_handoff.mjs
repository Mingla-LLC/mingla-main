/**
 * #3355 Wave A (A7) — S6 ng_brand_no_timezone_handoff.
 *
 * Production 2026-11-10: a Lagos host was handed off to Brand profile to add
 * a time zone, which Brand profile could not set. Nigeria has one zone.
 * Asserts on SAVED state: an NG brand with no time zone gets Africa/Lagos as
 * soon as its country is written (migration 20280606023355), and an event
 * setup never shows a time zone handoff (or any "can wait" card) on the way
 * to its first question.
 *
 * Deterministic twins in CI: issue_3355_brand_timezone_from_country pg17,
 * issue_3355_wave_a_understand_first ("S6 ...") and
 * issue_3355_wave_a_handoff_fixable.
 *
 * Mutation check: drop the brands_default_timezone_from_country trigger and
 * `brand time zone` reads null — FAIL.
 */

import { compareFacts, driveFlow } from "./lib.mjs";

export const meta = {
  id: "ng_brand_no_timezone_handoff",
  brand: "ng",
  account: "ng_owner",
  capabilities: [],
};

export async function run(ctx) {
  const brandId = ctx.brands[meta.brand];
  // Start from a brand with no zone, then write its country (the trigger).
  await ctx.rest.update("brands", `id=eq.${brandId}`, { default_timezone: null });
  await ctx.rest.update("brands", `id=eq.${brandId}`, { country_code: "GH" });
  await ctx.rest.update("brands", `id=eq.${brandId}`, { country_code: "NG" });
  const [brand] = await ctx.rest.select(
    "brands",
    `select=default_timezone,country_code&id=eq.${brandId}`,
  );
  const session = await ctx.session(meta.account, meta.brand, {
    timezone: "Africa/Lagos",
  });
  const handoffs = [];
  const state = await driveFlow(session, {
    start: () => session.say(`Create an event called Harmattan Night ${ctx.suffix}`),
    script: new Proxy({}, {
      get: () => (artefact) => {
        if (artefact.handoff) handoffs.push(artefact.handoff.item_key);
        return { stop: true };
      },
    }),
  });
  return {
    state,
    facts: compareFacts([
      { fact: "brand time zone", expected: "Africa/Lagos", actual: brand?.default_timezone ?? null },
      { fact: "time zone handoffs", expected: [], actual: handoffs.filter((key) => key === "timezone") },
      {
        fact: "first card",
        expected: (value) => value !== "brand_can_wait" && value !== "brand_blockers",
        label: "the event's own question",
        actual: state.steps[0] ?? null,
      },
    ]),
  };
}
