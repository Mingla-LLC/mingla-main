// Issue #4271 — server-side door sale pricing and permission, shared by
// door-pay-code, door-tap-intent and terminal-connection-token.

import { resolveProviderRouting } from "./paymentProvider.ts";
import {
  computeDoorMoney,
  doorErrorFromDb,
  doorTaxAddedAtCheckout,
  type DoorPricingRow,
  parseDoorLines,
} from "./doorPay.ts";

// deno-lint-ignore no-explicit-any
type Client = any;

export interface PricedLine {
  ticketTypeId: string;
  name: string;
  quantity: number;
  unitCents: number;
}

export async function canTakeDoorPayment(
  supabase: Client,
  eventId: string,
  actorId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    "issue_4271_can_take_door_payment",
    { p_event_id: eventId, p_actor_id: actorId },
  );
  if (error) throw new Error(`door_permission_lookup_failed:${error.message}`);
  return data === true;
}

/**
 * Brand readiness and the pricing switches, shared with door-tap-intent's
 * shape. Returns null when the brand cannot take card money yet.
 */
export async function loadDoorPricing(
  supabase: Client,
  eventId: string,
): Promise<
  | {
    pricing: DoorPricingRow;
    provider: "stripe" | "paystack";
    stripeAccountId: string | null;
    paymentCountry: string;
    venueTaxAddress: Record<string, unknown> | null;
  }
  | null
> {
  const { data: rows, error } = await supabase.rpc(
    "resolve_event_pricing_inputs",
    { p_event_id: eventId },
  );
  if (error || !Array.isArray(rows) || rows.length === 0) return null;
  const row = rows[0] as DoorPricingRow & {
    stripe_account_id: string | null;
    payment_provider: string | null;
    payment_country: string | null;
    paystack_subaccount_code: string | null;
  };
  const routing = resolveProviderRouting(row);
  const { data: brandRow } = await supabase
    .from("events")
    .select("brands!inner(stripe_charges_enabled,payout_hold_cutover_at)")
    .eq("id", eventId)
    .maybeSingle();
  const rel = (brandRow as { brands?: unknown } | null)?.brands;
  const brand = (Array.isArray(rel) ? rel[0] : rel) as
    | { stripe_charges_enabled?: boolean; payout_hold_cutover_at?: string | null }
    | undefined;
  if (routing.provider === "paystack") {
    const cutover = (brand?.payout_hold_cutover_at ?? null) !== null;
    if (!cutover && !row.paystack_subaccount_code) return null;
  } else if (!row.stripe_account_id || brand?.stripe_charges_enabled !== true) {
    return null;
  }
  return {
    pricing: row,
    provider: routing.provider,
    stripeAccountId: routing.provider === "stripe" ? row.stripe_account_id : null,
    paymentCountry: routing.country,
    venueTaxAddress: (row as { venue_tax_address?: Record<string, unknown> | null })
      .venue_tax_address ?? null,
  };
}

/** issue_4271_door_quote_lines + the online-checkout money engine. */
export async function quoteDoorSale(
  supabase: Client,
  input: { eventId: string; eventDateId: string | null; lines: unknown },
): Promise<
  | {
    ok: true;
    brandId: string;
    lines: PricedLine[];
    money: ReturnType<typeof computeDoorMoney>;
    provider: "stripe" | "paystack";
    stripeAccountId: string | null;
    paymentCountry: string;
  }
  | { ok: false; error: string; status: number }
> {
  const lines = parseDoorLines(input.lines);
  if (lines === null) return { ok: false, error: "invalid_lines", status: 400 };
  const { data: quote, error: quoteError } = await supabase.rpc(
    "issue_4271_door_quote_lines",
    {
      p_event_id: input.eventId,
      p_event_date_id: input.eventDateId,
      p_lines: lines,
    },
  );
  if (quoteError || quote === null || typeof quote !== "object") {
    const mapped = doorErrorFromDb(quoteError?.message);
    return {
      ok: false,
      error: mapped.error === "server_error" ? "invalid_lines" : mapped.error,
      status: 400,
    };
  }
  const priced = quote as {
    brandId: string;
    subtotalCents: number;
    lines: PricedLine[];
  };
  const loaded = await loadDoorPricing(supabase, input.eventId);
  if (loaded === null) {
    return { ok: false, error: "stripe_account_not_ready", status: 400 };
  }
  // Never take money with the wrong total.
  if (doorTaxAddedAtCheckout(loaded.pricing, loaded.provider)) {
    return { ok: false, error: "door_tax_added_at_checkout", status: 400 };
  }
  const money = computeDoorMoney(
    loaded.pricing,
    loaded.provider,
    Number(priced.subtotalCents),
  );
  if (money.totalCents <= 0) {
    return { ok: false, error: "invalid_lines", status: 400 };
  }
  return {
    ok: true,
    brandId: priced.brandId,
    lines: priced.lines,
    money,
    provider: loaded.provider,
    stripeAccountId: loaded.stripeAccountId,
    paymentCountry: loaded.paymentCountry,
  };
}

