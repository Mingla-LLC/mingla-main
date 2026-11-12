/**
 * #3355 P10 — brand_gate_defer_remembered (SPEC §7.4, P2/P3, SC-8), revised
 * for #3355 Wave A (A3, Seth D4a 2026-11-10).
 *
 * Items that "can wait" are never a flow step any more: they stay on Home's
 * to-do list and the flow's final summary names them once. So B-New's owner
 * starts an event in conversation 1 and a teammate (brand admin) in
 * conversation 2, and for both the first card is the event's own question,
 * never a can-wait card. Asserts on SAVED state: the flow wrote no brand-wide
 * "not now" rows on anyone's behalf (Home still lists the items).
 *
 * Setup (local only): B-New's open "not now" rows are cleared first.
 *
 * Mutation check: restore the pre-Wave-A `brandCanWaitStep.probe`
 * (ariFlows/brandGate.ts, which asked the can-wait card) and `owner's first
 * card` reads brand_can_wait — FAIL.
 */

import { compareFacts, driveFlow } from "./lib.mjs";

export const meta = {
  id: "brand_gate_defer_remembered",
  brand: "new",
  account: "new_owner",
  // The flow writes the brand-wide "not now" itself (brand_readiness_defer);
  // the defer_readiness_item tool (ari.brand.readiness_defer) is not what
  // runs here, so no ledger row is claimed.
  capabilities: [],
};

export async function run(ctx) {
  const brandId = ctx.brands[meta.brand];
  const now = new Date().toISOString();
  await ctx.rest.update(
    "brand_readiness_deferrals",
    `brand_id=eq.${brandId}&cleared_at=is.null`,
    {
      cleared_at: now,
      cleared_by: ctx.users.new_owner,
      cleared_reason: "owner_undo",
    },
  );

  const owner = await ctx.session("new_owner", meta.brand);
  const first = await driveFlow(owner, {
    start: () => owner.say(`Create an event called Defer Check ${ctx.suffix}`),
    script: {
      brand_can_wait: () => ({ stop: true }),
      event_start: () => ({ stop: true }),
    },
  });
  const deferrals = await ctx.rest.select(
    "brand_readiness_deferrals",
    `select=item_key,deferred_by&brand_id=eq.${brandId}&cleared_at=is.null`,
  );

  const teammate = await ctx.session("new_admin", meta.brand);
  const second = await driveFlow(teammate, {
    start: () =>
      teammate.say(`Create an event called Defer Teammate ${ctx.suffix}`),
    script: {
      brand_can_wait: () => ({ stop: true }),
      event_start: () => ({ stop: true }),
    },
  });
  return {
    state: second,
    facts: compareFacts([
      { fact: "owner's first card", expected: "event_start", actual: first.steps[0] ?? null },
      { fact: "teammate's first card", expected: "event_start", actual: second.steps[0] ?? null },
      { fact: "not-now rows the flow wrote", expected: 0, actual: deferrals.length },
      {
        fact: "conversations are different",
        expected: true,
        actual: !!owner.conversationId && !!teammate.conversationId &&
          owner.conversationId !== teammate.conversationId,
      },
    ]),
  };
}
