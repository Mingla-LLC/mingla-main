/**
 * #3355 P10 — refund_role_refused_event_manager (SPEC §7.4, P6, SC-12).
 *
 * B-Sell's event manager asks Ari "What do I need before I can issue
 * refunds?". This is the deterministic readiness answer (no model): it must
 * refuse in plain words and name who CAN refund (a finance manager, a brand
 * admin or the owner — the server's biz_can_manage_payments_for_brand), with
 * no card and no write. Asserts on SAVED state: no pending action exists for
 * the conversation, and no refund was started by this teammate.
 *
 * Scope: asking Ari to refund a specific order goes through the model lane
 * (refund_order is chosen by the model and refused at propose time by
 * MONEY_TOOL_PREDICATES); the local model cannot drive that, so this eval
 * covers the deterministic path only and flips no ledger row.
 *
 * Mutation check: remove the `team.role` branch from `blockerLine`
 * (ariFlows/readinessAnswer.ts) and `names who can refund` fails ("only the
 * brand owner can do this"); let readiness allow refunds at event-manager
 * rank and `refused` fails.
 */

import { compareFacts } from "./lib.mjs";

export const meta = {
  id: "refund_role_refused_event_manager",
  brand: "sell",
  account: "sell_event_manager",
  capabilities: [],
};

export async function run(ctx) {
  const userId = ctx.users[meta.account];
  const refundsBy = () =>
    ctx.rest.select("refunds", `select=id&initiated_by=eq.${userId}`);
  const refundsBefore = await refundsBy();
  const session = await ctx.session(meta.account, meta.brand);
  const reply = await session.say("What do I need before I can issue refunds?");
  const text = String(reply.text ?? "");
  const pending = session.conversationId
    ? await ctx.rest.select(
      "agent_pending_actions",
      `select=id,tool_name&conversation_id=eq.${session.conversationId}`,
    )
    : [];
  const refundsAfter = await refundsBy();
  return {
    state: { last: reply },
    facts: compareFacts([
      { fact: "reply kind", expected: "text", actual: reply.kind },
      {
        fact: "refused",
        expected: (value) => /^Before .+ can issue refunds/.test(value),
        label: "says refunds are blocked for this role",
        actual: text.split("\n")[0],
      },
      {
        fact: "names who can refund",
        expected: (value) =>
          /only a finance manager, a brand admin or the owner can/.test(value),
        label: "a finance manager, a brand admin or the owner",
        actual: text.split("\n").find((line) => /role/i.test(line)) ?? null,
      },
      { fact: "card shown", expected: null, actual: reply.flow?.step_key ?? null },
      { fact: "pending actions in the chat", expected: 0, actual: pending.length },
      {
        fact: "refunds started by this teammate",
        expected: 0,
        actual: refundsAfter.length - refundsBefore.length,
      },
    ]),
  };
}
