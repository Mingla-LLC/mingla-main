/**
 * Marketing audience query service (ORCH-0815-A2).
 *
 * Resolves discriminated-union audience queries (I-PROPOSED-BP) into
 * `BuyerRowData` lists for two surfaces:
 *
 *   - resolveBrandBuyers(brandId)   →  every distinct buyer of any event
 *                                       under that brand (paid + partial_refund)
 *   - resolveEventBuyers(eventId)   →  every distinct buyer of one specific event
 *
 * Both functions:
 *   1. Pull `orders` rows scoped to the target with `payment_status IN
 *      ('paid','partial_refund')`.
 *   2. Group by buyer email (canonical identity for Phase A).
 *   3. Aggregate order_count + total_spend + last purchase.
 *   4. Left-join `marketing_unsubscribes` (brand-scoped + global) to compute
 *      per-channel reachability.
 *   5. Mask contact for display (`ale**@gmail.com` / `(555) ***-1234`).
 *
 * Service-layer error contract:
 *   - Network or RLS errors throw — caller (hook) translates to error state.
 *   - Empty result returns `{ rows: [], reach: {total:0,...} }` — NOT thrown.
 *
 * NEVER use SECURITY DEFINER helpers in SELECT predicates — RLS is already
 * gated on `marketing_unsubscribes_select` policy. Service relies on RLS, not
 * caller-side filtering for security.
 *
 * SPEC reference: SPEC §5.7 (Brand Customers), §5.8 (Event Buyers), §11 T-01..T-04.
 */

import { supabase } from "../supabase";
import type {
  AudienceReachSummary,
  BuyerConsentSummary,
  BuyerRowData,
  MarketingChannel,
} from "../../types/marketing";

// ---------------------------------------------------------------------------
// UUID validation (P1-2 fix, ORCH-0815-A2-B follow-up 2026-05-12)
// ---------------------------------------------------------------------------
// The `.or()` PostgREST filter builder accepts a raw filter STRING — it is
// NOT parameterized like `.eq()`. Any user-controllable value interpolated
// into the filter string is a filter-injection vector. RLS prevents data
// exfiltration, but pathological IDs (commas, parens, single quotes) can
// silently corrupt the unsubscribe filter — over-suppress or under-suppress
// — which is a CAN-SPAM compliance risk in production.
//
// Defensive guard: assert every ID is a strict UUID before letting it reach
// the `.or()` builder. Bare `.eq()` calls are safe (parameterized) and need
// no extra check, but consistency keeps the contract simple.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`${label}: expected UUID, got ${JSON.stringify(value)}`);
  }
}

// ---------------------------------------------------------------------------
// Input contracts
// ---------------------------------------------------------------------------

export interface ResolveBuyersResult {
  rows: BuyerRowData[];
  reach: AudienceReachSummary;
}

interface OrderRowForAudience {
  id: string;
  event_id: string;
  buyer_email: string | null;
  buyer_name: string | null;
  buyer_phone: string | null;
  buyer_phone_e164: string | null;
  total_cents: number;
  currency: string;
  payment_status: string;
  confirmed_at: string | null;
  created_at: string;
  events: {
    id: string;
    title: string | null;
    brand_id: string;
  } | null;
}

interface UnsubRow {
  contact_email: string | null;
  channel: string;
  scope: string;
  brand_id: string | null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Resolve "all buyers of a brand" audience. */
export async function resolveBrandBuyers(
  brandId: string,
): Promise<ResolveBuyersResult> {
  if (!brandId) {
    throw new Error("resolveBrandBuyers: brandId is required");
  }
  assertUuid(brandId, "resolveBrandBuyers.brandId");

  // Step 1 — pull every paid/partial_refund order whose event belongs to this brand.
  // events!inner enforces the join filter.
  const { data, error } = await supabase
    .from("orders")
    .select(
      `
        id,
        event_id,
        buyer_email,
        buyer_name,
        buyer_phone,
        buyer_phone_e164,
        total_cents,
        currency,
        payment_status,
        confirmed_at,
        created_at,
        events!inner ( id, title, brand_id )
      `,
    )
    .in("payment_status", ["paid", "partial_refund"])
    .eq("events.brand_id", brandId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const orders = (data ?? []) as unknown as OrderRowForAudience[];

  // Step 2 — pull all unsubscribes that could affect this brand
  // (global + this brand's scope). Phase A only checks email channel.
  const { data: unsubData, error: unsubError } = await supabase
    .from("marketing_unsubscribes")
    .select("contact_email, channel, scope, brand_id")
    .or(`scope.eq.global,and(scope.eq.brand,brand_id.eq.${brandId})`);

  if (unsubError) throw unsubError;

  const unsubs = (unsubData ?? []) as unknown as UnsubRow[];

  return aggregateBuyers(orders, unsubs, brandId);
}

/** Resolve "all buyers of a single event" audience. */
export async function resolveEventBuyers(
  eventId: string,
): Promise<ResolveBuyersResult> {
  if (!eventId) {
    throw new Error("resolveEventBuyers: eventId is required");
  }
  assertUuid(eventId, "resolveEventBuyers.eventId");

  const { data, error } = await supabase
    .from("orders")
    .select(
      `
        id,
        event_id,
        buyer_email,
        buyer_name,
        buyer_phone,
        buyer_phone_e164,
        total_cents,
        currency,
        payment_status,
        confirmed_at,
        created_at,
        events!inner ( id, title, brand_id )
      `,
    )
    .in("payment_status", ["paid", "partial_refund"])
    .eq("event_id", eventId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const orders = (data ?? []) as unknown as OrderRowForAudience[];

  // Brand-scoped unsubs need brand_id from any one of the orders we just pulled.
  const brandId = orders[0]?.events?.brand_id ?? null;

  let unsubs: UnsubRow[] = [];
  if (brandId !== null) {
    // Defensive UUID guard — brandId here is server-derived from
    // orders[0].events.brand_id (RLS-gated) but the `.or()` builder
    // accepts a raw filter string, so we revalidate before composition.
    assertUuid(brandId, "resolveEventBuyers.brandId (server-derived)");
    const { data: unsubData, error: unsubError } = await supabase
      .from("marketing_unsubscribes")
      .select("contact_email, channel, scope, brand_id")
      .or(`scope.eq.global,and(scope.eq.brand,brand_id.eq.${brandId})`);

    if (unsubError) throw unsubError;
    unsubs = (unsubData ?? []) as unknown as UnsubRow[];
  }

  return aggregateBuyers(orders, unsubs, brandId);
}

// ---------------------------------------------------------------------------
// Aggregation + masking
// ---------------------------------------------------------------------------

interface BuyerAccumulator {
  display_name: string;
  raw_email: string | null;
  raw_phone: string | null;
  order_count: number;
  total_spend_minor: number;
  total_spend_currency: string;
  last_event_id: string | null;
  last_event_name: string | null;
  last_purchase_at: string | null;
}

function aggregateBuyers(
  orders: OrderRowForAudience[],
  unsubs: UnsubRow[],
  brandIdForScope: string | null,
): ResolveBuyersResult {
  // Build unsub lookup: email → channels that are suppressed.
  const unsubLookup = new Map<string, Set<MarketingChannel>>();
  let hasGlobalAllEmail = false;
  for (const u of unsubs) {
    if (u.contact_email === null) continue;
    const email = u.contact_email.toLowerCase();
    // Global scope = suppression across all brands.
    // Brand scope already filtered by query above (only matching brandId).
    const channelsForEmail =
      unsubLookup.get(email) ?? new Set<MarketingChannel>();
    if (u.channel === "all") {
      channelsForEmail.add("email");
      channelsForEmail.add("sms");
      channelsForEmail.add("rcs");
      if (u.scope === "global") hasGlobalAllEmail = true;
    } else if (
      u.channel === "email" ||
      u.channel === "sms" ||
      u.channel === "rcs"
    ) {
      channelsForEmail.add(u.channel);
    }
    unsubLookup.set(email, channelsForEmail);
  }
  // Hint to silence "unused" — `brandIdForScope` is the contextual key for
  // future per-brand consent logic; for Phase A we only need email/SMS/RCS
  // booleans which the unsub query above already filtered. Keep argument for
  // call-site clarity.
  void brandIdForScope;
  void hasGlobalAllEmail;

  // Group orders by buyer email (canonical identity for Phase A).
  const buckets = new Map<string, BuyerAccumulator>();
  for (const o of orders) {
    const key = (o.buyer_email ?? "").toLowerCase().trim();
    if (key === "") continue; // skip anonymous orders for marketing audiences
    const existing = buckets.get(key);
    if (existing === undefined) {
      buckets.set(key, {
        display_name: o.buyer_name ?? "Anonymous buyer",
        raw_email: o.buyer_email,
        raw_phone: o.buyer_phone_e164 ?? o.buyer_phone,
        order_count: 1,
        total_spend_minor: o.total_cents,
        total_spend_currency: o.currency,
        last_event_id: o.events?.id ?? o.event_id,
        last_event_name: o.events?.title ?? null,
        last_purchase_at: o.confirmed_at ?? o.created_at,
      });
    } else {
      existing.order_count += 1;
      existing.total_spend_minor += o.total_cents;
      // Orders were sorted desc by created_at; first hit is most recent.
      // If a subsequent buyer record has a missing phone but earlier had one,
      // preserve earlier value.
      if (existing.raw_phone === null && o.buyer_phone_e164 !== null) {
        existing.raw_phone = o.buyer_phone_e164;
      }
    }
  }

  // Build BuyerRowData[] + reach summary.
  const rows: BuyerRowData[] = [];
  let reachableEmail = 0;
  let reachableSms = 0;
  for (const [emailKey, acc] of buckets.entries()) {
    const suppressed = unsubLookup.get(emailKey) ?? new Set<MarketingChannel>();
    const consent: BuyerConsentSummary = {
      email_marketing_ok:
        acc.raw_email !== null && !suppressed.has("email"),
      sms_marketing_ok:
        acc.raw_phone !== null && !suppressed.has("sms"),
      unsubscribed_brand_scope: suppressed.size > 0,
      unsubscribed_global_scope: false,
    };
    if (consent.email_marketing_ok) reachableEmail += 1;
    if (consent.sms_marketing_ok) reachableSms += 1;
    rows.push({
      contact_key: emailKey,
      display_name: acc.display_name,
      masked_email: maskEmail(acc.raw_email),
      raw_email: acc.raw_email,
      masked_phone: maskPhone(acc.raw_phone),
      raw_phone: acc.raw_phone,
      order_count: acc.order_count,
      total_spend_minor: acc.total_spend_minor,
      total_spend_currency: acc.total_spend_currency,
      last_event_id: acc.last_event_id,
      last_event_name: acc.last_event_name,
      last_purchase_at: acc.last_purchase_at,
      consent,
    });
  }

  // Sort by last_purchase_at desc for default UI ordering.
  rows.sort((a, b) => {
    const ta = a.last_purchase_at ?? "";
    const tb = b.last_purchase_at ?? "";
    return tb.localeCompare(ta);
  });

  return {
    rows,
    reach: {
      total: rows.length,
      reachable_email: reachableEmail,
      reachable_sms: reachableSms,
    },
  };
}

// ---------------------------------------------------------------------------
// Masking helpers — privacy-on-display defaults per DESIGN §13.2
// ---------------------------------------------------------------------------

/** `alex@gmail.com` → `ale**@gmail.com`. Returns null if input is null. */
export function maskEmail(email: string | null): string | null {
  if (email === null || email.trim() === "") return null;
  const at = email.indexOf("@");
  if (at < 1) return email; // malformed — return as-is rather than fabricate
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 3) return local + "**" + domain;
  return local.slice(0, 3) + "**" + domain;
}

/** `+15555551234` → `(555) ***-1234`. Returns null if input is null. */
export function maskPhone(phone: string | null): string | null {
  if (phone === null) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return phone; // malformed — pass through
  const last4 = digits.slice(-4);
  const area = digits.slice(-10, -7);
  return `(${area}) ***-${last4}`;
}
