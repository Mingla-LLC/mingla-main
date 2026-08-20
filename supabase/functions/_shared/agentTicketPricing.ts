// Issue #1974 — canonical ticket/pricing adapter shared by Ari proposal
// preflight and confirmation execution. It deliberately owns no receipt table:
// the immutable operationId comes from agent-confirm-action and is the seam to
// #1972's shared atomic operation receipt.

// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { assertCanCollect, isUuid, ToolError } from "./agentToolHelpers.ts";

export const PRICING_STATE_VALUES = [
  "inherit",
  "pass_to_buyer",
  "included_in_price",
  "absorb_by_brand",
] as const;

export type PricingState = typeof PRICING_STATE_VALUES[number];

export interface CanonicalTicketTier {
  id: string;
  name: string;
  isFree: boolean;
  isUnlimited: boolean;
  priceGbp: number | null;
  capacity: number | null;
  visibility: "public" | "hidden" | "disabled";
  displayOrder: number;
  approvalRequired: boolean;
  passwordProtected: boolean;
  passwordConfigured: boolean;
  waitlistEnabled: boolean;
  minPurchaseQty: number;
  maxPurchaseQty: number | null;
  allowTransfers: boolean;
  description: string | null;
  saleStartAt: string | null;
  saleEndAt: string | null;
  availableAt: "online" | "door" | "both";
}

const record = (value: unknown): Record<string, any> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};

const nullableString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const finiteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function normalizeDraftTier(
  value: unknown,
  index = 0,
): CanonicalTicketTier {
  const tier = record(value);
  const price = finiteNumber(tier.priceGbp ?? tier.price ?? tier.priceMajor);
  return {
    id: typeof tier.id === "string" ? tier.id : "",
    name: typeof tier.name === "string" ? tier.name : "",
    isFree: tier.isFree === true,
    isUnlimited: tier.isUnlimited === true,
    priceGbp: price,
    capacity: finiteNumber(tier.capacity),
    visibility: tier.visibility === "hidden" || tier.visibility === "disabled"
      ? tier.visibility
      : "public",
    displayOrder: finiteNumber(tier.displayOrder) ?? index,
    approvalRequired: tier.approvalRequired === true,
    passwordProtected: tier.passwordProtected === true,
    passwordConfigured: tier.passwordConfigured === true,
    waitlistEnabled: tier.waitlistEnabled === true,
    minPurchaseQty: finiteNumber(tier.minPurchaseQty) ?? 1,
    maxPurchaseQty: finiteNumber(tier.maxPurchaseQty),
    allowTransfers: tier.allowTransfers !== false,
    description: nullableString(tier.description),
    saleStartAt: nullableString(tier.saleStartAt),
    saleEndAt: nullableString(tier.saleEndAt),
    availableAt: tier.availableAt === "online" || tier.availableAt === "door"
      ? tier.availableAt
      : "both",
  };
}

export function normalizeLiveTier(
  value: unknown,
  index = 0,
): CanonicalTicketTier {
  const tier = record(value);
  return {
    id: String(tier.id ?? ""),
    name: String(tier.name ?? ""),
    isFree: tier.is_free === true,
    isUnlimited: tier.is_unlimited === true,
    priceGbp: typeof tier.price_cents === "number"
      ? tier.price_cents / 100
      : null,
    capacity: finiteNumber(tier.quantity_total),
    visibility: tier.is_hidden === true
      ? "hidden"
      : tier.is_disabled === true
      ? "disabled"
      : "public",
    displayOrder: finiteNumber(tier.display_order) ?? index,
    approvalRequired: tier.requires_approval === true,
    passwordProtected: tier.password_protected === true,
    passwordConfigured: typeof tier.password_hash === "string" &&
      tier.password_hash.length > 0,
    waitlistEnabled: tier.waitlist_enabled === true,
    minPurchaseQty: finiteNumber(tier.min_purchase_qty) ?? 1,
    maxPurchaseQty: finiteNumber(tier.max_purchase_qty),
    allowTransfers: tier.allow_transfers !== false,
    description: nullableString(tier.description),
    saleStartAt: nullableString(tier.sale_start_at),
    saleEndAt: nullableString(tier.sale_end_at),
    availableAt:
      tier.available_online === true && tier.available_in_person === true
        ? "both"
        : tier.available_in_person === true
        ? "door"
        : "online",
  };
}

export function applyTierPatch(
  current: CanonicalTicketTier | null,
  args: Record<string, unknown>,
  operationId: string,
  nextDisplayOrder: number,
): CanonicalTicketTier {
  const creating = current === null;
  if (!isUuid(operationId)) {
    throw new ToolError(
      "EXECUTION_CONTEXT_REQUIRED",
      "A server operation id is required",
    );
  }
  const requiredBoolean = (key: string): boolean => {
    if (typeof args[key] !== "boolean") {
      throw new ToolError(
        "INVALID_ARGS",
        `${key} is required when creating a tier`,
      );
    }
    return args[key] as boolean;
  };
  const name = args.name === undefined
    ? current?.name
    : nullableString(args.name);
  if (!name) throw new ToolError("INVALID_ARGS", "name is required");
  const isFree = args.is_free === undefined
    ? current?.isFree ?? requiredBoolean("is_free")
    : args.is_free === true;
  const isUnlimited = args.is_unlimited === undefined
    ? current?.isUnlimited ?? requiredBoolean("is_unlimited")
    : args.is_unlimited === true;
  const priceCents = args.price_cents === undefined
    ? current?.priceGbp == null ? null : Math.round(current.priceGbp * 100)
    : finiteNumber(args.price_cents);
  const capacity = args.capacity === undefined
    ? current?.capacity ?? null
    : finiteNumber(args.capacity);

  const next: CanonicalTicketTier = {
    id: current?.id ?? operationId,
    name,
    isFree,
    isUnlimited,
    priceGbp: isFree ? null : priceCents === null ? null : priceCents / 100,
    capacity: isUnlimited ? null : capacity,
    visibility:
      args.visibility === "hidden" || args.visibility === "disabled" ||
        args.visibility === "public"
        ? args.visibility
        : current?.visibility ?? "public",
    displayOrder: typeof args.display_order === "number"
      ? args.display_order
      : current?.displayOrder ?? nextDisplayOrder,
    approvalRequired: typeof args.approval_required === "boolean"
      ? args.approval_required
      : current?.approvalRequired ?? false,
    passwordProtected: current?.passwordProtected ?? false,
    passwordConfigured: current?.passwordConfigured ?? false,
    waitlistEnabled: typeof args.waitlist_enabled === "boolean"
      ? args.waitlist_enabled
      : current?.waitlistEnabled ?? false,
    minPurchaseQty: typeof args.min_purchase_qty === "number"
      ? args.min_purchase_qty
      : current?.minPurchaseQty ?? 1,
    maxPurchaseQty: args.max_purchase_qty === null
      ? null
      : typeof args.max_purchase_qty === "number"
      ? args.max_purchase_qty
      : current?.maxPurchaseQty ?? null,
    allowTransfers: typeof args.allow_transfers === "boolean"
      ? args.allow_transfers
      : current?.allowTransfers ?? true,
    description: args.description === null
      ? null
      : args.description === undefined
      ? current?.description ?? null
      : nullableString(args.description),
    saleStartAt: args.sale_start_at === null
      ? null
      : args.sale_start_at === undefined
      ? current?.saleStartAt ?? null
      : nullableString(args.sale_start_at),
    saleEndAt: args.sale_end_at === null
      ? null
      : args.sale_end_at === undefined
      ? current?.saleEndAt ?? null
      : nullableString(args.sale_end_at),
    availableAt:
      args.available_at === "online" || args.available_at === "door" ||
        args.available_at === "both"
        ? args.available_at
        : current?.availableAt ?? "both",
  };
  validateTier(next, creating);
  return next;
}

export function validateTier(
  tier: CanonicalTicketTier,
  _creating = false,
): void {
  if (!tier.id || tier.id.length > 100) {
    throw new ToolError("INVALID_ARGS", "tier_id is invalid");
  }
  if (!tier.name.trim()) {
    throw new ToolError("INVALID_ARGS", "name is required");
  }
  if (tier.isFree && tier.priceGbp !== null && tier.priceGbp !== 0) {
    throw new ToolError("INVALID_ARGS", "free tiers must have a zero price");
  }
  if (!tier.isFree && (tier.priceGbp === null || tier.priceGbp <= 0)) {
    throw new ToolError(
      "INVALID_ARGS",
      "paid tiers require price_cents greater than zero",
    );
  }
  if (
    !tier.isUnlimited &&
    (!Number.isInteger(tier.capacity) || (tier.capacity ?? 0) <= 0)
  ) {
    throw new ToolError(
      "INVALID_ARGS",
      "limited tiers require capacity greater than zero",
    );
  }
  if (tier.isUnlimited && tier.waitlistEnabled) {
    throw new ToolError(
      "INVALID_ARGS",
      "unlimited tiers cannot use a waitlist",
    );
  }
  if (!Number.isInteger(tier.minPurchaseQty) || tier.minPurchaseQty < 1) {
    throw new ToolError(
      "INVALID_ARGS",
      "min_purchase_qty must be at least one",
    );
  }
  if (
    tier.maxPurchaseQty !== null &&
    (!Number.isInteger(tier.maxPurchaseQty) ||
      tier.maxPurchaseQty < tier.minPurchaseQty)
  ) {
    throw new ToolError(
      "INVALID_ARGS",
      "max_purchase_qty must be at least min_purchase_qty",
    );
  }
  if ((tier.description?.length ?? 0) > 280) {
    throw new ToolError(
      "INVALID_ARGS",
      "description must be 280 characters or fewer",
    );
  }
  if (
    tier.saleStartAt && tier.saleEndAt &&
    Date.parse(tier.saleEndAt) <= Date.parse(tier.saleStartAt)
  ) {
    throw new ToolError(
      "INVALID_ARGS",
      "sale_end_at must be after sale_start_at",
    );
  }
}

export async function requireActiveTaxRegistration(
  client: SupabaseClient,
  brandId: string,
): Promise<void> {
  const { data, error } = await client.functions.invoke(
    "brand-tax-registrations-list",
    {
      body: { brand_id: brandId },
    },
  );
  if (error || record(data).hasActiveRegistration !== true) {
    throw new ToolError(
      "TAX_REGISTRATION_REQUIRED",
      "Set up an active tax registration in Brand > Payments before passing tax to buyers.",
    );
  }
}

export async function loadEventTicketState(
  client: SupabaseClient,
  eventId: string,
): Promise<{
  event: Record<string, any>;
  tiers: CanonicalTicketTier[];
}> {
  const { data: event, error } = await client.from("events")
    .select(
      "id,brand_id,event_type,status,currency,theme,updated_at,pricing_locked_at,deleted_at,pass_tax,pass_mingla_fee,pass_service_fee",
    )
    .eq("id", eventId).is("deleted_at", null).maybeSingle();
  if (error) throw new ToolError("RESOURCE_CHECK_FAILED", error.message);
  if (!event) {
    throw new ToolError("BRAND_ACCESS_DENIED", "That event is unavailable");
  }
  if (event.event_type !== "event" && event.event_type !== "experience") {
    throw new ToolError(
      "INVALID_ARGS",
      "Ticket tiers are not managed on that offering type",
    );
  }
  if (event.status === "draft") {
    const tickets = record(record(event.theme).business_draft).tickets;
    return {
      event,
      tiers: Array.isArray(tickets) ? tickets.map(normalizeDraftTier) : [],
    };
  }
  const { data: rows, error: tiersError } = await client.from("ticket_types")
    .select(
      "id,name,description,price_cents,quantity_total,is_unlimited,is_free,sale_start_at,sale_end_at,min_purchase_qty,max_purchase_qty,is_hidden,is_disabled,requires_approval,allow_transfers,password_protected,password_hash,available_online,available_in_person,waitlist_enabled,display_order",
    )
    .eq("event_id", eventId).is("deleted_at", null).order("display_order", {
      ascending: true,
    });
  if (tiersError) {
    throw new ToolError("RESOURCE_CHECK_FAILED", tiersError.message);
  }
  return { event, tiers: (rows ?? []).map(normalizeLiveTier) };
}

export async function preflightTicketPricingProposal(
  toolName: string,
  args: Record<string, unknown>,
  client: SupabaseClient,
): Promise<Record<string, unknown> | null> {
  if (toolName === "upsert_ticket_tier") {
    if (!isUuid(args.event_id)) {
      throw new ToolError("INVALID_ARGS", "event_id must be a uuid");
    }
    const { event, tiers } = await loadEventTicketState(client, args.event_id);
    const current = typeof args.tier_id === "string"
      ? tiers.find((tier) => tier.id === args.tier_id) ?? null
      : null;
    if (typeof args.tier_id === "string" && current === null) {
      throw new ToolError(
        "INVALID_ARGS",
        "That tier is stale or belongs to another event",
      );
    }
    const proposed = applyTierPatch(
      current,
      args,
      "00000000-0000-4000-8000-000000001974",
      tiers.reduce((max, tier) => Math.max(max, tier.displayOrder), -1) + 1,
    );
    const mustCheckPayout = !proposed.isFree &&
      (current === null || current.isFree);
    if (mustCheckPayout) await assertCanCollect(client, event.brand_id);
    const [{ data: brand }, { data: connectedAccount }] = await Promise.all([
      client.from("brands").select("default_currency")
        .eq("id", event.brand_id).maybeSingle(),
      client.from("stripe_connect_accounts").select("default_currency")
        .eq("brand_id", event.brand_id).is("detached_at", null).maybeSingle(),
    ]);
    const effectiveCurrency = event.currency ??
      connectedAccount?.default_currency ?? brand?.default_currency ?? null;
    if (!proposed.isFree && effectiveCurrency === null) {
      throw new ToolError(
        "EVENT_CURRENCY_REQUIRED",
        "Connect a payout account with a currency before adding a paid tier",
      );
    }
    return {
      lifecycle: event.status === "draft" ? "draft" : "live",
      action: current === null ? "create" : "update",
      tier_name: proposed.name,
      current_price_cents: current?.priceGbp == null
        ? null
        : Math.round(current.priceGbp * 100),
      proposed_price_cents: proposed.priceGbp == null
        ? null
        : Math.round(proposed.priceGbp * 100),
      current_capacity: current?.capacity ?? null,
      proposed_capacity: proposed.capacity,
      effective_currency: effectiveCurrency,
      available_at: proposed.availableAt,
      payout_ready: mustCheckPayout ? true : null,
    };
  }
  if (toolName === "set_pricing_switches") {
    if (!isUuid(args.event_id)) {
      throw new ToolError("INVALID_ARGS", "event_id must be a uuid");
    }
    const { event } = await loadEventTicketState(client, args.event_id);
    if (args.tax === "pass_to_buyer" || args.tax === "included_in_price") {
      await requireActiveTaxRegistration(client, event.brand_id);
    }
    return {
      lifecycle: event.status === "draft" ? "draft" : "live",
      current_tax: event.pass_tax ?? null,
      current_mingla_fee: event.pass_mingla_fee ?? null,
      current_service_fee: event.pass_service_fee ?? null,
      proposed_tax: args.tax ?? "unchanged",
      proposed_mingla_fee: args.mingla_fee ?? "unchanged",
      proposed_service_fee: args.service_fee ?? "unchanged",
    };
  }
  if (toolName === "set_brand_pricing_defaults") {
    if (!isUuid(args.brand_id)) {
      throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
    }
    if (args.tax === "pass_to_buyer" || args.tax === "included_in_price") {
      await requireActiveTaxRegistration(client, args.brand_id);
    }
    const { data: brand, error } = await client.from("brands")
      .select(
        "default_pass_tax,default_pass_mingla_fee,default_pass_service_fee",
      )
      .eq("id", args.brand_id).maybeSingle();
    if (error || !brand) {
      throw new ToolError("BRAND_ACCESS_DENIED", "That brand is unavailable");
    }
    return {
      current_tax: brand.default_pass_tax,
      current_mingla_fee: brand.default_pass_mingla_fee,
      current_service_fee: brand.default_pass_service_fee,
      proposed_tax: args.tax ?? "unchanged",
      proposed_mingla_fee: args.mingla_fee ?? "unchanged",
      proposed_service_fee: args.service_fee ?? "unchanged",
    };
  }
  return null;
}
