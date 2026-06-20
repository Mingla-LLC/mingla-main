// ORCH-0815-B — Server-side audience resolver for marketing-send.
//
// Mirrors `mingla-business/src/services/marketing/marketingAudienceService.ts`
// — same aggregation logic, same masking, same reach summary — but called
// from the marketing-send edge function with a service-role client (no RLS).
//
// Why duplicate? RN cannot import Deno-specific modules and Deno cannot
// import RN supabase client paths. The aggregation function is identical
// in shape and intent; both files must stay in sync when the audience
// contract evolves. The single jest test in mingla-business asserts
// client-side behaviour; the Deno test in this folder asserts the Deno
// side. If they drift, the strict-grep gate (Phase B §14 check 12 — the
// negative-control proof set) flags the divergence.
//
// Cross-references:
//   - SPEC: Mingla_Artifacts/specs/SPEC_ORCH-0815_B_COMPOSER_AND_SEND.md §7.1.a
//   - Client: mingla-business/src/services/marketing/marketingAudienceService.ts
//   - Phase A schema: supabase/migrations/20260602000003_orch_0815_marketing_hub_phase_a.sql

// @ts-ignore -- Deno ESM import.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type MarketingChannel = "email" | "sms" | "rcs";

export interface AudienceQueryBrandBuyers {
  kind: "brand_buyers";
  brand_id: string;
  payment_statuses?: ReadonlyArray<"paid" | "partial_refund">;
}
export interface AudienceQueryEventBuyers {
  kind: "event_buyers";
  event_id: string;
  payment_statuses?: ReadonlyArray<"paid" | "partial_refund">;
}
export interface AudienceQueryBrandFollowers {
  kind: "brand_followers";
  brand_id: string;
}
export interface AudienceQueryCustomSegment {
  kind: "custom_segment";
  filters: ReadonlyArray<unknown>;
}
export type AudienceQueryDefinition =
  | AudienceQueryBrandBuyers
  | AudienceQueryEventBuyers
  | AudienceQueryBrandFollowers
  | AudienceQueryCustomSegment;

export interface ResolvedContact {
  contact_key: string;
  display_name: string;
  first_name: string;
  raw_email: string | null;
  raw_phone: string | null;
  order_count: number;
  total_spend_minor: number;
  total_spend_currency: string;
  last_event_id: string | null;
  last_event_name: string | null;
  last_purchase_at: string | null;
  email_marketing_ok: boolean;
  sms_marketing_ok: boolean;
}

export interface ResolveResult {
  rows: ResolvedContact[];
  brand_id: string | null;
  reach: { total: number; reachable_email: number; reachable_sms: number };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`${label}: expected UUID, got ${JSON.stringify(value)}`);
  }
}

interface OrderRow {
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
  events: { id: string; title: string | null; brand_id: string } | null;
}

interface UnsubRow {
  contact_email: string | null;
  channel: string;
  scope: string;
  brand_id: string | null;
}

// META-ORCH-1161 Sub-B — phone-keyed suppression rows. A phone is NOT
// reachable_sms if it appears on EITHER:
//   - marketing_unsubscribes(contact_phone, channel ∈ {sms,all}), OR
//   - channel_suppressions(contact = phone, channel='sms', scope ∈ {marketing,all}).
// (I-PROPOSED-1161-SMS-OPT-OUT-HONORED-ANY-CHANNEL.)
interface PhoneUnsubRow {
  contact_phone: string | null;
  channel: string;
}
interface ChannelSuppressionRow {
  contact: string | null;
  channel: string;
  scope: string;
}

// Normalize a phone for set membership — trim only (we compare against E.164
// from orders.buyer_phone_e164 and the raw suppression contact). We DON'T
// lowercase (phones are digits) but we keep both a trimmed and a digits-only
// form so a "+1 555" stored without the + still matches.
function phoneKeysOf(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined) return [];
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];
  const digits = trimmed.replace(/[^0-9]/g, "");
  const keys = new Set<string>([trimmed]);
  if (digits.length > 0) keys.add(digits);
  return Array.from(keys);
}

/**
 * META-ORCH-1161 Sub-B — resolve the set of suppressed phone keys for a brand
 * scope. Queries BOTH suppression ledgers and returns a flat Set of phone keys
 * (trimmed + digits-only forms) that must NOT receive marketing SMS.
 */
// deno-lint-ignore no-explicit-any
async function resolveSuppressedPhones(
  client: SupabaseClient<any, "public", any>,
  brandId: string | null,
): Promise<Set<string>> {
  const suppressed = new Set<string>();

  // 1. marketing_unsubscribes by phone (sms or all channel; global or this brand).
  let unsubQuery = client
    .from("marketing_unsubscribes")
    .select("contact_phone, channel")
    .not("contact_phone", "is", null)
    .in("channel", ["sms", "all"]);
  if (brandId !== null) {
    unsubQuery = unsubQuery.or(
      `scope.eq.global,and(scope.eq.brand,brand_id.eq.${brandId})`,
    );
  } else {
    unsubQuery = unsubQuery.eq("scope", "global");
  }
  const { data: phoneUnsubData, error: phoneUnsubError } = await unsubQuery;
  if (phoneUnsubError) {
    throw new Error(`audience_phone_unsubs_query_failed:${phoneUnsubError.message}`);
  }
  for (const row of (phoneUnsubData ?? []) as unknown as PhoneUnsubRow[]) {
    for (const k of phoneKeysOf(row.contact_phone)) suppressed.add(k);
  }

  // 2. channel_suppressions(channel='sms', scope ∈ {marketing,all}). This is the
  //    Sub-A unified ledger that the inbound-STOP webhook + prefs UI write to.
  //    contact holds an E.164 phone. (brand_id is NULL=global for marketing STOP;
  //    we honor any sms marketing/all suppression regardless of brand.)
  const { data: chanSuppData, error: chanSuppError } = await client
    .from("channel_suppressions")
    .select("contact, channel, scope")
    .eq("channel", "sms")
    .in("scope", ["marketing", "all"])
    .not("contact", "is", null);
  if (chanSuppError) {
    // channel_suppressions ships with Sub-A; if it's somehow absent on an
    // un-migrated env, fail-closed is wrong for reach (would hide all phones).
    // Surface the error — the audience contract cannot silently degrade.
    throw new Error(`audience_channel_suppressions_query_failed:${chanSuppError.message}`);
  }
  for (const row of (chanSuppData ?? []) as unknown as ChannelSuppressionRow[]) {
    for (const k of phoneKeysOf(row.contact)) suppressed.add(k);
  }

  return suppressed;
}

/**
 * META-ORCH-1161 go-live-prep (P2 fix) — resolve the set of suppressed EMAIL keys
 * (lowercased) from channel_suppressions(channel='email', scope ∈ {marketing,all}),
 * keyed on `contact` (the lowercased email written by set_marketing_suppression).
 * Mirrors resolveSuppressedPhones for the email channel so a prefs-UI email
 * marketing opt-out — which lands in channel_suppressions, NOT marketing_unsubscribes
 * — actually excludes the buyer from the email blast. Without this, can_send(email)
 * blocks server-gated sends but the blast audience still includes the contact
 * (the email-blast-ignores-opt-out defect). channel_suppressions stays the single
 * opt-out authority across BOTH can_send AND the blast resolver.
 * (I-PROPOSED-1161-EMAIL-OPT-OUT-HONORED-ANY-CHANNEL, mirror of the SMS invariant.)
 */
// deno-lint-ignore no-explicit-any
async function resolveSuppressedEmails(
  client: SupabaseClient<any, "public", any>,
): Promise<Set<string>> {
  const suppressed = new Set<string>();
  const { data, error } = await client
    .from("channel_suppressions")
    .select("contact, channel, scope")
    .eq("channel", "email")
    .in("scope", ["marketing", "all"])
    .not("contact", "is", null);
  if (error) {
    // Same fail-surfaced posture as resolveSuppressedPhones — the audience
    // contract cannot silently degrade (a swallowed error would over-report reach).
    throw new Error(`audience_channel_suppressions_email_query_failed:${error.message}`);
  }
  for (const row of (data ?? []) as unknown as ChannelSuppressionRow[]) {
    const c = row.contact;
    if (c === null) continue;
    const key = c.toLowerCase().trim();
    if (key.length > 0) suppressed.add(key);
  }
  return suppressed;
}

/**
 * Resolve a discriminated-union audience query into per-recipient rows.
 *
 * Phase B supports `brand_buyers` + `event_buyers`. `brand_followers` and
 * `custom_segment` throw — they're reserved for later phases (I-PROPOSED-BP).
 */
// deno-lint-ignore no-explicit-any -- SupabaseClient generic type defined client-side
export async function resolveAudience(
  client: SupabaseClient<any, "public", any>,
  query: AudienceQueryDefinition,
): Promise<ResolveResult> {
  switch (query.kind) {
    case "brand_buyers":
      return await resolveBrandBuyers(client, query.brand_id);
    case "event_buyers":
      return await resolveEventBuyers(client, query.event_id);
    case "brand_followers":
      throw new Error("audience_kind_not_yet_enabled:brand_followers");
    case "custom_segment":
      throw new Error("audience_kind_not_yet_enabled:custom_segment");
    default: {
      // Exhaustiveness sentinel — TS compile error if a new kind is added
      // without a case branch.
      const _exhaustive: never = query;
      throw new Error(`audience_kind_unknown:${String(_exhaustive)}`);
    }
  }
}

// deno-lint-ignore no-explicit-any
async function resolveBrandBuyers(
  client: SupabaseClient<any, "public", any>,
  brandId: string,
): Promise<ResolveResult> {
  assertUuid(brandId, "resolveBrandBuyers.brandId");

  const { data: ordersData, error: ordersError } = await client
    .from("orders")
    .select(
      `id, event_id, buyer_email, buyer_name, buyer_phone, buyer_phone_e164,
       total_cents, currency, payment_status, confirmed_at, created_at,
       events!inner ( id, title, brand_id )`,
    )
    .in("payment_status", ["paid", "partial_refund"])
    .eq("events.brand_id", brandId)
    .order("created_at", { ascending: false });

  if (ordersError) {
    throw new Error(`audience_orders_query_failed:${ordersError.message}`);
  }
  const orders = (ordersData ?? []) as unknown as OrderRow[];

  const { data: unsubData, error: unsubError } = await client
    .from("marketing_unsubscribes")
    .select("contact_email, channel, scope, brand_id")
    .or(`scope.eq.global,and(scope.eq.brand,brand_id.eq.${brandId})`);

  if (unsubError) {
    throw new Error(`audience_unsubs_query_failed:${unsubError.message}`);
  }

  const suppressedPhones = await resolveSuppressedPhones(client, brandId);
  const suppressedEmails = await resolveSuppressedEmails(client);

  return aggregate(
    orders,
    (unsubData ?? []) as unknown as UnsubRow[],
    brandId,
    suppressedPhones,
    suppressedEmails,
  );
}

// deno-lint-ignore no-explicit-any
async function resolveEventBuyers(
  client: SupabaseClient<any, "public", any>,
  eventId: string,
): Promise<ResolveResult> {
  assertUuid(eventId, "resolveEventBuyers.eventId");

  const { data: ordersData, error: ordersError } = await client
    .from("orders")
    .select(
      `id, event_id, buyer_email, buyer_name, buyer_phone, buyer_phone_e164,
       total_cents, currency, payment_status, confirmed_at, created_at,
       events!inner ( id, title, brand_id )`,
    )
    .in("payment_status", ["paid", "partial_refund"])
    .eq("event_id", eventId)
    .order("created_at", { ascending: false });

  if (ordersError) {
    throw new Error(`audience_orders_query_failed:${ordersError.message}`);
  }
  const orders = (ordersData ?? []) as unknown as OrderRow[];
  const brandId = orders[0]?.events?.brand_id ?? null;

  let unsubs: UnsubRow[] = [];
  if (brandId !== null) {
    assertUuid(brandId, "resolveEventBuyers.brandId (server-derived)");
    const { data: unsubData, error: unsubError } = await client
      .from("marketing_unsubscribes")
      .select("contact_email, channel, scope, brand_id")
      .or(`scope.eq.global,and(scope.eq.brand,brand_id.eq.${brandId})`);
    if (unsubError) {
      throw new Error(`audience_unsubs_query_failed:${unsubError.message}`);
    }
    unsubs = (unsubData ?? []) as unknown as UnsubRow[];
  }

  const suppressedPhones = await resolveSuppressedPhones(client, brandId);
  const suppressedEmails = await resolveSuppressedEmails(client);

  return aggregate(orders, unsubs, brandId, suppressedPhones, suppressedEmails);
}

// Exported for unit testing (META-ORCH-1161 Sub-B) — pure function, no client.
export function aggregate(
  orders: OrderRow[],
  unsubs: UnsubRow[],
  brandId: string | null,
  // META-ORCH-1161 Sub-B — phone keys (trimmed + digits-only) suppressed for
  // SMS marketing across marketing_unsubscribes(contact_phone) AND
  // channel_suppressions. A contact whose phone matches is NOT reachable_sms.
  suppressedPhones: Set<string> = new Set<string>(),
  // META-ORCH-1161 go-live-prep (P2) — lowercased email keys suppressed for EMAIL
  // marketing via channel_suppressions(channel='email', scope ∈ {marketing,all}),
  // written by the prefs-UI RPC set_marketing_suppression. A buyer whose email
  // matches is NOT reachable_email (in addition to the marketing_unsubscribes check).
  suppressedEmails: Set<string> = new Set<string>(),
): ResolveResult {
  const unsubLookup = new Map<string, Set<MarketingChannel>>();
  for (const u of unsubs) {
    if (u.contact_email === null) continue;
    const email = u.contact_email.toLowerCase();
    const channels = unsubLookup.get(email) ?? new Set<MarketingChannel>();
    if (u.channel === "all") {
      channels.add("email");
      channels.add("sms");
      channels.add("rcs");
    } else if (u.channel === "email" || u.channel === "sms" || u.channel === "rcs") {
      channels.add(u.channel);
    }
    unsubLookup.set(email, channels);
  }

  interface Accumulator {
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

  const buckets = new Map<string, Accumulator>();
  for (const o of orders) {
    const key = (o.buyer_email ?? "").toLowerCase().trim();
    if (key === "") continue;
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
      if (existing.raw_phone === null && o.buyer_phone_e164 !== null) {
        existing.raw_phone = o.buyer_phone_e164;
      }
    }
  }

  const rows: ResolvedContact[] = [];
  let reachableEmail = 0;
  let reachableSms = 0;
  for (const [emailKey, acc] of buckets.entries()) {
    const suppressed = unsubLookup.get(emailKey) ?? new Set<MarketingChannel>();
    // Email reach now checks BOTH the email-keyed marketing_unsubscribes row AND
    // the channel_suppressions(channel='email') ledger the prefs-UI RPC writes
    // (P2 fix). Previously emailOk only consulted marketing_unsubscribes, so a
    // prefs-UI email opt-out (which lands in channel_suppressions) was ignored by
    // the blast even though can_send(email) honored it → reach.reachable_email lied.
    const emailOk = acc.raw_email !== null && !suppressed.has("email") &&
      !suppressedEmails.has(emailKey);
    // SMS reach now checks BOTH the email-keyed unsub (channel='sms' on this
    // buyer's email row) AND the phone-keyed suppression ledgers (Sub-B fix).
    // Previously smsOk only consulted the email-keyed set, so a phone STOP /
    // channel_suppressions row was silently ignored → reach.reachable_sms lied.
    const phoneSuppressed = phoneKeysOf(acc.raw_phone).some((k) =>
      suppressedPhones.has(k)
    );
    const smsOk = acc.raw_phone !== null && !suppressed.has("sms") &&
      !phoneSuppressed;
    if (emailOk) reachableEmail += 1;
    if (smsOk) reachableSms += 1;
    rows.push({
      contact_key: emailKey,
      display_name: acc.display_name,
      first_name: firstNameOf(acc.display_name),
      raw_email: acc.raw_email,
      raw_phone: acc.raw_phone,
      order_count: acc.order_count,
      total_spend_minor: acc.total_spend_minor,
      total_spend_currency: acc.total_spend_currency,
      last_event_id: acc.last_event_id,
      last_event_name: acc.last_event_name,
      last_purchase_at: acc.last_purchase_at,
      email_marketing_ok: emailOk,
      sms_marketing_ok: smsOk,
    });
  }

  rows.sort((a, b) => {
    const ta = a.last_purchase_at ?? "";
    const tb = b.last_purchase_at ?? "";
    return tb.localeCompare(ta);
  });

  return {
    rows,
    brand_id: brandId,
    reach: {
      total: rows.length,
      reachable_email: reachableEmail,
      reachable_sms: reachableSms,
    },
  };
}

function firstNameOf(displayName: string): string {
  const trimmed = displayName.trim();
  if (trimmed.length === 0) return "there";
  const first = trimmed.split(/\s+/)[0];
  return first.length > 0 ? first : "there";
}
