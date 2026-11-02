/**
 * Issue #3355 P6 (D-26) — readiness at propose time.
 *
 * Every Ari publish or paid tool reads `brand_readiness(action)` when it
 * PROPOSES, so the owner hears about a blocker (payments, Terms, currency,
 * role…) in plain words before any approval card. The publish RPC's own
 * database refusal stays as the backstop: when the readiness read is not
 * available (deploy window) this check steps aside and the server still
 * decides.
 *
 * Also here: the provider minimum price at Ari price entry for trip packages
 * (Seth's decision 6); ticket tiers check it in agentTicketPricing.ts.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { isUuid, ToolError } from "../agentToolHelpers.ts";
import {
  type BrandReadiness,
  type BrandReadinessItem,
  readBrandReadiness,
} from "../agentReadinessTools.ts";
import type { ReadinessAction } from "../readinessCatalog.ts";
import { moneySummary } from "./moneySplit.ts";
import { ticketPriceBelowMinimum } from "./providerMinimums.ts";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function positive(value: unknown): boolean {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/** Same money-bearing rule as business_publish_event_draft (price > 0). */
export function draftTicketsMoneyBearing(theme: unknown): boolean {
  const tickets = record(record(theme).business_draft).tickets;
  return Array.isArray(tickets) && tickets.some((ticket) => {
    const t = record(ticket);
    return positive(t.priceMajor) || positive(t.price) || positive(t.priceGbp);
  });
}

function hasInstallments(metadata: unknown): boolean {
  const installments = record(metadata).installments;
  return installments !== undefined && installments !== null;
}

/** The tools whose proposals are checked against brand_readiness. */
export const PROPOSE_READINESS_TOOLS: ReadonlySet<string> = new Set([
  "publish_event",
  "publish_experience",
  "publish_trip",
  "publish_rsvp",
  "publish_stay",
  "manage_trip_tiers",
]);

const OFFERING_NOUN: Readonly<Record<string, string>> = Object.freeze({
  publish_event: "event",
  publish_experience: "experience",
  publish_trip: "trip",
  publish_rsvp: "RSVP",
  publish_stay: "stay",
  manage_trip_tiers: "trip",
});

async function eventRow(
  client: SupabaseClient,
  eventId: unknown,
): Promise<JsonRecord | null> {
  if (!isUuid(eventId)) return null;
  const { data } = await client.from("events")
    .select("id,brand_id,status,theme")
    .eq("id", eventId).maybeSingle();
  return data ? record(data) : null;
}

async function hasPaidTicketTypes(
  client: SupabaseClient,
  eventId: string,
): Promise<boolean> {
  const { data } = await client.from("ticket_types").select("id")
    .eq("event_id", eventId).is("deleted_at", null)
    .gt("price_cents", 0).limit(1);
  return Array.isArray(data) && data.length > 0;
}

async function tripHasInstallments(
  client: SupabaseClient,
  eventId: string,
): Promise<boolean> {
  const { data } = await client.from("trip_pricing_tiers")
    .select("tier_metadata").eq("event_id", eventId).limit(50);
  return Array.isArray(data) &&
    data.some((row) => hasInstallments(record(row).tier_metadata));
}

/** Which readiness action this proposal is, and for which brand. */
export async function proposeReadinessAction(
  toolName: string,
  args: JsonRecord,
  client: SupabaseClient,
): Promise<{ brandId: string; action: ReadinessAction } | null> {
  if (!PROPOSE_READINESS_TOOLS.has(toolName)) return null;
  if (toolName === "publish_stay") {
    return isUuid(args.brand_id)
      ? { brandId: args.brand_id, action: "stay_publish" }
      : null;
  }
  if (toolName === "manage_trip_tiers") {
    const items = Array.isArray(args.items) ? args.items : [];
    const wantsInstallments = items.some((item) =>
      record(item).deleted !== true &&
      hasInstallments(record(item).tier_metadata)
    );
    if (!wantsInstallments) return null;
    const event = await eventRow(client, args.event_id);
    return event && isUuid(event.brand_id)
      ? { brandId: event.brand_id, action: "trip_installments" }
      : null;
  }
  const event = await eventRow(client, args.event_id);
  if (!event || !isUuid(event.brand_id)) return null;
  const brandId = event.brand_id;
  if (toolName === "publish_rsvp") return { brandId, action: "publish_free" };
  const eventId = String(event.id);
  if (
    toolName === "publish_trip" && await tripHasInstallments(client, eventId)
  ) {
    return { brandId, action: "trip_installments" };
  }
  const paid = draftTicketsMoneyBearing(event.theme) ||
    await hasPaidTicketTypes(client, eventId);
  return { brandId, action: paid ? "publish_paid" : "publish_free" };
}

function blockerWords(item: BrandReadinessItem): string {
  if (item.key === "money.currency_reconciliation" && item.fix.can_caller_fix) {
    return `${item.label}: I can help you decide it here.`;
  }
  if (item.fix.can_caller_fix) {
    return item.fix.route
      ? `${item.label}: you can sort this in ${item.fix.route_label}.`
      : `${item.label}: ${item.fix.route_label}.`;
  }
  if (item.fix.who_can_fix === "the brand owner") {
    return `${item.label}: only the owner can do this — tell them?`;
  }
  return `${item.label}: only ${item.fix.who_can_fix} can do this.`;
}

const ACTION_WORDS: Readonly<Partial<Record<ReadinessAction, string>>> = Object
  .freeze({
    publish_free: "publish this",
    publish_paid: "put this on sale",
    trip_installments: "take deposits or instalments on this",
    stay_publish: "publish this stay",
  });

/**
 * Only items that mirror a hard server gate on the publish path refuse a
 * proposal early, so Ari never blocks a publish the server would accept
 * (Seth: no publishing regression). Role = the publish RPC's rank check;
 * can sell = pg_brand_can_collect; currency review = the pending
 * reconciliation inside it; Terms = biz_require_current_organiser_terms;
 * payouts = pg_brand_can_payout on instalment plans. A brand currency is a
 * hard gate only for stays (paid_currency_not_ready); events resolve theirs
 * from the event or payout account. Everything else waits for the server.
 */
const SERVER_MIRRORED_BLOCKERS: ReadonlySet<string> = new Set([
  "team.role",
  "money.can_sell",
  "money.currency_reconciliation",
  "money.terms_member",
  "money.can_be_paid_out",
]);

function mirrorsServerGate(
  item: BrandReadinessItem,
  action: ReadinessAction | null,
): boolean {
  return SERVER_MIRRORED_BLOCKERS.has(item.key) ||
    (item.key === "money.currency" && action === "stay_publish");
}

/** The plain refusal for a blocked proposal, or null when nothing blocks. */
export function readinessRefusal(
  readiness: BrandReadiness,
  toolName: string,
): string | null {
  const blocking = readiness.items.filter((item) =>
    item.blocks_action && mirrorsServerGate(item, readiness.action)
  );
  if (blocking.length === 0) return null;
  const noun = OFFERING_NOUN[toolName] ?? "offering";
  const words = readiness.action
    ? ACTION_WORDS[readiness.action] ?? `go ahead with this ${noun}`
    : `go ahead with this ${noun}`;
  return [
    `Before I can ${words}, ${
      blocking.length === 1 ? "this needs" : "these need"
    } doing:`,
    ...blocking.map((item) => `- ${blockerWords(item)}`),
    "Nothing was changed.",
  ].join("\n");
}

/**
 * Propose-time readiness. Throws READINESS_BLOCKED (said to the owner as
 * plain words before any card) or returns card context. Null = not a
 * readiness-checked proposal, or the read is unavailable (server backstop).
 */
export async function preflightReadinessProposal(
  toolName: string,
  args: JsonRecord,
  client: SupabaseClient,
): Promise<JsonRecord | null> {
  const target = await proposeReadinessAction(toolName, args, client);
  if (!target) return null;
  let readiness: BrandReadiness;
  try {
    readiness = await readBrandReadiness(client, target.brandId, target.action);
  } catch (error) {
    if (
      error instanceof ToolError &&
      ["READINESS_UNAVAILABLE", "RPC_FAILED"].includes(error.code)
    ) return null;
    throw error;
  }
  const refusal = readinessRefusal(readiness, toolName);
  if (refusal) throw new ToolError("READINESS_BLOCKED", refusal);
  const paid = target.action !== "publish_free";
  return {
    readiness_action: target.action,
    ...(paid ? { money_position: moneySummary(readiness.money) } : {}),
  };
}

/** Decision 6 at Ari price entry for trip packages (minor units). */
export async function preflightTripPackagePrices(
  toolName: string,
  args: JsonRecord,
  client: SupabaseClient,
): Promise<void> {
  if (toolName !== "manage_trip_tiers") return;
  const items = (Array.isArray(args.items) ? args.items : []).map(record)
    .filter((item) => item.deleted !== true && positive(item.price_cents));
  if (items.length === 0 || !isUuid(args.event_id)) return;
  const { data: event } = await client.from("events")
    .select("currency,brand_id").eq("id", args.event_id).maybeSingle();
  let currency = record(event).currency;
  if (typeof currency !== "string" && isUuid(record(event).brand_id)) {
    const { data: brand } = await client.from("brands")
      .select("default_currency").eq("id", record(event).brand_id)
      .maybeSingle();
    currency = record(brand).default_currency;
  }
  if (typeof currency !== "string") return;
  for (const item of items) {
    const price = Number(item.price_cents);
    if (isUuid(item.ticket_type_id)) {
      const { data: existing } = await client.from("ticket_types")
        .select("price_cents,is_free").eq("id", item.ticket_type_id)
        .maybeSingle();
      const old = record(existing);
      // An untouched older price stays valid (the server agrees).
      if (old.is_free !== true && Number(old.price_cents) === price) continue;
    }
    const message = ticketPriceBelowMinimum(price, currency);
    if (message) {
      throw new ToolError(
        "TICKET_PRICE_BELOW_MINIMUM",
        `${message} Nothing was changed.`,
      );
    }
  }
}
