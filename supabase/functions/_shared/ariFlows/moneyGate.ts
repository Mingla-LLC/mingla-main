/**
 * Issue #3355 P6 — the money flow step (`money_gate`).
 *
 * When the owner wants something paid, Ari walks the money checklist from
 * `brand_readiness` (one server read; I-MONEY-SELL-VS-PAYOUT-DISTINCT) one
 * item at a time, in this order:
 *
 *   market → currency → currency review (Ari can help decide it) →
 *   Organiser Terms (asked by the paid-publish Terms gate, or Payments setup)
 *   → ready to sell (owner handoff) → payouts to the bank.
 *
 * Seth's decisions: paid tickets are allowed in drafts and money blocks only
 * at publish (3), so every card here offers "Keep going" and the draft is
 * built either way; the contact email never blocks (1). Payouts to the bank
 * block only trip deposits and instalments (the server's
 * bank_required_for_installments); everywhere else they are a one-line
 * warning ("You can sell now; payouts start once your bank is connected").
 * Nothing here unblocks a publish: the publish functions keep every gate.
 */

import { moneySummary } from "../money/moneySplit.ts";
import type { ReadinessAction } from "../readinessCatalog.ts";
import { gateEvidence } from "./brandGate.ts";
import type {
  AnswerOutcome,
  AskSpec,
  BrandReadiness,
  BrandReadinessItem,
  FlowChoiceOption,
  FlowContext,
  ProbeResult,
  StepDefinition,
} from "./types.ts";

/** The money checklist, in the order Ari walks it. */
export const MONEY_GATE_ORDER = Object.freeze(
  [
    "money.market",
    "money.currency",
    "money.currency_reconciliation",
    "money.terms_member",
    "money.can_sell",
    "money.can_be_paid_out",
  ] as const,
);

const PAYOUTS_KEY = "money.can_be_paid_out";
const RECONCILIATION_KEY = "money.currency_reconciliation";
const TERMS_KEY = "money.terms_member";
const OWNER_ONLY = "Only the owner can do this — tell them?";

export function runWantsPaid(ctx: Pick<FlowContext, "run">): boolean {
  return ctx.run.answers.paid?.value === true;
}

/** Trip deposits or instalments: the one place payouts to the bank block. */
export function runWantsInstallments(
  ctx: Pick<FlowContext, "run" | "def">,
): boolean {
  return ctx.def.key === "create_trip" &&
    ctx.run.answers.installments?.value === true;
}

function gateAction(ctx: FlowContext): ReadinessAction | null {
  if (runWantsInstallments(ctx)) return "trip_installments";
  return runWantsPaid(ctx) ? ctx.def.readiness.publish_paid : null;
}

function itemFor(
  readiness: BrandReadiness,
  key: string,
): BrandReadinessItem | undefined {
  return readiness.items.find((item) => item.key === key);
}

/** Outstanding money items in walk order (payouts included as a warning). */
export function outstandingMoneyItems(
  readiness: BrandReadiness,
): BrandReadinessItem[] {
  return MONEY_GATE_ORDER.flatMap((key) => {
    const item = itemFor(readiness, key);
    if (!item || item.severity === "done") return [];
    // The market item is a recommendation, never a blocker; it leads the walk
    // only when it is genuinely missing.
    if (key === "money.market" && item.state !== "missing") return [];
    return [item];
  });
}

/** Plain lead for each owner-owned money item. */
const ITEM_LEAD: Readonly<Record<string, string>> = Object.freeze({
  "money.market":
    "This brand hasn't chosen its payout country and provider yet.",
  "money.currency": "This brand doesn't have a payout currency yet.",
  "money.can_sell": "Payments aren't set up for selling yet.",
  "money.can_be_paid_out": "Payouts to the bank aren't on yet.",
});

function itemLead(item: BrandReadinessItem): string {
  return ITEM_LEAD[item.key] ?? `${item.label} isn't ready yet.`;
}

function lowerFirst(label: string): string {
  return `${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

/** One card for one money item. */
function moneyItemCard(args: {
  ctx: FlowContext;
  item: BrandReadinessItem;
  readiness: BrandReadiness;
  blocksThisStep: boolean;
}): AskSpec {
  const { ctx, item, readiness, blocksThisStep } = args;
  const noun = ctx.def.noun;
  const brandId = ctx.run.brand_id;
  const options: FlowChoiceOption[] = [];
  let text: string;

  if (item.key === RECONCILIATION_KEY) {
    text = item.fix.can_caller_fix
      ? "A currency change needs a decision before anything paid can go on sale. I can help you decide it here."
      : `A currency change needs a decision before anything paid can go on sale. Only ${item.fix.who_can_fix} can decide it.`;
    if (item.fix.can_caller_fix) {
      options.push({ id: "resolve_currency", label: "Decide it now" });
    }
  } else if (item.key === TERMS_KEY) {
    // Terms are accepted in the app, never by Ari: the paid-publish Terms
    // gate asks for them, and so does Payments setup.
    const sell = itemFor(readiness, "money.can_sell");
    const onboardRoute = sell?.fix.can_caller_fix ? sell.fix.route : null;
    text =
      `You haven't accepted the Organiser Terms yet. The app asks for them when you publish something paid${
        onboardRoute ? ", or you can accept them in Payments setup" : ""
      }.`;
    if (onboardRoute) {
      options.push({
        id: "open",
        label: "Open Payments setup",
        route: onboardRoute,
      });
    }
  } else if (item.fix.can_caller_fix && item.fix.route) {
    text = `${
      itemLead(item)
    } Open ${item.fix.route_label} to sort it, then tell me and I'll check.`;
    options.push({
      id: "open",
      label: `Open ${item.fix.route_label}`.slice(0, 100),
      route: item.fix.route,
    });
  } else if (item.fix.who_can_fix === "the brand owner") {
    text = `${itemLead(item)} ${OWNER_ONLY}`;
    options.push({
      id: "tell_owner",
      label: "Find the owner in Team",
      route: `/brand/${brandId}/team`,
    });
  } else {
    text = `${itemLead(item)} Only ${item.fix.who_can_fix} can do this.`;
  }

  if (item.key !== RECONCILIATION_KEY || !item.fix.can_caller_fix) {
    options.push({
      id: "check",
      label: item.fix.can_caller_fix ? "It's done, check now" : "Check again",
    });
  }
  if (blocksThisStep) {
    // Instalments need payouts: build it with full payment instead.
    options.push({ id: "no_installments", label: "Skip instalments for now" });
    text =
      `${text} Deposits and instalments need payouts to reach the bank first.`;
  } else {
    options.push({ id: "continue", label: "Keep going" });
    text = `${text} You can still build this ${noun} with paid tickets now.`;
  }

  return {
    kind: item.fix.can_caller_fix && item.key !== TERMS_KEY &&
        item.key !== RECONCILIATION_KEY
      ? "handoff"
      : "question",
    reuse_key: `money:${item.key}`,
    title: blocksThisStep
      ? "Before deposits and instalments"
      : "Before tickets can go on sale",
    text,
    options,
    handoff: {
      item_key: item.key,
      item_label: item.label,
      route: item.fix.route,
      route_label: item.fix.route_label,
      can_caller_fix: item.fix.can_caller_fix,
      who_can_fix: item.fix.who_can_fix,
    },
    items: [{ key: item.key, label: item.label, blocks: item.blocks_action }],
    record: { item_key: item.key },
  };
}

export const moneyGateStep: StepDefinition = {
  key: "money_gate",
  title: "Getting paid",
  kind: "readiness_gate",
  depends_on: ["brand_blockers"],
  policy: "deferrable",
  async probe(ctx: FlowContext): Promise<ProbeResult> {
    const action = gateAction(ctx);
    if (!action) {
      return {
        done: true,
        evidence: {
          probe: "flow_answers",
          observed: { paid: false },
          action: null,
        },
      };
    }
    const installments = action === "trip_installments";
    const readiness = await ctx.deps.readiness(action);
    const outstanding = outstandingMoneyItems(readiness);
    // Payouts block only instalments; anywhere else they are a warning.
    const cards = outstanding.filter((item) =>
      installments || item.key !== PAYOUTS_KEY
    );
    const waitedOn = ctx.state?.item_key;
    const resolved = waitedOn && !cards.some((item) => item.key === waitedOn)
      ? itemFor(readiness, waitedOn)
      : undefined;
    const notes: string[] = [];
    if (resolved) {
      notes.push(
        resolved.key === RECONCILIATION_KEY
          ? "I checked; the currency change is decided."
          : `I checked; that's sorted now: ${resolved.label}.`,
      );
    }
    if (cards.length === 0) {
      const warnPayouts = !readiness.money.can_be_paid_out &&
        outstanding.some((item) => item.key === PAYOUTS_KEY);
      if (warnPayouts) notes.push(moneySummary(readiness.money));
      return {
        done: true,
        evidence: gateEvidence(readiness, action, {
          can_sell: readiness.money.can_sell,
          can_be_paid_out: readiness.money.can_be_paid_out,
          payouts_warning: warnPayouts,
        }),
        ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
      };
    }
    const first = cards[0];
    // The owner chose to decide the currency change here: hand that one
    // request to Ari's own lane; the run re-reads readiness after the
    // confirmed decision (manage_brand_discovery_currency).
    if (
      first.key === RECONCILIATION_KEY && ctx.state?.data?.resolving === true &&
      first.fix.can_caller_fix
    ) {
      return {
        done: false,
        delegate: true,
        semantic:
          "Help me decide the pending currency change for this brand: read the current currency state, explain the choices, and propose the decision for my approval.",
      };
    }
    return {
      done: false,
      ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
      ask: moneyItemCard({
        ctx,
        item: first,
        readiness,
        blocksThisStep: installments && first.blocks_action,
      }),
    };
  },
  onAnswer(ctx, choiceId): Promise<AnswerOutcome | null> {
    const itemKey = ctx.state?.item_key;
    if (choiceId === "continue" || choiceId === "not_now") {
      // Run-only: money items are never set aside for the brand.
      return Promise.resolve({
        record: {
          state: "deferred",
          ...(itemKey ? { item_key: itemKey } : {}),
          reason: "money_at_publish",
        },
        ack:
          "Okay. I'll build it now; tickets can go on sale once payments are ready.",
      });
    }
    if (choiceId === "no_installments") {
      return Promise.resolve({
        record: {
          state: "deferred",
          ...(itemKey ? { item_key: itemKey } : {}),
          reason: "installments_need_payouts",
        },
        ack:
          "Okay. I'll build it with full payment up front; deposits and instalments can be added once payouts reach the bank.",
      });
    }
    if (choiceId === "resolve_currency" && itemKey === RECONCILIATION_KEY) {
      return Promise.resolve({
        record: {
          state: "asked",
          item_key: itemKey,
          data: { resolving: true },
        },
      });
    }
    if (choiceId === "tell_owner" && itemKey) {
      const label = ctx.run.current_artefact?.handoff?.item_label;
      return Promise.resolve({
        record: { state: "human_action", item_key: itemKey },
        ack:
          `The owner can see the team and payment setup in Team. Tell me when ${
            label ? lowerFirst(label) : "it"
          } is sorted and I'll check.`,
      });
    }
    return Promise.resolve(null);
  },
};
