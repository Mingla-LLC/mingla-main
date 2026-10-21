import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";

const ENTITY_TYPES = ["event", "brand", "trip", "experience", "venue"] as const;
const EVENT_TYPES = [
  "page_view",
  "cta_click",
  "checkout_start",
  "app_impression",
  "app_open",
] as const;
const CTA_TYPES = [
  "buy",
  "book",
  "rsvp",
  "share",
  "save",
  "directions",
  "website",
  "call",
] as const;
const SURFACES = ["buyer_web", "consumer_ios", "consumer_android"] as const;
const BODY_KEYS = new Set([
  "eventId",
  "brandId",
  "entityType",
  "entityId",
  "eventType",
  "ctaType",
  "checkoutSessionId",
  "surface",
  "pageUrl",
  "referrer",
]);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BOT_USER_AGENT =
  /(?:bot\b|crawler|spider|slurp|headlesschrome|lighthouse|pagespeed|preview|facebookexternalhit|facebot|twitterbot|linkedinbot|discordbot|slackbot|telegrambot|pinterestbot|applebot|google-inspectiontool|uptimerobot|pingdom|statuscake|curl\/|wget\/|python-requests|go-http-client)/i;
const ALLOWED_ORIGINS = new Set([
  "https://host.usemingla.com",
  "https://usemingla.com",
  "https://www.usemingla.com",
]);

type EntityType = (typeof ENTITY_TYPES)[number];
type EventType = (typeof EVENT_TYPES)[number];
type CtaType = (typeof CTA_TYPES)[number];
type Surface = (typeof SURFACES)[number];

interface CaptureBody {
  eventId: string;
  brandId: string;
  entityType: EntityType;
  entityId: string | null;
  eventType: EventType;
  ctaType: CtaType | null;
  checkoutSessionId: string | null;
  surface: Surface;
  pageUrl: string | null;
  referrer: string | null;
}

interface SourceSignals {
  mcId: string | null;
  referrerHost: string | null;
  referrerPath: string | null;
  hasMinglaShare: boolean;
  hasNonMinglaUtm: boolean;
}

export interface OfferingEngagementCaptureDeps {
  client: SupabaseClient;
  now: () => Date;
  randomSalt: () => string;
}

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin");
  return {
    "Access-Control-Allow-Origin":
      origin !== null && ALLOWED_ORIGINS.has(origin)
        ? origin
        : "https://host.usemingla.com",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function empty(req: Request, status = 204): Response {
  return new Response(null, { status, headers: corsHeaders(req) });
}

function isOneOf<T extends string>(
  value: unknown,
  values: readonly T[],
): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function optionalString(
  value: unknown,
  maxLength: number,
): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength
    ? trimmed
    : undefined;
}

export function validateCaptureBody(value: unknown): CaptureBody | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !BODY_KEYS.has(key))) return null;
  if (
    typeof row.eventId !== "string" ||
    !UUID.test(row.eventId) ||
    typeof row.brandId !== "string" ||
    !UUID.test(row.brandId) ||
    !isOneOf(row.entityType, ENTITY_TYPES) ||
    !isOneOf(row.eventType, EVENT_TYPES) ||
    !isOneOf(row.surface, SURFACES)
  ) {
    return null;
  }
  const entityId = row.entityId === null
    ? null
    : typeof row.entityId === "string" && UUID.test(row.entityId)
    ? row.entityId
    : undefined;
  if (
    entityId === undefined ||
    (row.entityType === "brand") !== (entityId === null)
  ) {
    return null;
  }
  const ctaType = row.ctaType === undefined || row.ctaType === null
    ? null
    : isOneOf(row.ctaType, CTA_TYPES)
    ? row.ctaType
    : undefined;
  const checkoutSessionId =
    row.checkoutSessionId === undefined || row.checkoutSessionId === null
      ? null
      : typeof row.checkoutSessionId === "string" &&
          UUID.test(row.checkoutSessionId)
      ? row.checkoutSessionId
      : undefined;
  if (
    ctaType === undefined ||
    checkoutSessionId === undefined ||
    (row.eventType === "cta_click") !== (ctaType !== null) ||
    (row.eventType === "checkout_start") !== (checkoutSessionId !== null)
  ) {
    return null;
  }
  const pageUrl = optionalString(row.pageUrl, 2048);
  const referrer = optionalString(row.referrer, 2048);
  if (pageUrl === undefined || referrer === undefined) return null;
  if (row.surface === "buyer_web" && pageUrl === null) return null;
  if (row.surface !== "buyer_web" && (pageUrl !== null || referrer !== null)) {
    return null;
  }
  return {
    eventId: row.eventId,
    brandId: row.brandId,
    entityType: row.entityType,
    entityId,
    eventType: row.eventType,
    ctaType,
    checkoutSessionId,
    surface: row.surface,
    pageUrl,
    referrer,
  };
}

function normalizedUrl(value: string | null): URL | null {
  if (value === null) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function normalizedHost(url: URL | null): string | null {
  if (url === null) return null;
  const host = url.hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  return host.length > 0 && host.length <= 253 && /^[a-z0-9.-]+$/.test(host)
    ? host
    : null;
}

export function sourceSignals(body: CaptureBody): SourceSignals {
  const page = normalizedUrl(body.pageUrl);
  const referrer = normalizedUrl(body.referrer);
  const mcId = optionalString(page?.searchParams.get("mc_id"), 200) ?? null;
  const utmKeys = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
  ];
  const hasUtm = page !== null &&
    utmKeys.some((key) => page.searchParams.has(key));
  const utmSource =
    page?.searchParams.get("utm_source")?.trim().toLowerCase() ?? "";
  return {
    mcId,
    referrerHost: normalizedHost(referrer),
    referrerPath: referrer?.pathname.slice(0, 256).toLowerCase() ?? null,
    hasMinglaShare: page?.searchParams.has("ms") === true,
    hasNonMinglaUtm: hasUtm && utmSource !== "mingla" &&
      utmSource !== "usemingla",
  };
}

function firstClientIp(req: Request): string | null {
  const candidate = req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null;
  return candidate !== null && candidate.length > 0 && candidate.length <= 64
    ? candidate
    : null;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function dailyVisitorKey(
  req: Request,
  deps: OfferingEngagementCaptureDeps,
): Promise<string | null> {
  const ip = firstClientIp(req);
  const userAgent = req.headers.get("user-agent")?.trim() ?? "";
  if (ip === null || userAgent.length === 0 || userAgent.length > 1024) {
    return null;
  }
  // WhatsApp link previews identify as a bare `WhatsApp/...` agent, while a
  // person opening the link in WhatsApp's in-app browser keeps a Mozilla UA
  // with an appended WhatsApp token. Count the human browser; drop the preview.
  if (
    BOT_USER_AGENT.test(userAgent) ||
    (/^WhatsApp\//i.test(userAgent) && !/Mozilla\//i.test(userAgent))
  ) {
    return null;
  }
  const day = deps.now().toISOString().slice(0, 10);
  const { data, error } = await deps.client.rpc(
    "claim_offering_engagement_salt",
    {
      p_day: day,
      p_candidate: deps.randomSalt(),
    },
  );
  if (
    error !== null ||
    typeof data !== "string" ||
    !/^[0-9a-f]{64}$/.test(data)
  ) {
    return null;
  }
  return sha256Hex(`${data}\n${ip}\n${userAgent}`);
}

export async function handleOfferingEngagementCapture(
  req: Request,
  deps: OfferingEngagementCaptureDeps,
): Promise<Response> {
  if (req.method === "OPTIONS") return empty(req);
  if (req.method !== "POST") return empty(req, 405);
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return empty(req);
  }
  const body = validateCaptureBody(raw);
  if (body === null) return empty(req);
  const visitorKey = await dailyVisitorKey(req, deps);
  if (visitorKey === null) return empty(req);
  const signals = sourceSignals(body);
  try {
    const { error } = await deps.client.rpc(
      "capture_offering_engagement_event",
      {
        p_event_id: body.eventId,
        p_brand_id: body.brandId,
        p_entity_type: body.entityType,
        p_entity_id: body.entityId,
        p_event_type: body.eventType,
        p_cta_type: body.ctaType,
        p_surface: body.surface,
        p_visitor_key: visitorKey,
        p_checkout_session_id: body.checkoutSessionId,
        p_mc_id: signals.mcId,
        p_referrer_host: signals.referrerHost,
        p_referrer_path: signals.referrerPath,
        p_has_mingla_share: signals.hasMinglaShare,
        p_has_non_mingla_utm: signals.hasNonMinglaUtm,
      },
    );
    if (error !== null) {
      console.error("[offering-engagement-capture] capture unavailable", error);
    }
  } catch (error) {
    console.error("[offering-engagement-capture] capture failed", error);
  }
  return empty(req);
}

function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("supabase_config_missing");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function randomSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

if (import.meta.main) {
  serve((req) =>
    handleOfferingEngagementCapture(req, {
      client: serviceClient(),
      now: () => new Date(),
      randomSalt,
    })
  );
}
