import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";
import {
  classifyEntrySource,
  deriveReferrerHost,
} from "../_shared/entrySource.ts";

type Surface = "buyer_web" | "consumer_ios" | "consumer_android";
type EventType =
  | "page_view"
  | "menu_open"
  | "reservation_start"
  | "availability_shown";

interface CaptureBody {
  eventId?: unknown;
  brandId?: unknown;
  venueId?: unknown;
  eventType?: unknown;
  surface?: unknown;
  journeyToken?: unknown;
  referrerHost?: unknown;
  hasAdSignal?: unknown;
}

export interface VenueOrganicCaptureDeps {
  client: SupabaseClient;
  now: () => Date;
  randomUUID: () => string;
  randomToken: () => string;
  journeyTokenForEventId?: (eventId: string) => Promise<string>;
}

const SURFACES: readonly Surface[] = [
  "buyer_web",
  "consumer_ios",
  "consumer_android",
];
const EVENT_TYPES: readonly EventType[] = [
  "page_view",
  "menu_open",
  "reservation_start",
  "availability_shown",
];
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_ORIGINS = new Set([
  "https://business.usemingla.com",
  "https://usemingla.com",
  "https://www.usemingla.com",
]);
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60;
const rateBuckets = new Map<string, number[]>();

function originHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin");
  return {
    "Access-Control-Allow-Origin":
      origin !== null && ALLOWED_ORIGINS.has(origin)
        ? origin
        : "https://business.usemingla.com",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...originHeaders(req), "Content-Type": "application/json" },
  });
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

async function hmacSha256Hex(secret: string, input: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function firstClientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unavailable";
}

async function isRateLimited(req: Request, nowMs: number): Promise<boolean> {
  const key = await sha256Hex(firstClientIp(req));
  const recent = (rateBuckets.get(key) ?? []).filter((hit) =>
    nowMs - hit < RATE_WINDOW_MS
  );
  recent.push(nowMs);
  rateBuckets.set(key, recent);
  return recent.length > RATE_MAX;
}

function accepted(value: unknown, values: readonly string[]): string | null {
  return typeof value === "string" && values.includes(value) ? value : null;
}

export async function handleVenueOrganicCapture(
  req: Request,
  deps: VenueOrganicCaptureDeps,
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: originHeaders(req) });
  }
  if (req.method !== "POST") {
    return json(req, { accepted: false, reason: "method_not_allowed" }, 405);
  }
  if (await isRateLimited(req, deps.now().getTime())) {
    return json(req, { accepted: false, reason: "rate_limited" }, 429);
  }

  let body: CaptureBody;
  try {
    body = await req.json() as CaptureBody;
  } catch {
    return json(req, { accepted: false, reason: "invalid_request" }, 400);
  }

  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const brandId = typeof body.brandId === "string" ? body.brandId : "";
  const venueId = typeof body.venueId === "string" ? body.venueId : "";
  const eventType = accepted(body.eventType, EVENT_TYPES) as EventType | null;
  const surface = accepted(body.surface, SURFACES) as Surface | null;
  if (
    !UUID.test(eventId) || !UUID.test(brandId) || !UUID.test(venueId) ||
    eventType === null || surface === null
  ) {
    return json(req, { accepted: false, reason: "invalid_request" }, 400);
  }
  if (surface !== "buyer_web") {
    return json(req, { accepted: false, reason: "source_unproven" });
  }

  const { data: venue, error: venueError } = await deps.client
    .from("venue_public_view")
    .select("id, brand_id")
    .eq("id", venueId)
    .eq("brand_id", brandId)
    .maybeSingle();
  if (venueError !== null || venue === null) {
    return json(req, { accepted: false, reason: "venue_unavailable" });
  }

  const hasAdSignal = body.hasAdSignal === true;
  const referrerHost = deriveReferrerHost(body.referrerHost);
  const source = classifyEntrySource({ hasAdSignal, referrerHost });
  if (!["search", "social", "organic", "direct"].includes(source)) {
    return json(req, { accepted: false, reason: "source_ineligible" });
  }

  let journeyId: string;
  let journeyToken: string | null = null;
  const suppliedToken =
    typeof body.journeyToken === "string" ? body.journeyToken.trim() : "";
  if (suppliedToken.length > 0) {
    const { data: journey } = await deps.client
      .from("venue_organic_journeys")
      .select("id, brand_id, venue_id, surface, expires_at")
      .eq("token_hash", await sha256Hex(suppliedToken))
      .maybeSingle();
    if (
      journey === null ||
      String(journey.brand_id) !== brandId ||
      String(journey.venue_id) !== venueId ||
      String(journey.surface) !== surface ||
      Date.parse(String(journey.expires_at)) <= deps.now().getTime()
    ) {
      return json(req, { accepted: false, reason: "journey_invalid" });
    }
    journeyId = String(journey.id);
  } else {
    if (eventType !== "page_view") {
      return json(req, { accepted: false, reason: "journey_required" });
    }
    journeyToken = deps.journeyTokenForEventId !== undefined
      ? await deps.journeyTokenForEventId(eventId)
      : deps.randomToken();
    const tokenHash = await sha256Hex(journeyToken);
    const { error: upsertError } = await deps.client
      .from("venue_organic_journeys")
      .upsert({
        id: deps.randomUUID(),
        token_hash: tokenHash,
        brand_id: brandId,
        venue_id: venueId,
        entry_source: source,
        surface,
      }, { onConflict: "token_hash", ignoreDuplicates: true });
    if (upsertError !== null) {
      console.error(
        "[venue-organic-capture] journey upsert failed",
        upsertError,
      );
      return json(req, { accepted: false, reason: "capture_unavailable" });
    }
    const { data: recovered, error: recoverError } = await deps.client
      .from("venue_organic_journeys")
      .select("id, brand_id, venue_id, surface, expires_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (
      recoverError !== null ||
      recovered === null ||
      String(recovered.brand_id) !== brandId ||
      String(recovered.venue_id) !== venueId ||
      String(recovered.surface) !== surface ||
      Date.parse(String(recovered.expires_at)) <= deps.now().getTime()
    ) {
      console.error(
        "[venue-organic-capture] journey recovery failed",
        recoverError,
      );
      return json(req, { accepted: false, reason: "capture_unavailable" });
    }
    journeyId = String(recovered.id);
  }

  const { error: eventError } = await deps.client
    .from("venue_organic_engagement_events")
    .upsert({
      id: eventId,
      journey_id: journeyId,
      brand_id: brandId,
      venue_id: venueId,
      event_type: eventType,
      surface,
    }, { onConflict: "id", ignoreDuplicates: true });
  if (eventError !== null) {
    console.error("[venue-organic-capture] event insert failed", eventError);
    return json(req, { accepted: false, reason: "capture_unavailable" });
  }
  return json(req, {
    accepted: true,
    journeyToken,
  });
}

function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("supabase_config_missing");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

if (import.meta.main) {
  serve((req) =>
    handleVenueOrganicCapture(req, {
      client: serviceClient(),
      now: () => new Date(),
      randomUUID: () => crypto.randomUUID(),
      randomToken: () => {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        return Array.from(bytes)
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
      },
      journeyTokenForEventId: (eventId) => {
        const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (!key) throw new Error("supabase_config_missing");
        return hmacSha256Hex(key, `venue-organic-journey:${eventId}`);
      },
    })
  );
}
