/**
 * Issue #3355 P3 — the brand readiness preamble steps (`brand_gate`).
 *
 * Before Ari starts an offering it reads the canonical checklist
 * (`brand_readiness`, P2) for the action at hand and:
 *   1. `brand_blockers` — anything that blocks even saving a draft (role, an
 *      approved venue for a stay…) is handed off; nothing proceeds past it.
 *   2. `brand_can_wait` — items that would make the offering better but never
 *      block it are shown once, with "Not now, keep going" (Seth 2026-11-01:
 *      the items stay on Home's to-do list; Ari just proceeds) or "Add <item>"
 *      (handoff to the real Host form, then a verified check).
 * Items irrelevant to the action (the Website-only "Approved Website plan" on
 * an event checklist) are filtered out by the catalogue's own action lists.
 */

import type { ReadinessAction } from "../readinessCatalog.ts";
import type {
  AnswerOutcome,
  AskSpec,
  BrandReadiness,
  BrandReadinessItem,
  FlowContext,
  FlowEvidence,
  ProbeResult,
  StepDefinition,
} from "./types.ts";

/** An item matters for an action only if the catalogue says it gates or improves it. */
export function itemRelevantTo(
  item: BrandReadinessItem,
  action: ReadinessAction,
): boolean {
  return item.blocking_for.includes(action) ||
    item.recommended_for.includes(action);
}

export function ownerItemNoun(label: string): string {
  return `your ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

function lowerFirst(label: string): string {
  return `${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

export function listWords(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

export function gateEvidence(
  readiness: BrandReadiness,
  action: ReadinessAction,
  observed: unknown,
): FlowEvidence {
  return {
    probe: "brand_readiness",
    action,
    observed,
    context_revision: readiness.context_revision,
  };
}

/** A handoff card for one checklist item. Same item = same card (reuse_key). */
export function itemHandoff(args: {
  item: BrandReadinessItem;
  noun: string;
  title: string;
  lead: string;
  allowNotNow: boolean;
}): AskSpec {
  const { item } = args;
  const canFix = item.fix.can_caller_fix && !!item.fix.route;
  const how = canFix
    ? `Open ${item.fix.route_label} to sort it, then tell me and I'll check.`
    : `Only ${item.fix.who_can_fix} can do this.`;
  return {
    kind: "handoff",
    reuse_key: `handoff:${item.key}`,
    title: args.title,
    text: `${args.lead} ${how}`,
    options: [
      ...(canFix
        ? [{
          id: "open",
          label: `Open ${item.fix.route_label}`.slice(0, 100),
          route: item.fix.route ?? undefined,
        }]
        : []),
      { id: "check", label: canFix ? "It's done, check now" : "Check again" },
      args.allowNotNow
        ? { id: "not_now", label: "Not now, keep going" }
        : { id: "cancel", label: "Stop here" },
    ],
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

function findItem(
  readiness: BrandReadiness,
  key: string | undefined,
): BrandReadinessItem | undefined {
  return key ? readiness.items.find((item) => item.key === key) : undefined;
}

/** Step 1: whatever blocks the draft itself. Blocking; never "not now". */
export const brandBlockersStep: StepDefinition = {
  key: "brand_blockers",
  title: "Check nothing blocks this",
  kind: "readiness_gate",
  depends_on: [],
  policy: "blocking",
  async probe(ctx: FlowContext): Promise<ProbeResult> {
    const action = ctx.def.readiness.draft;
    const readiness = await ctx.deps.readiness(action);
    const blockers = readiness.items.filter((item) =>
      item.blocks_action && item.group !== "money"
    );
    const waitedOn = ctx.state?.state === "human_action"
      ? ctx.state.item_key
      : undefined;
    const resolved = waitedOn &&
        !blockers.some((item) => item.key === waitedOn)
      ? findItem(readiness, waitedOn)
      : undefined;
    const note = resolved
      ? `I checked; ${ownerItemNoun(resolved.label)} is sorted now.`
      : undefined;
    if (blockers.length === 0) {
      return {
        done: true,
        evidence: gateEvidence(readiness, action, { blocking: [] }),
        note,
      };
    }
    const first = blockers[0];
    return {
      done: false,
      note,
      ask: itemHandoff({
        item: first,
        noun: ctx.def.noun,
        title: `Before I can start your ${ctx.def.noun}`,
        lead:
          `${first.label} needs sorting first, so I haven't started the ${ctx.def.noun}.`,
        allowNotNow: false,
      }),
    };
  },
  onAnswer(_ctx, choiceId): Promise<AnswerOutcome | null> {
    if (choiceId === "cancel") {
      return Promise.resolve({
        record: { state: "skipped", reason: "owner_stopped" },
        ack: "Okay, I've stopped here. Nothing was changed.",
        cancel_run: true,
      });
    }
    return Promise.resolve(null);
  },
};

const MAX_FIX_OPTIONS = 3;

function canWaitItems(
  ctx: FlowContext,
  readiness: BrandReadiness,
  action: ReadinessAction,
): BrandReadinessItem[] {
  return readiness.items.filter((item) =>
    itemRelevantTo(item, action) &&
    item.severity !== "done" &&
    !item.blocks_action &&
    item.group !== "money" &&
    item.group !== "team" &&
    !item.skip_in_ari &&
    !ctx.run.session_skips.includes(item.key)
  );
}

/** Step 2: what would help but can wait. Skippable ("not now" keeps it on Home). */
export const brandCanWaitStep: StepDefinition = {
  key: "brand_can_wait",
  title: "Things that can wait",
  kind: "readiness_gate",
  depends_on: ["brand_blockers"],
  policy: "skippable",
  async probe(ctx: FlowContext): Promise<ProbeResult> {
    const action = ctx.def.readiness.publish;
    const readiness = await ctx.deps.readiness(action);
    const waiting = canWaitItems(ctx, readiness, action);
    const handedOff = ctx.state?.state === "human_action"
      ? findItem(readiness, ctx.state.item_key)
      : undefined;
    if (handedOff && handedOff.severity !== "done") {
      return {
        done: false,
        ask: itemHandoff({
          item: handedOff,
          noun: ctx.def.noun,
          title: `Add ${ownerItemNoun(handedOff.label)}`,
          lead: `${handedOff.label} isn't set yet.`,
          allowNotNow: true,
        }),
      };
    }
    const note = handedOff
      ? `I checked; ${ownerItemNoun(handedOff.label)} is there now.`
      : undefined;
    if (waiting.length === 0) {
      return {
        done: true,
        evidence: gateEvidence(readiness, action, { can_wait: [] }),
        note,
      };
    }
    const labels = waiting.map((item) => item.label);
    const fixable = waiting.filter((item) =>
      item.fix.can_caller_fix && !!item.fix.route
    ).slice(0, MAX_FIX_OPTIONS);
    return {
      done: false,
      note,
      ask: {
        kind: "question",
        reuse_key: `can_wait:${waiting.map((item) => item.key).join(",")}`,
        title: `Before your ${ctx.def.noun} goes live`,
        text:
          `These would make your ${ctx.def.noun} page stronger, but none of them stops me starting it: ${
            listWords(labels)
          }. If you skip them for now they stay on your Home to-do list.`,
        options: [
          { id: "not_now", label: "Not now, keep going" },
          ...fixable.map((item) => ({
            id: `fix:${item.key}`,
            label: `Add ${lowerFirst(item.label)}`.slice(0, 100),
          })),
        ],
        items: waiting.map((item) => ({
          key: item.key,
          label: item.label,
          blocks: false,
        })),
        record: { set_aside: waiting.map((item) => item.key) },
      },
    };
  },
  async onAnswer(ctx, choiceId): Promise<AnswerOutcome | null> {
    if (choiceId === "not_now") {
      // The keys shown on the open card are the ones the owner set aside.
      const keys = ctx.state?.set_aside ??
        (ctx.state?.item_key ? [ctx.state.item_key] : []);
      const sessionOnly: string[] = [];
      for (const key of keys) {
        if (await ctx.deps.setAside(key) === "session_only") {
          sessionOnly.push(key);
        }
      }
      const labels = (ctx.run.current_artefact?.items ?? [])
        .filter((item) => keys.includes(item.key))
        .map((item) => lowerFirst(item.label));
      return {
        record: { state: "deferred", set_aside: keys, reason: "not_now" },
        session_skips: [...new Set([...ctx.run.session_skips, ...keys])],
        ack: labels.length > 0
          ? `Okay, I'll leave ${listWords(labels)} for later. ${
            labels.length === 1 ? "It stays" : "They stay"
          } on your Home to-do list.`
          : "Okay, I'll leave that for later.",
      };
    }
    if (choiceId.startsWith("fix:")) {
      const key = choiceId.slice("fix:".length);
      if (!(ctx.state?.set_aside ?? []).includes(key)) return null;
      return { record: { state: "human_action", item_key: key } };
    }
    return null;
  },
};
