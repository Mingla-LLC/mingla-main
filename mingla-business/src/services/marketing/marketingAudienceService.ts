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
  AudienceListEntry,
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

/**
 * Resolve "all going (+approved) guests of an RSVP event" audience.
 *
 * ORCH-1150 (D-8) — RSVP events have ZERO `orders` rows, so `resolveEventBuyers`
 * (orders-derived) returns an empty audience forever. RSVP attendees live in
 * `event_rsvps` (going + approved). This reads them under the host-read RLS
 * (`event_rsvps_host_read`: brand-scoped, biz_brand_effective_rank >=
 * event_manager — confirmed covers this SELECT), shapes the result IDENTICALLY
 * to `resolveEventBuyers` ({ rows, reach }) so the shared Blasts UI + BuyerRow
 * render with no branching. RSVP guests have no purchase, so order_count = 0,
 * spend = 0, currency falls back to "USD" purely for the row type (never shown).
 */
export async function resolveRsvpGuests(
  eventId: string,
): Promise<ResolveBuyersResult> {
  if (!eventId) {
    throw new Error("resolveRsvpGuests: eventId is required");
  }
  assertUuid(eventId, "resolveRsvpGuests.eventId");

  // Pull every going + approved RSVP guest for this event. Host reads under
  // event_rsvps_host_read RLS (the brand owner manages the event).
  const { data, error } = await supabase
    .from("event_rsvps")
    .select("id, event_id, guest_name, guest_email, guest_phone, created_at")
    .eq("event_id", eventId)
    .eq("rsvp_status", "going")
    .eq("approval_status", "approved")
    .order("created_at", { ascending: false });

  if (error) throw error;

  const guests = (data ?? []) as unknown as Array<{
    id: string;
    event_id: string;
    guest_name: string | null;
    guest_email: string | null;
    guest_phone: string | null;
    created_at: string;
  }>;

  // The brand-scoped unsubscribe lookup needs a brand_id. Resolve it from the
  // event row (RLS-gated) so going-guests who unsubscribed are flagged in the
  // same way buyers are. Failure here is non-fatal to the audience read — but
  // a thrown query is surfaced (no silent swallow): the brand probe IS allowed
  // to come back empty (a never-blasted brand), in which case no unsubs apply.
  let brandId: string | null = null;
  if (guests.length > 0) {
    // orch-strict-grep-allow events-type-filter — ORCH-1150 D-8: RSVP blast audience (resolveRsvpGuests) reads event_rsvps for a known rsvp event id; this single-row brand_id lookup is by id on that same RSVP event.
    const { data: eventRow, error: eventErr } = await supabase
      .from("events")
      .select("id, brand_id")
      .eq("id", eventId)
      .maybeSingle();
    if (eventErr) throw eventErr;
    brandId =
      eventRow !== null && typeof eventRow.brand_id === "string"
        ? eventRow.brand_id
        : null;
  }

  let unsubs: UnsubRow[] = [];
  if (brandId !== null) {
    assertUuid(brandId, "resolveRsvpGuests.brandId (server-derived)");
    const { data: unsubData, error: unsubError } = await supabase
      .from("marketing_unsubscribes")
      .select("contact_email, channel, scope, brand_id")
      .or(`scope.eq.global,and(scope.eq.brand,brand_id.eq.${brandId})`);

    if (unsubError) throw unsubError;
    unsubs = (unsubData ?? []) as unknown as UnsubRow[];
  }

  // Map RSVP guests onto the same OrderRowForAudience shape aggregateBuyers
  // expects (zero money), then reuse the identical aggregation + masking +
  // consent path so the Blasts UI is byte-identical to the buyers surface.
  const pseudoOrders: OrderRowForAudience[] = guests.map((g) => ({
    id: g.id,
    event_id: g.event_id,
    buyer_email: g.guest_email,
    buyer_name: g.guest_name,
    buyer_phone: g.guest_phone,
    buyer_phone_e164: g.guest_phone,
    total_cents: 0,
    currency: "USD",
    payment_status: "rsvp_going",
    confirmed_at: g.created_at,
    created_at: g.created_at,
    events: brandId !== null ? { id: eventId, title: null, brand_id: brandId } : null,
  }));

  return aggregateBuyers(pseudoOrders, unsubs, brandId);
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

// ---------------------------------------------------------------------------
// Phase B — Audiences tab unified list (ORCH-0863)
// ---------------------------------------------------------------------------
// SPEC §6.2.3: merges three lists into one:
//   1. Real marketing_audiences rows owned by the account.
//   2. Discovered brand_buyers virtual rows — every brand the operator
//      manages with >=1 paid order that has no existing brand_buyers row.
//   3. Discovered event_buyers virtual rows — every event under those
//      brands with >=1 paid order that has no existing event_buyers row.
// Virtual rows are materialized lazily by the UI on first tap.

interface AudienceRowFromDb {
  id: string;
  brand_id: string | null;
  query_definition: {
    kind?: string;
    brand_id?: string;
    event_id?: string;
  };
}

interface BrandRowMin {
  id: string;
  name: string | null;
}

interface EventRowMin {
  id: string;
  title: string | null;
  brand_id: string;
}

interface CampaignLastUsedRow {
  audience_id: string;
  created_at: string;
}

export interface ListAudiencesInput {
  account_id: string;
}

export async function listAudiencesForAccount(
  input: ListAudiencesInput,
): Promise<AudienceListEntry[]> {
  assertUuid(input.account_id, "listAudiencesForAccount.account_id");

  // Step 1 — Pull existing marketing_audiences rows for this account.
  const { data: existingAudData, error: existingAudErr } = await supabase
    .from("marketing_audiences")
    .select("id, brand_id, query_definition")
    .eq("account_id", input.account_id);
  if (existingAudErr) throw existingAudErr;
  const existingAudiences = (existingAudData ?? []) as unknown as AudienceRowFromDb[];

  // Step 2 — Pull last-used timestamps per audience_id (max created_at across
  // the account's campaigns). Same-account scope ensures we don't leak
  // cross-account audience-use signals.
  const audienceIdsForLastUsed = existingAudiences.map((a) => a.id);
  const lastUsedByAudienceId = new Map<string, string>();
  if (audienceIdsForLastUsed.length > 0) {
    const { data: campRows, error: campErr } = await supabase
      .from("marketing_campaigns")
      .select("audience_id, created_at")
      .eq("account_id", input.account_id)
      .in("audience_id", audienceIdsForLastUsed)
      .order("created_at", { ascending: false });
    if (campErr) throw campErr;
    for (const row of (campRows ?? []) as CampaignLastUsedRow[]) {
      if (!lastUsedByAudienceId.has(row.audience_id)) {
        lastUsedByAudienceId.set(row.audience_id, row.created_at);
      }
    }
  }

  // Step 3 — Discover every brand the operator manages that has >=1 paid order.
  // Strategy: pull paid orders, derive distinct event_ids, JOIN to events to
  // get brand_id + title, JOIN to brands for name + access gating via RLS.
  // Note: orders RLS already scopes by the caller's brand membership; the
  // events/brands joins respect the same membership.
  const { data: paidOrderEvents, error: ordersErr } = await supabase
    .from("orders")
    .select("event_id, events!inner ( id, title, brand_id )")
    .in("payment_status", ["paid", "partial_refund"]);
  if (ordersErr) throw ordersErr;
  const paidEventRows = (paidOrderEvents ?? []) as unknown as Array<{
    event_id: string;
    events: { id: string; title: string | null; brand_id: string } | null;
  }>;

  // Step 4 — Build sets of brand IDs and event IDs with paid orders.
  const paidBrandIds = new Set<string>();
  const paidEventByBrand = new Map<string, Map<string, string | null>>(); // brand_id → event_id → title
  for (const row of paidEventRows) {
    if (row.events === null) continue;
    paidBrandIds.add(row.events.brand_id);
    if (!paidEventByBrand.has(row.events.brand_id)) {
      paidEventByBrand.set(row.events.brand_id, new Map());
    }
    const evMap = paidEventByBrand.get(row.events.brand_id);
    if (evMap !== undefined && !evMap.has(row.events.id)) {
      evMap.set(row.events.id, row.events.title);
    }
  }

  // Step 5 — Pull brand names for display (RLS gates).
  const brandIdList = Array.from(paidBrandIds);
  const brandNameById = new Map<string, string>();
  if (brandIdList.length > 0) {
    const { data: brandsData, error: brandsErr } = await supabase
      .from("brands")
      .select("id, name")
      .in("id", brandIdList)
      .is("deleted_at", null);
    if (brandsErr) throw brandsErr;
    for (const b of (brandsData ?? []) as BrandRowMin[]) {
      if (b.name !== null) brandNameById.set(b.id, b.name);
    }
  }

  // Step 6 — Index existing audiences by client_key for dedup.
  const existingByClientKey = new Map<string, AudienceRowFromDb>();
  for (const a of existingAudiences) {
    const kind = a.query_definition.kind;
    if (kind === "brand_buyers" && typeof a.query_definition.brand_id === "string") {
      existingByClientKey.set(`brand_buyers:${a.query_definition.brand_id}`, a);
    } else if (kind === "event_buyers" && typeof a.query_definition.event_id === "string") {
      existingByClientKey.set(`event_buyers:${a.query_definition.event_id}`, a);
    }
  }

  // Step 7 — Merge real + virtual into a single AudienceListEntry array.
  const entries: AudienceListEntry[] = [];

  // 7a — Brand-rollup entries (one per brand with paid orders).
  for (const brandId of brandIdList) {
    const brandName = brandNameById.get(brandId) ?? "Brand";
    const clientKey = `brand_buyers:${brandId}`;
    const existing = existingByClientKey.get(clientKey);
    entries.push({
      client_key: clientKey,
      kind: "brand_buyers",
      audience_id: existing?.id ?? null,
      brand_id: brandId,
      brand_name: brandName,
      event_id: null,
      display_name: `${brandName} — All buyers`,
      last_used_at: existing !== undefined ? (lastUsedByAudienceId.get(existing.id) ?? null) : null,
    });
  }

  // 7b — Event-scoped entries (one per event with paid orders).
  for (const [brandId, evMap] of paidEventByBrand.entries()) {
    const brandName = brandNameById.get(brandId) ?? "Brand";
    for (const [eventId, eventTitle] of evMap.entries()) {
      const clientKey = `event_buyers:${eventId}`;
      const existing = existingByClientKey.get(clientKey);
      const titleLabel = eventTitle ?? "Untitled event";
      entries.push({
        client_key: clientKey,
        kind: "event_buyers",
        audience_id: existing?.id ?? null,
        brand_id: brandId,
        brand_name: brandName,
        event_id: eventId,
        display_name: `${titleLabel} — buyers`,
        last_used_at: existing !== undefined ? (lastUsedByAudienceId.get(existing.id) ?? null) : null,
      });
    }
  }

  // Step 8 — Sort: real rows first (by last_used_at DESC NULLS LAST), then
  // virtual rows alphabetically by brand_name then display_name.
  entries.sort((a, b) => {
    const aReal = a.audience_id !== null;
    const bReal = b.audience_id !== null;
    if (aReal && !bReal) return -1;
    if (!aReal && bReal) return 1;
    if (aReal && bReal) {
      // both real → last_used_at desc
      const ta = a.last_used_at ?? "";
      const tb = b.last_used_at ?? "";
      return tb.localeCompare(ta);
    }
    // both virtual → brand_name, then display_name
    const bn = a.brand_name.localeCompare(b.brand_name);
    if (bn !== 0) return bn;
    return a.display_name.localeCompare(b.display_name);
  });

  return entries;
}
