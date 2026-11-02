/**
 * #3355 P10 — brand_gate_defer_remembered (SPEC §7.4, P2/P3, SC-8).
 *
 * B-New's owner starts an event in conversation 1 and taps "Not now, keep
 * going" on the can-wait card. A teammate (brand admin) then starts an event
 * in conversation 2. Asserts on SAVED state: the brand-wide "not now" rows
 * exist for every item on the card, recorded as the owner's; the teammate's
 * first card is the event's own first question, not the can-wait card again.
 *
 * Setup (local only): B-New's open "not now" rows are cleared first, so the
 * owner's card is shown fresh every run.
 *
 * Mutation check: make `brandCanWaitStep.onAnswer` (ariFlows/brandGate.ts)
 * keep the skip for the run only (do not call `ctx.deps.setAside`) and
 * `deferral rows` is 0 and the teammate's `first card` is brand_can_wait.
 */

import { compareFacts, driveFlow } from "./lib.mjs";

export const meta = {
  id: "brand_gate_defer_remembered",
  brand: "new",
  account: "new_owner",
  capabilities: ["ari.readiness.defer_item"],
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
  let shownKeys = [];
  const first = await driveFlow(owner, {
    start: () => owner.say(`Create an event called Defer Check ${ctx.suffix}`),
    script: {
      brand_can_wait: (artefact) => {
        shownKeys = (artefact.items ?? []).map((item) => item.key);
        return { choose: "not_now" };
      },
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
  const deferredKeys = deferrals.map((row) => row.item_key).sort();
  return {
    state: second,
    facts: compareFacts([
      { fact: "owner saw the can-wait card", expected: "brand_can_wait", actual: first.steps[0] ?? null },
      {
        fact: "deferral rows (one per item on the card)",
        expected: shownKeys.length > 0 ? shownKeys.length : "at least 1",
        actual: deferrals.length,
      },
      {
        fact: "deferred items equal the card's items",
        expected: [...shownKeys].sort(),
        actual: deferredKeys,
      },
      {
        fact: "recorded as the owner's",
        expected: true,
        actual: deferrals.length > 0 &&
          deferrals.every((row) => row.deferred_by === ctx.users.new_owner),
      },
      {
        fact: "teammate's first card",
        expected: "event_start",
        actual: second.steps[0] ?? null,
      },
      {
        fact: "conversations are different",
        expected: true,
        actual: !!owner.conversationId && !!teammate.conversationId &&
          owner.conversationId !== teammate.conversationId,
      },
    ]),
  };
}
