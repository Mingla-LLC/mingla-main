// Issue #3355 P2 — Ari's view of the canonical brand readiness read.
//
// `public.brand_readiness(p_brand_id, p_action)` is the one server answer to
// "what is this brand missing, and does it block what I'm about to do?". Ari
// reads it here (get_brand_readiness), its operator snapshot and launch plan
// read it through the helpers below, and a brand-wide "not now" is written
// only through the protected defer/undefer tools. Nothing in this module
// computes a missing-item list of its own.
//
// Seth's decision (2026-11-01): a "not now" is an Ari-flow skip only. The item
// keeps its true state, stays on Home's to-do list, never expires, and never
// unblocks a blocking item. Ari simply stops asking about it.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { AgentToolDefinition } from "./agentToolHelpers.ts";
import { isUuid, ToolError } from "./agentToolHelpers.ts";
import { assertAgentReadBrand } from "./agentTenantScope.ts";
import {
  BRAND_READINESS_ITEM_LABELS,
  READINESS_ACTIONS,
  type ReadinessAction,
} from "./readinessCatalog.ts";

type JsonRecord = Record<string, unknown>;

export interface BrandReadinessItem {
  key: string;
  label: string;
  group: string;
  state: string;
  severity: "blocking" | "skippable" | "done";
  blocks_action: boolean;
  /** #3355 P3: the actions this item gates or is recommended for (relevance). */
  blocking_for: string[];
  recommended_for: string[];
  value_preview: string | null;
  deferrable: boolean;
  deferral: {
    by_display_name: string;
    at: string;
    until: null;
    reason: string | null;
  } | null;
  skip_in_ari: boolean;
  owner_action: string;
  fix: {
    route: string | null;
    route_label: string;
    can_caller_fix: boolean;
    who_can_fix: string;
  };
  ask: JsonRecord;
}

export interface BrandReadinessMoney {
  can_sell: boolean;
  can_be_paid_out: boolean;
  sell_reason: string;
  payout_reason: string;
  rail: string;
  currency: string | null;
  terms_accepted_by_caller: boolean | null;
}

export interface BrandReadiness {
  brand_id: string;
  action: ReadinessAction | null;
  can_proceed: boolean;
  context_revision: string | null;
  evaluated_at: string | null;
  counts: {
    blocking: number;
    can_wait: number;
    done: number;
    deferred: number;
  };
  money: BrandReadinessMoney;
  items: BrandReadinessItem[];
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Project the RPC answer to the stable shape Ari and its helpers read. */
export function compactBrandReadiness(raw: unknown): BrandReadiness | null {
  const root = record(raw);
  if (!root || !Array.isArray(root.items) || !record(root.money)) return null;
  const money = record(root.money)!;
  const counts = record(root.counts) ?? {};
  const items: BrandReadinessItem[] = root.items.flatMap((value) => {
    const item = record(value);
    const key = str(item?.key);
    if (!item || !key) return [];
    const fix = record(item.fix) ?? {};
    const deferral = record(item.deferral);
    const severity = item.severity === "blocking" || item.severity === "done"
      ? item.severity
      : "skippable";
    return [{
      key,
      label: str(item.label) ?? key,
      group: str(item.group) ?? "identity",
      state: str(item.state) ?? "missing",
      severity,
      blocks_action: item.blocks_action === true,
      blocking_for: stringList(item.blocking_for),
      recommended_for: stringList(item.recommended_for),
      value_preview: str(item.value_preview),
      deferrable: item.deferrable === true,
      deferral: deferral
        ? {
          by_display_name: str(deferral.by_display_name) ?? "A teammate",
          at: str(deferral.at) ?? "",
          until: null,
          reason: str(deferral.reason),
        }
        : null,
      skip_in_ari: item.skip_in_ari === true,
      owner_action: str(item.owner_action) ?? "answer",
      fix: {
        route: str(fix.route),
        route_label: str(fix.route_label) ?? "Brand profile",
        can_caller_fix: fix.can_caller_fix === true,
        who_can_fix: str(fix.who_can_fix) ?? "a brand admin or the owner",
      },
      ask: record(item.ask) ?? { control: "handoff" },
    }];
  });
  const action = str(root.action);
  return {
    brand_id: str(root.brand_id) ?? "",
    action: (READINESS_ACTIONS as readonly string[]).includes(action ?? "")
      ? action as ReadinessAction
      : null,
    can_proceed: root.can_proceed === true,
    context_revision: str(root.context_revision),
    evaluated_at: str(root.evaluated_at),
    counts: {
      blocking: num(counts.blocking),
      can_wait: num(counts.can_wait),
      done: num(counts.done),
      deferred: num(counts.deferred),
    },
    money: {
      can_sell: money.can_sell === true,
      can_be_paid_out: money.can_be_paid_out === true,
      sell_reason: str(money.sell_reason) ?? "kyc_incomplete",
      payout_reason: str(money.payout_reason) ?? "no_bank",
      rail: str(money.rail) ?? "none",
      currency: str(money.currency),
      terms_accepted_by_caller: typeof money.terms_accepted_by_caller ===
          "boolean"
        ? money.terms_accepted_by_caller
        : null,
    },
    items,
  };
}

function isMissingFunction(error: { code?: unknown; message?: unknown }) {
  return error.code === "PGRST202" ||
    /could not find the function/i.test(String(error.message ?? ""));
}

function requireBrandId(value: unknown): string {
  if (!isUuid(value)) {
    throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
  }
  return value;
}

function optionalAction(value: unknown): ReadinessAction | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "string" ||
    !(READINESS_ACTIONS as readonly string[]).includes(value)
  ) {
    throw new ToolError(
      "INVALID_ARGS",
      `action must be one of ${READINESS_ACTIONS.join(", ")}`,
    );
  }
  return value as ReadinessAction;
}

/** The canonical read. Throws READINESS_UNAVAILABLE while the migration is not applied. */
export async function readBrandReadiness(
  client: SupabaseClient,
  brandId: string,
  action: ReadinessAction | null = null,
): Promise<BrandReadiness> {
  const { data, error } = await client.rpc("brand_readiness", {
    p_brand_id: brandId,
    p_action: action,
  });
  if (error) {
    if (isMissingFunction(error)) {
      throw new ToolError(
        "READINESS_UNAVAILABLE",
        "The brand checklist isn't available yet.",
      );
    }
    if (error.code === "42501" || /\bforbidden\b/.test(error.message ?? "")) {
      throw new ToolError(
        "BRAND_ACCESS_DENIED",
        "You're not a member of that brand.",
      );
    }
    throw new ToolError("RPC_FAILED", `brand_readiness: ${error.message}`);
  }
  const readiness = compactBrandReadiness(data);
  if (!readiness) {
    throw new ToolError(
      "RPC_FAILED",
      "brand_readiness returned an unexpected shape",
    );
  }
  return readiness;
}

/**
 * The same read for composite answers (snapshot, launch plan). A missing RPC
 * during the deploy window is reported as unavailable, never replaced by a
 * hand-made list.
 */
export async function tryReadBrandReadiness(
  client: SupabaseClient,
  brandId: string,
): Promise<{ readiness: BrandReadiness | null; unavailable: boolean }> {
  try {
    return {
      readiness: await readBrandReadiness(client, brandId, null),
      unavailable: false,
    };
  } catch (error) {
    if (
      error instanceof ToolError &&
      ["READINESS_UNAVAILABLE", "RPC_FAILED"].includes(error.code)
    ) {
      return { readiness: null, unavailable: true };
    }
    throw error;
  }
}

const PROFILE_GROUPS = new Set([
  "identity",
  "contact",
  "location",
  "media",
]);

/** Brand profile items still to do (not done), in catalogue order. */
export function readinessProfileGaps(
  readiness: BrandReadiness | null,
): BrandReadinessItem[] {
  if (!readiness) return [];
  return readiness.items.filter((item) =>
    PROFILE_GROUPS.has(item.group) && item.severity !== "done"
  );
}

/** Owner words for a brand profile gap list ("Contact phone (not now)"). */
export function readinessGapLabels(
  items: ReadonlyArray<{ label: string; deferral: unknown }>,
): string[] {
  return items.map((item) =>
    item.deferral ? `${item.label} (set aside for now)` : item.label
  );
}

const SELL_REASON_WORDS: Readonly<Record<string, string>> = Object.freeze({
  no_provider: "payments aren't connected yet",
  kyc_incomplete: "payment setup isn't finished",
  provider_disabled: "the payment provider has paused this account",
  currency_missing: "there's no payout currency yet",
  currency_reconciliation_pending: "a currency change needs a decision first",
  unsupported_market: "this country isn't supported for payments yet",
});

const PAYOUT_REASON_WORDS: Readonly<Record<string, string>> = Object.freeze({
  no_bank: "no bank account is connected for payouts",
  payouts_disabled: "the payment provider hasn't turned payouts on yet",
  provider_review: "the payment provider needs more information",
  currency_reconciliation_pending: "a currency change needs a decision first",
  hold_rail_sell_before_bank: "sales are held until the owner connects a bank",
});

/** One plain paragraph for the money position (can sell vs can be paid out). */
export function readinessMoneySentence(money: BrandReadinessMoney): string {
  const sell = money.can_sell
    ? "This brand can sell paid tickets"
    : `Paid selling isn't ready: ${
      SELL_REASON_WORDS[money.sell_reason] ?? "payment setup isn't finished"
    }`;
  const payout = money.can_be_paid_out
    ? "payouts reach the bank"
    : money.can_sell
    ? `payouts start once that's sorted (${
      PAYOUT_REASON_WORDS[money.payout_reason] ?? "no bank is connected yet"
    })`
    : PAYOUT_REASON_WORDS[money.payout_reason] ?? "no bank is connected yet";
  const terms = money.terms_accepted_by_caller === false
    ? " You still need to accept the Organiser Terms before publishing anything paid."
    : "";
  return `${sell}; ${payout}.${terms}`;
}

/** Owner words for the money gaps the launch plan lists. */
export function readinessMoneyGaps(money: BrandReadinessMoney): string[] {
  const gaps: string[] = [];
  if (!money.can_sell) gaps.push("payment setup so the brand can sell (owner)");
  if (!money.can_be_paid_out) gaps.push("a bank for payouts (owner)");
  if (money.terms_accepted_by_caller === false) {
    gaps.push("your Organiser Terms acceptance");
  }
  return gaps;
}

const DEFERRABLE_ITEM_KEYS = Object.keys(BRAND_READINESS_ITEM_LABELS);

const REFUSAL_WORDS: Readonly<Record<string, string>> = Object.freeze({
  readiness_item_not_deferrable:
    "That one gates paid selling or publishing, so it can't be set aside for the brand. Nothing was changed.",
  readiness_defer_forbidden:
    "Only someone who can fix that item can set it aside for the whole brand. I'll skip it for this chat instead. Nothing was changed.",
  readiness_item_already_done:
    "That's already done, so there's nothing to set aside. Nothing was changed.",
  readiness_item_unknown:
    "That isn't on the brand checklist. Nothing was changed.",
  readiness_reason_too_long:
    "Keep the reason under 280 characters. Nothing was changed.",
});

function deferralRefusal(error: { message?: unknown }): ToolError | null {
  const message = String(error.message ?? "");
  for (const [code, words] of Object.entries(REFUSAL_WORDS)) {
    if (new RegExp(`(^|[^a-z_])${code}([^a-z_]|$)`).test(message)) {
      return new ToolError("DOMAIN_REFUSED", words);
    }
  }
  return null;
}

function requireItemKey(value: unknown): string {
  if (typeof value !== "string" || !DEFERRABLE_ITEM_KEYS.includes(value)) {
    throw new ToolError("INVALID_ARGS", "item_key is not a checklist item");
  }
  return value;
}

async function writeDeferral(
  client: SupabaseClient,
  fn: "brand_readiness_defer" | "brand_readiness_undefer",
  params: JsonRecord,
): Promise<JsonRecord> {
  const { data, error } = await client.rpc(fn, params);
  if (error) {
    if (isMissingFunction(error)) {
      throw new ToolError(
        "READINESS_UNAVAILABLE",
        "The brand checklist isn't available yet. Nothing was changed.",
      );
    }
    throw deferralRefusal(error) ??
      new ToolError("RPC_FAILED", `${fn}: ${error.message}`);
  }
  const result = record(data);
  if (!result) throw new ToolError("RPC_FAILED", `${fn}: no result`);
  return result;
}

const UUID = { type: "string", format: "uuid" };

export const getBrandReadiness: AgentToolDefinition = {
  name: "get_brand_readiness",
  description:
    "Read the brand's one checklist: every brand, money and team item with its state, whether it blocks the action you're about to take, who can fix it and where, how to ask for it, and any brand-wide 'not now'. Call it before setup, publishing, paid selling, payouts, refunds or a Website build.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["brand_id"],
    properties: {
      brand_id: UUID,
      action: { type: "string", enum: [...READINESS_ACTIONS] },
    },
  },
  executor: async (args, client, userId) => {
    const brandId = requireBrandId(args.brand_id);
    const action = optionalAction(args.action);
    await assertAgentReadBrand(client, userId, brandId);
    return await readBrandReadiness(client, brandId, action);
  },
};

export const deferReadinessItem: AgentToolDefinition = {
  name: "defer_readiness_item",
  description:
    "After the owner confirms, mark one non-blocking checklist item as 'not now' for the whole brand. It stays on the Home to-do list and is never treated as done; Ari just stops asking. Blocking items, payments and Terms can't be set aside.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["brand_id", "item_key"],
    properties: {
      brand_id: UUID,
      item_key: { type: "string", enum: DEFERRABLE_ITEM_KEYS },
      reason: { type: "string", minLength: 1, maxLength: 280 },
    },
  },
  executor: async (args, client) => {
    const brandId = requireBrandId(args.brand_id);
    const itemKey = requireItemKey(args.item_key);
    const reason = typeof args.reason === "string" && args.reason.trim()
      ? args.reason.trim().slice(0, 280)
      : null;
    const result = await writeDeferral(client, "brand_readiness_defer", {
      p_brand_id: brandId,
      p_item_key: itemKey,
      p_reason: reason,
    });
    const item = record(result.item);
    // Canonical readback: the saved deferral must be visible on the item.
    if (!item || !record(item.deferral)) {
      throw new ToolError(
        "WRITE_NOT_VERIFIED",
        "The 'not now' didn't show up on the checklist, so I can't confirm it saved.",
      );
    }
    return {
      brand_id: brandId,
      item_key: itemKey,
      label: BRAND_READINESS_ITEM_LABELS[itemKey],
      state: item.state,
      deferral: item.deferral,
      still_on_home_list: true,
    };
  },
};

export const undeferReadinessItem: AgentToolDefinition = {
  name: "undefer_readiness_item",
  description:
    "After the owner confirms, remove a brand-wide 'not now' so Ari asks about that checklist item again.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["brand_id", "item_key"],
    properties: {
      brand_id: UUID,
      item_key: { type: "string", enum: DEFERRABLE_ITEM_KEYS },
    },
  },
  executor: async (args, client) => {
    const brandId = requireBrandId(args.brand_id);
    const itemKey = requireItemKey(args.item_key);
    const result = await writeDeferral(client, "brand_readiness_undefer", {
      p_brand_id: brandId,
      p_item_key: itemKey,
    });
    const item = record(result.item);
    if (item && record(item.deferral)) {
      throw new ToolError(
        "WRITE_NOT_VERIFIED",
        "The checklist still shows it as set aside, so I can't confirm the change.",
      );
    }
    return {
      brand_id: brandId,
      item_key: itemKey,
      label: BRAND_READINESS_ITEM_LABELS[itemKey],
      cleared: result.cleared === true,
      state: item?.state ?? null,
    };
  },
};

export const READINESS_TOOLS: AgentToolDefinition[] = [
  getBrandReadiness,
  deferReadinessItem,
  undeferReadinessItem,
];

export const READINESS_READ_ONLY = new Set(["get_brand_readiness"]);
