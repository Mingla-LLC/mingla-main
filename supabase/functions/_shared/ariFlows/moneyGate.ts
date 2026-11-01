/**
 * Issue #3355 P3 — the money preamble step (`money_gate`).
 *
 * Seth 2026-11-01: paid tickets are allowed in drafts; money blocks only at
 * publish. So when the owner asks for something paid, Ari says once, plainly,
 * what must happen before tickets can go on sale (from `brand_readiness`
 * money items for the paid publish action: can sell, currency, Terms…), who
 * can do it, and keeps going with the draft. Nothing here unblocks a publish:
 * the server publish functions still enforce every money gate.
 */

import { readinessMoneySentence } from "../agentReadinessTools.ts";
import { gateEvidence, itemHandoff, listWords } from "./brandGate.ts";
import type {
  AnswerOutcome,
  FlowContext,
  ProbeResult,
  StepDefinition,
} from "./types.ts";

export function runWantsPaid(ctx: Pick<FlowContext, "run">): boolean {
  return ctx.run.answers.paid?.value === true;
}

export const moneyGateStep: StepDefinition = {
  key: "money_gate",
  title: "Getting paid",
  kind: "readiness_gate",
  depends_on: ["brand_blockers"],
  policy: "deferrable",
  async probe(ctx: FlowContext): Promise<ProbeResult> {
    const action = ctx.def.readiness.publish_paid;
    if (!action || !runWantsPaid(ctx)) {
      return {
        done: true,
        evidence: {
          probe: "flow_answers",
          observed: { paid: false },
          action: null,
        },
      };
    }
    const readiness = await ctx.deps.readiness(action);
    const missing = readiness.items.filter((item) =>
      item.group === "money" && item.blocks_action
    );
    if (missing.length === 0) {
      return {
        done: true,
        evidence: gateEvidence(readiness, action, { money_blocking: [] }),
      };
    }
    const handedOff = ctx.state?.state === "human_action"
      ? missing.find((item) => item.key === ctx.state?.item_key)
      : undefined;
    if (handedOff) {
      return {
        done: false,
        ask: itemHandoff({
          item: handedOff,
          noun: ctx.def.noun,
          title: "Before tickets can go on sale",
          lead: `${handedOff.label} isn't ready yet.`,
          allowNotNow: true,
        }),
      };
    }
    const lines = missing.map((item) =>
      item.fix.can_caller_fix
        ? item.label
        : `${item.label} (${item.fix.who_can_fix})`
    );
    const first = missing.find((item) =>
      item.fix.can_caller_fix && !!item.fix.route
    );
    return {
      done: false,
      ask: {
        kind: "question",
        reuse_key: `money:${missing.map((item) => item.key).join(",")}`,
        title: "Before tickets can go on sale",
        text:
          `You can build this ${ctx.def.noun} with paid tickets now. Before tickets can go on sale: ${
            listWords(lines)
          }. ${readinessMoneySentence(readiness.money)}`,
        options: [
          { id: "continue", label: "Keep going" },
          ...(first
            ? [{
              id: `fix:${first.key}`,
              label: `Open ${first.fix.route_label}`.slice(0, 100),
              route: first.fix.route ?? undefined,
            }]
            : []),
        ],
        items: missing.map((item) => ({
          key: item.key,
          label: item.label,
          blocks: true,
        })),
        record: { set_aside: missing.map((item) => item.key) },
      },
    };
  },
  onAnswer(ctx, choiceId): Promise<AnswerOutcome | null> {
    if (choiceId === "continue" || choiceId === "not_now") {
      // Run-only: money items are never set aside for the brand.
      return Promise.resolve({
        record: {
          state: "deferred",
          set_aside: ctx.state?.set_aside ?? [],
          reason: "money_at_publish",
        },
        ack:
          "Okay. I'll build it now; tickets can go on sale once payments are ready.",
      });
    }
    if (choiceId.startsWith("fix:")) {
      const key = choiceId.slice("fix:".length);
      if (!(ctx.state?.set_aside ?? []).includes(key)) {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        record: { state: "human_action", item_key: key },
      });
    }
    return Promise.resolve(null);
  },
};
