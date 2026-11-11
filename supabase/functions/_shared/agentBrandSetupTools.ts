// Issue #4389 — Ari's brand setup and door sale tools, in their own module so
// the #3355 Ari files keep small diffs.
//
// - set_brand_payout_country: ONE write through biz_set_brand_payout_country
//   (D7: the old best-effort payout_country write ignored its error).
// - start_payments_onboarding: no write. Gates on bank country + Organiser
//   Terms and returns the secure-screen handoff; bank and ID details are never
//   collected in chat.
// - start_door_sale: no write and no payment. Returns the existing door sale
//   screen with tickets prefilled; the host takes the payment there.
// - withBrandSetupTools: a host with no brand, or a brand with no money
//   country yet, always has the setup tools, whatever words they used.
// - pendingActionBrandMismatch: a confirmation card is bound to its brand
//   (AR-13).
//
// MINGLA-INVARIANT: I-4389-ARI-NO-SENSITIVE-DATA | issue #4389 | no Ari brand setup tool accepts a bank, ID or tax number; payments are entered only on the secure screen returned by start_payments_onboarding.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { AgentTool, AgentToolDefinition } from "./agentToolHelpers.ts";
import { invokeFn, isUuid, ToolError } from "./agentToolHelpers.ts";
import { payoutRailFor } from "./payoutCountries.ts";
import { brandSetupRoute } from "./readinessCatalog.ts";

/** Countries whose name alone is ambiguous: always asked back as a choice (AR-4). */
export const AMBIGUOUS_COUNTRY_NAMES: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    georgia: ["Georgia, the country", "Georgia, United States"],
    congo: ["Republic of the Congo", "Democratic Republic of the Congo"],
    korea: ["South Korea", "North Korea"],
    guinea: ["Guinea", "Equatorial Guinea", "Guinea-Bissau", "Papua New Guinea"],
  });

export function ambiguousCountry(input: unknown): readonly string[] | null {
  if (typeof input !== "string") return null;
  const key = input.trim().toLowerCase();
  return Object.hasOwn(AMBIGUOUS_COUNTRY_NAMES, key) ? AMBIGUOUS_COUNTRY_NAMES[key] : null;
}

const PAYOUT_COUNTRY_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  payout_country_locked:
    "Payouts are already set up for this brand's bank country. To use another country, disconnect payments first. Nothing was changed.",
  payout_country_unsupported: "Mingla can't pay out to banks in that country yet. Nothing was changed.",
  forbidden: "Only the owner or a brand admin can choose the bank country. Nothing was changed.",
  brand_not_found: "That brand isn't available, so nothing was changed.",
});

function refusalCode(message: string | undefined | null): string | null {
  const m = message ?? "";
  for (const code of Object.keys(PAYOUT_COUNTRY_MESSAGES)) {
    if (m.includes(code)) return code;
  }
  return null;
}

/** set_brand_payout_country's executor: one write, its error always surfaces. */
export async function executeSetBrandPayoutCountry(
  args: Record<string, unknown>,
  client: SupabaseClient,
): Promise<Record<string, unknown>> {
  if (!isUuid(args.brand_id)) throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
  const options = ambiguousCountry(args.country_code);
  if (options) {
    throw new ToolError("COUNTRY_AMBIGUOUS", `Ask which one they mean: ${options.join(" or ")}.`);
  }
  const rail = payoutRailFor(args.country_code);
  if (!rail) {
    throw new ToolError(
      "PAYOUT_COUNTRY_UNSUPPORTED",
      "Mingla can't pay out to banks in that country yet, so nothing was changed. The brand can still run free events.",
    );
  }
  const { data, error } = await client.rpc("biz_set_brand_payout_country", {
    p_brand_id: args.brand_id,
    p_country: rail.country,
  });
  if (error) {
    const code = refusalCode(error.message);
    throw new ToolError(
      code ? code.toUpperCase() : "PAYOUT_COUNTRY_NOT_SAVED",
      code ? PAYOUT_COUNTRY_MESSAGES[code] : "The bank country didn't save, so nothing is shown as done.",
    );
  }
  const saved = (data ?? {}) as Record<string, unknown>;
  if (saved.payout_country !== rail.country) {
    throw new ToolError("PAYOUT_COUNTRY_NOT_SAVED", "The bank country didn't save, so nothing is shown as done.");
  }
  let nigeriaPayoutsReady = true;
  if (rail.provider === "paystack") {
    // The Nigerian rail's payout-hold stamp (sell before a bank exists).
    try {
      await invokeFn(client, "brand-paystack-onboard", { action: "select_provider", brand_id: args.brand_id });
    } catch (_error) {
      nigeriaPayoutsReady = false;
    }
  }
  return {
    brand_id: args.brand_id,
    country_code: rail.country,
    country_name: rail.name,
    currency: saved.default_currency ?? rail.currency,
    payout_provider: rail.provider,
    ...(nigeriaPayoutsReady ? {} : { follow_up: "Finish the bank step in setup to turn on Nigerian payouts." }),
    next: { route: brandSetupRoute(String(args.brand_id), "pay") },
  };
}

interface ChecklistItem {
  key?: string;
  state?: string;
  waiting_for?: string | null;
}

function itemDone(items: ChecklistItem[], key: string): boolean {
  const item = items.find((i) => i.key === key);
  return item?.state === "verified" || item?.state === "not_applicable";
}

export const startPaymentsOnboarding: AgentToolDefinition = {
  name: "start_payments_onboarding",
  description:
    "Hand the host to the secure screen where they add their ID and bank details for a brand. Call it only after get_brand_readiness(brand_setup) shows the bank country and Organiser Terms; it returns the screen, or what is still missing. Bank, ID and tax numbers are never asked for or accepted in chat: if the host types one, say it is hidden and open the secure screen. Never say payments are set up unless get_brand_readiness says so. For anyone but the owner it returns requires_owner.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["brand_id"],
    properties: { brand_id: { type: "string", format: "uuid" } },
  },
  executor: async (args, client) => {
    if (!isUuid(args.brand_id)) throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
    const brandId = args.brand_id;
    const { data: owner, error: ownerError } = await client.rpc(
      "biz_can_mutate_payouts_for_brand_for_caller",
      { p_brand_id: brandId },
    );
    if (ownerError) throw new ToolError("ROLE_CHECK_UNAVAILABLE", "Ari could not verify permissions right now");
    const { data, error } = await client.rpc("brand_readiness", { p_brand_id: brandId, p_action: "brand_setup" });
    if (error) throw new ToolError("READ_FAILED", "Ari couldn't read this brand's setup right now.");
    const items = (Array.isArray((data as { items?: unknown })?.items)
      ? (data as { items: ChecklistItem[] }).items
      : []);
    if (owner !== true) {
      return {
        requires_owner: true,
        route: null,
        message: "Only the owner can set up payments. We've added it to their Home.",
        checklist: items,
      };
    }
    const missing = ["money.market", "money.terms_member"].filter((key) => !itemDone(items, key));
    if (missing.length > 0) {
      return {
        ready: false,
        missing,
        route: brandSetupRoute(brandId, missing[0] === "money.market" ? "country" : "pay"),
        checklist: items,
        requires_human: true,
      };
    }
    return {
      ready: true,
      route: brandSetupRoute(brandId, "pay"),
      message: "Bank and ID details are entered on a secure screen, not in chat.",
      checklist: items,
      requires_human: true,
    };
  },
};

function asciiBase64(text: string): string {
  return btoa(text);
}

export const startDoorSale: AgentToolDefinition = {
  name: "start_door_sale",
  description:
    "Open the door sale for an event with tickets prefilled, so the host can take a payment at the door (Tap to Pay where it works, the buyer paying on their phone, or cash). This never takes a payment and never asks for card details. Without event_id it uses today's live or soonest upcoming event of the brand; when several qualify it returns the choices to ask the host.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      brand_id: { type: "string", format: "uuid" },
      event_id: { type: "string", format: "uuid" },
      ticket_type_id: { type: "string", format: "uuid" },
      quantity: { type: "integer", minimum: 1, maximum: 50 },
    },
  },
  executor: async (args, client) => {
    let eventId = isUuid(args.event_id) ? args.event_id : null;
    if (eventId === null) {
      if (!isUuid(args.brand_id)) throw new ToolError("INVALID_ARGS", "brand_id or event_id is required");
      const now = new Date();
      const endOfToday = new Date(now);
      endOfToday.setUTCHours(23, 59, 59, 999);
      const { data, error } = await client
        .from("events")
        .select("id, title, status, event_dates!inner(start_at, end_at)")
        .eq("brand_id", args.brand_id)
        .in("status", ["scheduled", "live"])
        .is("deleted_at", null)
        .gt("event_dates.end_at", now.toISOString())
        .limit(20);
      if (error) throw new ToolError("READ_FAILED", "Ari couldn't read this brand's events right now.");
      const rows = (Array.isArray(data) ? data : []) as Array<{
        id: string;
        title: string;
        status: string;
        event_dates: Array<{ start_at: string; end_at: string }>;
      }>;
      const today = rows.filter((r) =>
        r.status === "live" || r.event_dates.some((d) => new Date(d.start_at) <= endOfToday)
      );
      const pool = today.length > 0 ? today : rows;
      if (pool.length === 0) {
        return { route: null, message: "This brand has no live or upcoming event to sell at the door." };
      }
      const soonest = (r: (typeof rows)[number]) =>
        Math.min(...r.event_dates.map((d) => new Date(d.start_at).getTime()));
      pool.sort((a, b) => soonest(a) - soonest(b));
      if (today.length > 1) {
        return {
          route: null,
          choose_event: today.map((r) => ({ event_id: r.id, title: r.title })),
          message: "Which event is this sale for?",
        };
      }
      eventId = pool[0].id;
    }
    let draft = "";
    if (isUuid(args.ticket_type_id)) {
      const { data: tier, error: tierError } = await client
        .from("ticket_types")
        .select("id")
        .eq("id", args.ticket_type_id)
        .eq("event_id", eventId)
        .maybeSingle();
      if (tierError || !tier) throw new ToolError("INVALID_ARGS", "That ticket isn't on this event.");
      const quantity = Number.isInteger(args.quantity) ? Math.min(Math.max(Number(args.quantity), 1), 50) : 1;
      draft = `&draft=${encodeURIComponent(asciiBase64(JSON.stringify({
        lines: [{ ticketTypeId: args.ticket_type_id, quantity }],
        eventDateId: null,
      })))}`;
    }
    return {
      event_id: eventId,
      route: `/event/${eventId}/door?sellAnother=1${draft}`,
      takes_payment: false,
      requires_human: true,
    };
  },
};

export const BRAND_SETUP_TOOLS: AgentToolDefinition[] = [startPaymentsOnboarding, startDoorSale];
export const BRAND_SETUP_READ_ONLY = new Set(["start_payments_onboarding", "start_door_sale"]);

const SETUP_TOOL_NAMES = [
  "get_brand_readiness",
  "create_brand",
  "set_brand_payout_country",
  "start_payments_onboarding",
] as const;

/**
 * A host with no brand, or a brand with no money country yet, always gets the
 * setup tools, whatever words they used (keyword selection could drop
 * create_brand on "I host events").
 */
export function withBrandSetupTools(
  selected: AgentTool[],
  all: readonly AgentTool[],
  activeBrand: { default_currency: string | null } | null,
): AgentTool[] {
  if (activeBrand !== null && activeBrand.default_currency !== null) return selected;
  const have = new Set(selected.map((t) => t.name));
  const extra = all.filter((t) =>
    (SETUP_TOOL_NAMES as readonly string[]).includes(t.name) && !have.has(t.name)
  );
  return extra.length === 0 ? selected : [...selected, ...extra];
}

/** AR-13: a confirmation card is bound to the brand it was proposed for. */
export function pendingActionBrandMismatch(
  pendingBrandId: string | null | undefined,
  requestBrandId: unknown,
): boolean {
  if (typeof requestBrandId !== "string" || requestBrandId.length === 0) return false;
  if (typeof pendingBrandId !== "string" || pendingBrandId.length === 0) return false;
  return pendingBrandId !== requestBrandId;
}

/** Host words for create_brand refusals (draft_exists / existing_incomplete_brand). */
export function createBrandRefusal(message: string): ToolError | null {
  const draft = message.match(/draft_exists:([0-9a-f-]{36})/);
  if (draft) {
    return new ToolError(
      "DRAFT_EXISTS",
      `You already have a brand in progress (brand_id ${draft[1]}). Offer to continue it or discard it and start new.`,
    );
  }
  const dup = message.match(/existing_incomplete_brand:([0-9a-f-]{36})/);
  if (dup) {
    return new ToolError(
      "EXISTING_INCOMPLETE_BRAND",
      `You already started this brand (brand_id ${dup[1]}). Offer to continue it instead.`,
    );
  }
  if (message.includes("payout_country_unsupported")) {
    return new ToolError(
      "PAYOUT_COUNTRY_UNSUPPORTED",
      "Mingla can't pay out to banks in that country yet. Offer to create the brand for free events.",
    );
  }
  return null;
}

const DELETE_REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  delete_blocked:
    "This brand can't be deleted yet: money is still owed or on its way, or it has upcoming events. Nothing was deleted.",
  payment_account_close_refused:
    "Our payment partner couldn't close this brand's payment account, so nothing was deleted. Contact support and we'll sort it.",
  confirm_name_mismatch: "Type the exact brand name to confirm deletion.",
  forbidden: "Only the brand owner can delete it.",
  not_a_draft: "This brand is no longer a draft, so it can't be discarded.",
});

/**
 * #4389 — Ari's delete_brand runs the same delete core as the app
 * (`brand-delete` -> `_shared/brandDelete.ts`): payment accounts are closed
 * first and the delete is blocked while money is owed.
 */
export async function executeDeleteBrandViaCore(
  args: Record<string, unknown>,
  client: SupabaseClient,
): Promise<Record<string, unknown>> {
  if (!isUuid(args.brand_id)) throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
  if (typeof args.confirm_phrase !== "string" || args.confirm_phrase.trim().length === 0) {
    throw new ToolError("INVALID_ARGS", "Type the exact brand name to confirm deletion.");
  }
  const { data, error } = await client.functions.invoke("brand-delete", {
    body: { brand_id: args.brand_id, confirm_name: args.confirm_phrase },
  });
  if (error) {
    let code: string | null = null;
    try {
      const ctx = (error as { context?: { clone?: () => { json?: () => Promise<unknown> } } }).context;
      const body = ctx && typeof ctx.clone === "function"
        ? await ctx.clone().json?.() as { error?: unknown } | undefined
        : undefined;
      code = typeof body?.error === "string" ? body.error : null;
    } catch {
      code = null;
    }
    if (code && Object.hasOwn(DELETE_REFUSALS, code)) {
      throw new ToolError(code.toUpperCase(), DELETE_REFUSALS[code]);
    }
    throw new ToolError("WRITE_FAILED", "The brand wasn't deleted. Try again in a moment.");
  }
  const result = (data ?? {}) as Record<string, unknown>;
  if (result.ok !== true) throw new ToolError("WRITE_FAILED", "The brand wasn't deleted. Try again in a moment.");
  return {
    brand: { id: args.brand_id },
    deleted: true,
    payment_account: result.stripe === "closed" ? "closed" : "none",
    bank_payouts: result.paystack === "switched_off" ? "switched_off" : "none",
  };
}
