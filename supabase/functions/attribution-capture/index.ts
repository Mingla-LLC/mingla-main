/**
 * ISSUE-865 [Attribution & reservation-conversion tracking] — WP-A
 * attribution-capture
 *
 * The anon buyer-surface capture endpoint (verify_jwt=false, pattern like
 * discover-merged-events). It records BOTH:
 *   • touches      — one row per inbound tracked ad click / app deep-link;
 *                    generates a first-party click_id, returns it.
 *   • conversions  — one row per attributed conversion, IDEMPOTENT on a UNIQUE
 *                    event_id (re-delivered / duplicate events → no second row).
 *
 * WP-A discipline:
 *   • FAIL-OPEN. It is called post-finalize (WP-B will wire it into the finalize
 *     hook), so it must NEVER throw or 500 in a way that could block or reverse a
 *     purchase. Every internal error is absorbed and returned as HTTP 200 with a
 *     soft `{ ok:false }` body. RT-1.
 *   • IDEMPOTENT. Conversions upsert ON CONFLICT (event_id) DO NOTHING. RT-2.
 *   • SERVICE-ROLE writes only (RLS is admin-read + service-write). It creates a
 *     service-role client internally — buyer clients never write these tables.
 *   • PER-LANE connection resolution. It looks up ad_connections by
 *     (platform, lane) — the shipped engine's UNIQUE(platform,lane) — and stamps
 *     connection_id. It reads env-var NAMES only (never a token VALUE, never
 *     Deno.env for a secret) — the CAPI send is WP-B. A3-2.
 *   • PRIVACY (SC-9). Raw IP/UA/email/phone are hashed in-memory (Web Crypto
 *     SHA-256 hex — byte-identical to pgcrypto encode(digest(x,'sha256'),'hex'))
 *     before insert; raw PII NEVER reaches Postgres and is NEVER echoed back.
 *
 * This file touches NO web/browser surface and NO purchase/finalize code path.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  classifyEntrySource,
  deriveReferrerHost,
} from "../_shared/entrySource.ts";
export {
  classifyEntrySource,
  deriveReferrerHost,
  type EntrySource,
} from "../_shared/entrySource.ts";

// ── Types ────────────────────────────────────────────────────────────────────

type Network = "meta" | "tiktok" | "snapchat" | "google" | "reddit" | "other";
type Platform = "meta" | "tiktok" | "snapchat" | "google" | "reddit";
type Lane = "consumer" | "business";
type Surface = "web" | "ios" | "android";
type EventType = "purchase" | "reservation" | "lead" | "view";

type ConsentState = "pending" | "granted" | "rejected";

interface CaptureBody {
  // toward #3697 / #3702: anon HTTP may touch or update consent only.
  // Conversion rows are written solely by trusted post-finalize paths
  // (adConversionFire). kind:"conversion" is refused on this endpoint.
  kind?: "touch" | "conversion" | "consent";
  // shared
  surface?: Surface;
  lane?: Lane;
  user_id?: string;
  // touch / consent
  consent_state?: ConsentState;
  network?: Network;
  external_click_id?: string;
  af_c_id?: string;
  // ISSUE-865 PR1 WP-1 — first-party campaign param. `mc_id` (or the existing
  // AppsFlyer `af_c_id`) carries ad_campaigns.external_campaign_id; recordTouch
  // resolves it → campaign_id + brand_id so per-campaign ROI is unblocked.
  mc_id?: string;
  ad_set_id?: string;
  ad_id?: string;
  af_uid?: string;
  // ISSUE-855 PR-2 — the HOST of document.referrer (host only; the browser strips
  // path/query/fragment before sending — SC-8/SC-9). Drives entry_source. A full
  // URL is tolerated (deriveReferrerHost re-parses it) but the web client never
  // sends one.
  referrer?: string;
  utm?: Record<string, unknown>;
  dest?: {
    // toward #3697 Wave 1 — match ad_campaigns / ad_attribution_touches CHECKs.
    page_type?:
      | "event"
      | "rsvp"
      | "trip"
      | "experience"
      | "brand"
      | "venue"
      | "reservation"
      | "site"
      | "marketing";
    brand_slug?: string;
    entity_slug?: string;
    event_id?: string;
  };
  click_id?: string;
  // conversion
  event_id?: string;
  event_type?: EventType;
  event_name?: string;
  value_cents?: number;
  currency?: string;
  platform?: Platform;
  order_id?: string;
  brand_id?: string;
  mingla_event_id?: string;
  event_source_url?: string;
  email?: string;
  phone?: string;
}

/** Injectable dependencies (so the handler is runtime-testable without a live DB). */
export interface CaptureDeps {
  /** Returns a service-role Supabase client, or null when env is missing. */
  getClient: () => SupabaseClient | null;
}

const NETWORKS: readonly Network[] = [
  "meta",
  "tiktok",
  "snapchat",
  "google",
  "reddit",
  "other",
];
const PLATFORMS: readonly Platform[] = [
  "meta",
  "tiktok",
  "snapchat",
  "google",
  "reddit",
];
const LANES: readonly Lane[] = ["consumer", "business"];
const SURFACES: readonly Surface[] = ["web", "ios", "android"];
const EVENT_TYPES: readonly EventType[] = [
  "purchase",
  "reservation",
  "lead",
  "view",
];

// Best-effort per-isolate rate limit on the anon touch path (defensive — the fn
// is verify_jwt=false). Soft: excess requests get a 200 { rate_limited:true },
// never an error. Conversions are service-called post-finalize and are exempt.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60;
const rateBuckets = new Map<string, number[]>();

function rateLimited(key: string, now: number): boolean {
  const hits = (rateBuckets.get(key) ?? []).filter((t) =>
    now - t < RATE_WINDOW_MS
  );
  hits.push(now);
  rateBuckets.set(key, hits);
  return hits.length > RATE_MAX;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** SHA-256 hex — matches pgcrypto encode(digest(x,'sha256'),'hex'); never stores raw. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Normalize PII before hashing (lowercase/trim email; strip non-digits from phone). */
function normEmail(v: string): string {
  return v.trim().toLowerCase();
}
function normPhone(v: string): string {
  return v.replace(/[^0-9]/g, "");
}

function firstClientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim() || null;
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") ||
    null;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === "string" && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : null;
}

/**
 * Resolve the per-lane ad_connections row (A3-2). Reads env-var NAMES / ids only
 * — NEVER a token value. Best-effort: returns null on any miss/error so capture
 * never fails on connection resolution.
 */
async function resolveConnectionId(
  client: SupabaseClient,
  platform: Platform | null,
  lane: Lane | null,
): Promise<string | null> {
  if (!platform || !lane) return null;
  try {
    const { data, error } = await client
      .from("ad_connections")
      .select("id")
      .eq("platform", platform)
      .eq("lane", lane)
      .maybeSingle();
    if (error || !data) return null;
    return (data as { id: string }).id;
  } catch {
    return null;
  }
}

/**
 * ISSUE-865 PR1 WP-1 — resolve the campaign click param → campaign identity.
 * The ad-create path already stamps `af_c_id = ad_campaigns.external_campaign_id`
 * on the OneLink / Google tracking template; a first-party `mc_id` alias carries
 * the same id. This resolves that param to the campaign row and its brand so the
 * touch (and, via touch, the conversion) is per-campaign attributable. Best-effort
 * + FAIL-OPEN: any miss/error returns nulls so a touch is NEVER blocked on it.
 */
const DEST_PAGE_TYPES = [
  "event",
  "rsvp",
  "trip",
  "experience",
  "brand",
  "venue",
  "reservation",
  "site",
  "marketing",
] as const;
type DestPageType = (typeof DEST_PAGE_TYPES)[number];

interface ResolvedCampaign {
  campaignId: string | null;
  brandId: string | null;
  connectionId: string | null;
  platform: Platform | null;
  destPageType: DestPageType | null;
  destBrandSlug: string | null;
  destEntitySlug: string | null;
  destEventId: string | null;
}

async function resolveCampaignFromParam(
  client: SupabaseClient,
  externalCampaignId: string | null,
): Promise<ResolvedCampaign> {
  const empty: ResolvedCampaign = {
    campaignId: null,
    brandId: null,
    connectionId: null,
    platform: null,
    destPageType: null,
    destBrandSlug: null,
    destEntitySlug: null,
    destEventId: null,
  };
  if (!externalCampaignId) return empty;
  try {
    const campaignSelect =
      "id, connection_id, platform, dest_page_type, dest_brand_slug, dest_entity_slug, dest_event_id";
    let { data: campaign, error } = await client
      .from("ad_campaigns")
      .select(campaignSelect)
      .eq("external_campaign_id", externalCampaignId)
      .maybeSingle();
    if (
      (!campaign || error) &&
      /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(externalCampaignId)
    ) {
      const byId = await client
        .from("ad_campaigns")
        .select(campaignSelect)
        .eq("id", externalCampaignId)
        .maybeSingle();
      campaign = byId.data;
      error = byId.error;
    }
    if (error || !campaign) return empty;
    const c = campaign as {
      id?: string;
      connection_id?: string | null;
      platform?: string | null;
      dest_page_type?: string | null;
      dest_brand_slug?: string | null;
      dest_entity_slug?: string | null;
      dest_event_id?: string | null;
    };
    // Resolve the brand via the campaign's dest_brand_slug (brands.slug is frozen
    // + unique-active). Best-effort — a slug miss just leaves brand_id null.
    let brandId: string | null = null;
    const slug = typeof c.dest_brand_slug === "string"
      ? c.dest_brand_slug.trim()
      : "";
    if (slug) {
      try {
        const { data: brand } = await client
          .from("brands")
          .select("id")
          .ilike("slug", slug)
          .is("deleted_at", null)
          .maybeSingle();
        brandId = (brand as { id?: string } | null)?.id ?? null;
      } catch {
        brandId = null;
      }
    }
    return {
      campaignId: (c.id as string | null) ?? null,
      brandId,
      connectionId: (c.connection_id as string | null) ?? null,
      platform: oneOf<Platform>(c.platform, PLATFORMS),
      destPageType: oneOf<DestPageType>(c.dest_page_type, DEST_PAGE_TYPES),
      destBrandSlug: slug || null,
      destEntitySlug: typeof c.dest_entity_slug === "string"
        ? c.dest_entity_slug
        : null,
      destEventId: typeof c.dest_event_id === "string" ? c.dest_event_id : null,
    };
  } catch {
    return empty;
  }
}

// ── Handler (exported for runtime tests) ─────────────────────────────────────

export async function handleCapture(
  req: Request,
  deps: CaptureDeps,
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  // From here down EVERYTHING is fail-open: any failure returns 200 soft so a
  // post-finalize caller can never be blocked (RT-1).
  try {
    let body: CaptureBody;
    try {
      body = (await req.json()) as CaptureBody;
    } catch {
      return json({ ok: false, soft_error: "invalid_json" });
    }
    if (!body || typeof body !== "object") {
      return json({ ok: false, soft_error: "invalid_body" });
    }

    const client = deps.getClient();
    if (!client) {
      // Never 500 — absorb and report soft (a purchase must not be blocked).
      return json({ ok: false, soft_error: "storage_unavailable" });
    }

    // toward #3697 Wave 0d / #3702: refuse conversion on this anon endpoint.
    // event_id alone used to route here; that let any browser forge a row.
    const looksLikeConversion = body.kind === "conversion" ||
      (!!body.event_id && body.kind !== "touch" && body.kind !== "consent");
    if (looksLikeConversion) {
      return json({
        ok: false,
        soft_error: "conversion_requires_trusted_path",
      });
    }
    if (body.kind === "consent") {
      // toward #3697: same soft per-IP rate limit as anon touch writes.
      const ip = firstClientIp(req);
      const ipHash = ip ? await sha256Hex(ip) : null;
      if (ipHash && rateLimited(ipHash, Date.now())) {
        return json({ ok: false, rate_limited: true });
      }
      return await recordConsent(client, body);
    }
    return await recordTouch(client, req, body);
  } catch (err) {
    // Last-resort absorb — the caller (post-finalize) must never see a 5xx.
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[attribution-capture] absorbed:", detail);
    return json({ ok: false, soft_error: "absorbed" });
  }
}

/** toward #3697: stamp Accept/Reject onto an existing first-party click. */
async function recordConsent(
  client: SupabaseClient,
  body: CaptureBody,
): Promise<Response> {
  const clickId = typeof body.click_id === "string" ? body.click_id.trim() : "";
  const consent = oneOf<ConsentState>(body.consent_state, [
    "pending",
    "granted",
    "rejected",
  ] as const);
  if (!clickId || !consent || consent === "pending") {
    return json({ ok: false, soft_error: "consent_args_required" });
  }
  const { data, error } = await client
    .from("ad_attribution_touches")
    .update({ consent_state: consent })
    .eq("click_id", clickId)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[attribution-capture] consent update error:", error.message);
    return json({ ok: false, soft_error: "consent_not_recorded" });
  }
  if (!data) {
    return json({ ok: false, soft_error: "click_not_found" });
  }
  return json({ ok: true, kind: "consent", click_id: clickId, consent_state: consent });
}

/** Kept for hermetic unit coverage of hashing; not reachable from handleCapture. */
export async function recordConversion(
  client: SupabaseClient,
  body: CaptureBody,
): Promise<Response> {
  const eventId = typeof body.event_id === "string" ? body.event_id.trim() : "";
  if (!eventId) {
    return json({ ok: false, soft_error: "event_id_required" });
  }
  const platform = oneOf<Platform>(body.platform, PLATFORMS);
  const lane = oneOf<Lane>(body.lane, LANES);
  const surface = oneOf<Surface>(body.surface, SURFACES) ?? "web";
  const eventType = oneOf<EventType>(body.event_type, EVENT_TYPES) ??
    "purchase";

  const connectionId = await resolveConnectionId(client, platform, lane);

  const hashedEmail = typeof body.email === "string" && body.email
    ? await sha256Hex(normEmail(body.email))
    : null;
  const hashedPhone = typeof body.phone === "string" && body.phone
    ? await sha256Hex(normPhone(body.phone))
    : null;

  const row = {
    event_id: eventId,
    event_type: eventType,
    event_name: typeof body.event_name === "string" && body.event_name
      ? body.event_name
      : "Purchase",
    value_cents: typeof body.value_cents === "number" && body.value_cents >= 0
      ? body.value_cents
      : null,
    currency: typeof body.currency === "string" ? body.currency : null,
    connection_id: connectionId,
    platform,
    lane,
    surface,
    click_id: typeof body.click_id === "string" ? body.click_id : null,
    order_id: typeof body.order_id === "string" ? body.order_id : null,
    brand_id: typeof body.brand_id === "string" ? body.brand_id : null,
    mingla_event_id: typeof body.mingla_event_id === "string"
      ? body.mingla_event_id
      : null,
    event_source_url: typeof body.event_source_url === "string"
      ? body.event_source_url
      : null,
    hashed_email: hashedEmail,
    hashed_phone: hashedPhone,
  };

  // Idempotent: ON CONFLICT (event_id) DO NOTHING. A re-delivered / duplicate
  // event writes NO second row (RT-2). The DB UNIQUE(event_id) is the guard.
  const { data, error } = await client
    .from("ad_conversions")
    .upsert(row, { onConflict: "event_id", ignoreDuplicates: true })
    .select("id");

  if (error) {
    // Absorb — record nothing rather than block the caller (fail-open).
    console.error(
      "[attribution-capture] conversion insert error:",
      error.message,
    );
    return json({
      ok: false,
      soft_error: "conversion_not_recorded",
      event_id: eventId,
    });
  }
  const inserted = Array.isArray(data) && data.length > 0;
  return json({
    ok: true,
    kind: "conversion",
    event_id: eventId,
    deduped: !inserted,
  });
}

async function recordTouch(
  client: SupabaseClient,
  req: Request,
  body: CaptureBody,
): Promise<Response> {
  const surface = oneOf<Surface>(body.surface, SURFACES) ?? "web";
  const utmSource = typeof body.utm?.utm_source === "string"
    ? body.utm.utm_source.trim().toLowerCase()
    : "";
  const utmNetwork: Network | null =
    utmSource === "facebook" || utmSource === "meta"
      ? "meta"
      : utmSource === "tiktok"
      ? "tiktok"
      : utmSource === "snapchat" || utmSource === "snap"
      ? "snapchat"
      : utmSource === "google"
      ? "google"
      : utmSource === "reddit"
      ? "reddit"
      : null;
  const requestedNetwork = oneOf<Network>(body.network, NETWORKS) ?? utmNetwork ??
    "other";
  const lane = oneOf<Lane>(body.lane, LANES);

  // Soft per-isolate rate limit on the anon path (keyed by hashed IP).
  const ip = firstClientIp(req);
  const ipHash = ip ? await sha256Hex(ip) : null;
  if (ipHash && rateLimited(ipHash, Date.now())) {
    return json({ ok: false, rate_limited: true });
  }

  const uaRaw = req.headers.get("user-agent");
  const uaHash = uaRaw ? await sha256Hex(uaRaw) : null;

  const clickId = typeof body.click_id === "string" && body.click_id
    ? body.click_id
    : crypto.randomUUID();

  // ISSUE-865 PR1 WP-1 — resolve the campaign click param (first-party `mc_id`,
  // else the AppsFlyer `af_c_id`; both carry ad_campaigns.external_campaign_id)
  // → campaign_id + brand_id. Best-effort, fail-open: a miss leaves them null.
  const afCId = typeof body.af_c_id === "string" && body.af_c_id
    ? body.af_c_id
    : null;
  const mcId = typeof body.mc_id === "string" && body.mc_id ? body.mc_id : null;
  const utmCampaign = typeof body.utm?.utm_campaign === "string"
    ? body.utm.utm_campaign.trim()
    : "";
  const utmMedium = typeof body.utm?.utm_medium === "string"
    ? body.utm.utm_medium.trim().toLowerCase()
    : "";
  const guardedUtmCampaign =
    requestedNetwork !== "other" &&
      (utmMedium === "paid" || utmMedium === "paid_social") && utmCampaign
      ? utmCampaign
      : null;
  const campaign = await resolveCampaignFromParam(
    client,
    mcId ?? afCId ?? guardedUtmCampaign,
  );

  // ISSUE-855 PR-2 — classify the visit source. An ad click-id / resolved
  // campaign / ad network (network !== 'other') => 'ad'; else the referrer host.
  const externalClickId = typeof body.external_click_id === "string" &&
      body.external_click_id
    ? body.external_click_id
    : null;
  const metaAdResolved = requestedNetwork !== "meta" || (
    campaign.campaignId !== null &&
    (mcId !== null || externalClickId !== null)
  );
  // A bare Instagram/Facebook referrer or unresolvable Meta macro is social,
  // not paid. Keep both entry_source and the stored network honest.
  const network: Network = requestedNetwork === "meta" && !metaAdResolved
    ? "other"
    : requestedNetwork;
  const explicitPlatform = oneOf<Platform>(body.platform, PLATFORMS);
  const platform = network === "other"
    ? null
    : explicitPlatform ?? (network as Platform);
  const connectionId = await resolveConnectionId(client, platform, lane);
  const referrerHost = deriveReferrerHost(body.referrer);
  const hasAdSignal = requestedNetwork === "meta"
    ? metaAdResolved && campaign.campaignId !== null
    : externalClickId !== null || afCId !== null || mcId !== null ||
      campaign.campaignId !== null || network !== "other";
  const entrySource = classifyEntrySource({ hasAdSignal, referrerHost });

  // Default granted when omitted so legacy callers keep sharing; Wave 0 clients
  // send pending/granted/rejected explicitly.
  const consentState = oneOf<ConsentState>(body.consent_state, [
    "pending",
    "granted",
    "rejected",
  ] as const) ?? "granted";

  const row = {
    click_id: clickId,
    network,
    consent_state: consentState,
    external_click_id: typeof body.external_click_id === "string"
      ? body.external_click_id
      : null,
    // Fill the connection from the resolved campaign when the per-lane lookup
    // above didn't resolve one (the campaign owns the authoritative connection).
    connection_id: connectionId ?? campaign.connectionId,
    campaign_id: campaign.campaignId, // ISSUE-865 PR1 WP-1 (was hard-coded null)
    ad_set_id: typeof body.ad_set_id === "string" && body.ad_set_id.trim()
      ? body.ad_set_id.trim().slice(0, 255)
      : null,
    ad_id: typeof body.ad_id === "string" && body.ad_id.trim()
      ? body.ad_id.trim().slice(0, 255)
      : null,
    brand_id: campaign.brandId, // resolved from the campaign's brand (WP-1)
    lane,
    af_c_id: afCId,
    utm: body.utm && typeof body.utm === "object" ? body.utm : {},
    // Prefer the campaign's stored destination identity (authoritative) so
    // landings that still emit event/venue/brand keep the campaign's rsvp /
    // reservation / site type on the touch row.
    dest_page_type: campaign.destPageType ??
      oneOf(body.dest?.page_type, DEST_PAGE_TYPES),
    dest_brand_slug: campaign.destBrandSlug ??
      (typeof body.dest?.brand_slug === "string" ? body.dest.brand_slug : null),
    dest_entity_slug: campaign.destEntitySlug ??
      (typeof body.dest?.entity_slug === "string"
        ? body.dest.entity_slug
        : null),
    dest_event_id: campaign.destEventId ??
      (typeof body.dest?.event_id === "string" ? body.dest.event_id : null),
    surface,
    user_id: typeof body.user_id === "string" ? body.user_id : null,
    af_uid: typeof body.af_uid === "string" ? body.af_uid : null,
    // ISSUE-855 PR-2 — the source classification + host (host only, no PII).
    entry_source: entrySource,
    referrer_host: referrerHost,
    ua_hash: uaHash,
    ip_hash: ipHash,
  };

  const { error } = await client.from("ad_attribution_touches").insert(row);
  if (error) {
    console.error("[attribution-capture] touch insert error:", error.message);
    // Echo the attempted id for diagnostics. Browser clients must require
    // ok:true before persisting it; otherwise this failed row would suppress
    // first-touch retries for the full attribution window.
    return json({
      ok: false,
      soft_error: "touch_not_recorded",
      click_id: clickId,
    });
  }
  return json({ ok: true, kind: "touch", click_id: clickId });
}

// ── Default wiring (service-role client from edge secrets) ────────────────────

function defaultGetClient(): SupabaseClient | null {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

if (import.meta.main) {
  serve((req) => handleCapture(req, { getClient: defaultGetClient }));
}
