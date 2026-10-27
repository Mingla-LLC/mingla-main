/**
 * #3872 R2 — anonymous-safe personal/tracking-link touch capture.
 *
 * Only HMAC digests reach Postgres. Durable database throttles cover both the
 * device token and request IP across isolates; inactive/removed links and bots
 * remain redirectable but never create attribution.
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore — Deno ESM import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

type TouchKind = "member" | "tracking";
type TouchSurface = "web" | "explorer_ios" | "explorer_android";
type ListingKind = "event" | "venue";

interface TouchLink {
  kind: TouchKind;
  sourceId: string;
  brandId: string;
  active: boolean;
  listingKind: ListingKind | null;
  listingId: string | null;
}

export interface ReferralTouchDeps {
  pepper: string;
  now: () => Date;
  resolveUser: (token: string) => Promise<string | null>;
  loadLink: (input: {
    kind: TouchKind;
    slug: string;
    listingKind: ListingKind | null;
    listingId: string | null;
  }) => Promise<TouchLink | null>;
  claimRate: (deviceHash: string, ipHash: string, nowIso: string) => Promise<
    "accepted" | "limited"
  >;
  insertTouch: (row: Record<string, unknown>) => Promise<string>;
  /** Project anon/publishable keys: a bearer equal to one means "no user". */
  anonKeys?: string[];
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SLUG = /^[a-z0-9][a-z0-9_-]{5,47}$/;
const DEVICE_TOKEN = /^[A-Za-z0-9._~-]{16,256}$/;
const BOT_USER_AGENT =
  /(?:bot\b|crawler|spider|slurp|facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|discordbot|whatsapp|telegrambot|pinterest|embedly|quora link preview|google-read-aloud|uptimerobot|headlesschrome|lighthouse)/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function isReferralBot(userAgent: string | null): boolean {
  return userAgent !== null && BOT_USER_AGENT.test(userAgent);
}

export function isAllowedReferralReferrer(value: string | null): boolean {
  if (value === null || value.trim() === "") return true;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      (url.hostname === "usemingla.com" ||
        url.hostname.endsWith(".usemingla.com") ||
        url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

export async function referralHmacHex(
  pepper: string,
  value: string,
): Promise<string> {
  if (pepper.length < 32) throw new Error("referral_touch_pepper_unavailable");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
  );
  return Array.from(signature)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const value: unknown = JSON.parse(atob(padded));
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/**
 * The public /r/ page calls this function with the project anon key as its
 * bearer (supabase-js always sends one). That is a guest, not a user token:
 * resolving it as a session failed with invalid_token, so no guest touch was
 * ever recorded. Treating it as "no user" can only lower privileges.
 */
export function isAnonymousBearer(token: string, anonKeys: string[]): boolean {
  if (anonKeys.some((key) => key.length > 0 && key === token)) return true;
  if (token.startsWith("sb_publishable_")) return true;
  return decodeJwtPayload(token)?.role === "anon";
}

function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || null;
  return req.headers.get("cf-connecting-ip")?.trim() ||
    req.headers.get("x-real-ip")?.trim() || null;
}

function bearer(req: Request): string | null {
  const match = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function defaultDeps(): ReferralTouchDeps {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const client = createClient(url, key, { auth: { persistSession: false } });

  const referralsEnabled = async (brandId: string): Promise<boolean> => {
    const { data, error } = await client.rpc("issue_3872_referrals_on", {
      p_brand_id: brandId,
    });
    if (error) throw new Error("referral_touch_flag_lookup_failed");
    return data === true;
  };

  const listingBelongsToBrand = async (
    kind: ListingKind,
    listingId: string,
    brandId: string,
  ): Promise<boolean> => {
    const table = kind === "event" ? "events" : "venue_listings";
    const { data, error } = await client.from(table).select("id")
      .eq("id", listingId).eq("brand_id", brandId).maybeSingle();
    if (error) throw new Error("referral_touch_listing_lookup_failed");
    return data !== null;
  };

  return {
    // Reuse the governed platform HMAC secret with explicit domain prefixes
    // (device:/ip:) instead of adding a 91st production secret for R2.
    pepper: Deno.env.get("app.qr_token_pepper") ?? "",
    anonKeys: [Deno.env.get("SUPABASE_ANON_KEY") ?? ""],
    now: () => new Date(),
    resolveUser: async (token) => {
      const { data, error } = await client.auth.getUser(token);
      return error || !data.user ? null : data.user.id;
    },
    loadLink: async (input) => {
      if (input.kind === "tracking") {
        const { data, error } = await client.from("host_tracking_links")
          .select("id,brand_id,listing_kind,listing_id,archived_at")
          .eq("slug", input.slug).maybeSingle();
        if (error) throw new Error("referral_tracking_link_lookup_failed");
        if (!data) return null;
        return {
          kind: "tracking",
          sourceId: String(data.id),
          brandId: String(data.brand_id),
          active: data.archived_at === null &&
            await referralsEnabled(String(data.brand_id)),
          listingKind: data.listing_kind as ListingKind | null,
          listingId: typeof data.listing_id === "string"
            ? data.listing_id
            : null,
        };
      }

      const { data: member, error: memberError } = await client
        .from("referral_members")
        .select("id,brand_id,offer_id,status,removed_at")
        .eq("link_slug", input.slug).maybeSingle();
      if (memberError) throw new Error("referral_member_link_lookup_failed");
      if (!member) return null;
      const { data: offer, error: offerError } = await client
        .from("referral_offers")
        .select("status,starts_at,ends_at,deleted_at,scope_kind")
        .eq("id", member.offer_id).maybeSingle();
      if (offerError) throw new Error("referral_touch_offer_lookup_failed");

      let listingKind = input.listingKind;
      let listingId = input.listingId;
      let coversListing = true;
      if (listingKind !== null && listingId !== null) {
        if (offer?.scope_kind === "listings") {
          const { data: scoped, error: scopeError } = await client
            .from("referral_offer_listings").select("offer_id")
            .eq("offer_id", member.offer_id).eq("listing_kind", listingKind)
            .eq("listing_id", listingId).maybeSingle();
          if (scopeError) throw new Error("referral_touch_scope_lookup_failed");
          coversListing = scoped !== null;
        } else {
          coversListing = await listingBelongsToBrand(
            listingKind,
            listingId,
            String(member.brand_id),
          );
        }
      } else {
        listingKind = null;
        listingId = null;
      }
      const now = Date.now();
      const starts = typeof offer?.starts_at === "string"
        ? Date.parse(offer.starts_at)
        : Number.NaN;
      const ends = typeof offer?.ends_at === "string"
        ? Date.parse(offer.ends_at)
        : Number.POSITIVE_INFINITY;
      const active = member.status === "active" && member.removed_at === null &&
        offer?.status === "active" && offer.deleted_at === null &&
        Number.isFinite(starts) && starts <= now && now < ends &&
        coversListing &&
        await referralsEnabled(String(member.brand_id));
      return {
        kind: "member",
        sourceId: String(member.id),
        brandId: String(member.brand_id),
        active,
        listingKind,
        listingId,
      };
    },
    claimRate: async (deviceHash, ipHash, nowIso) => {
      const { error } = await client.rpc(
        "issue_3872_claim_referral_touch_rate",
        {
          p_device_hash: deviceHash,
          p_ip_hash: ipHash,
          p_now: nowIso,
        },
      );
      if (!error) return "accepted";
      if (String(error.message ?? "").includes("referral_touch_rate_limited")) {
        return "limited";
      }
      throw new Error("referral_touch_rate_failed");
    },
    insertTouch: async (row) => {
      const { data, error } = await client.from("attribution_touches")
        .insert(row).select("id").single();
      if (error || !data) throw new Error("referral_touch_insert_failed");
      return String(data.id);
    },
  };
}

export async function handleReferralTouch(
  req: Request,
  deps: ReferralTouchDeps = defaultDeps(),
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (isReferralBot(req.headers.get("user-agent"))) {
    return json({ ok: true, recorded: false, reason: "bot" });
  }
  if (!isAllowedReferralReferrer(req.headers.get("referer"))) {
    return json({ error: "referrer_not_allowed" }, 403);
  }

  const ip = clientIp(req);
  if (ip === null) return json({ error: "client_ip_required" }, 400);
  let body: Record<string, unknown>;
  try {
    const value: unknown = await req.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error();
    }
    body = value as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const kind = body.kind === "member" || body.kind === "tracking"
    ? body.kind
    : null;
  const slug = typeof body.slug === "string"
    ? body.slug.trim().toLowerCase()
    : "";
  const surface = ["web", "explorer_ios", "explorer_android"].includes(
      String(body.surface ?? ""),
    )
    ? body.surface as TouchSurface
    : null;
  const deviceToken = typeof body.deviceToken === "string"
    ? body.deviceToken.trim()
    : "";
  const listingKind =
    body.listingKind === "event" || body.listingKind === "venue"
      ? body.listingKind
      : null;
  const listingId =
    typeof body.listingId === "string" && UUID.test(body.listingId)
      ? body.listingId
      : null;
  if (
    kind === null || !SLUG.test(slug) || surface === null ||
    !DEVICE_TOKEN.test(deviceToken) ||
    ((listingKind === null) !== (listingId === null))
  ) {
    return json({ error: "invalid_request" }, 400);
  }

  const authToken = bearer(req);
  let userId: string | null = null;
  if (
    authToken !== null && !isAnonymousBearer(authToken, deps.anonKeys ?? [])
  ) {
    userId = await deps.resolveUser(authToken);
    if (userId === null) return json({ error: "invalid_token" }, 401);
  }

  let deviceHash: string;
  let ipHash: string;
  try {
    [deviceHash, ipHash] = await Promise.all([
      referralHmacHex(deps.pepper, `device:${deviceToken}`),
      referralHmacHex(deps.pepper, `ip:${ip}`),
    ]);
  } catch {
    return json({ error: "service_unavailable" }, 503);
  }

  const now = deps.now();
  if (
    await deps.claimRate(deviceHash, ipHash, now.toISOString()) === "limited"
  ) {
    return json({ error: "rate_limited" }, 429);
  }
  const link = await deps.loadLink({ kind, slug, listingKind, listingId });
  if (link === null) return json({ error: "link_not_found" }, 404);
  if (!link.active) {
    return json({ ok: true, recorded: false, reason: "inactive" });
  }

  const row: Record<string, unknown> = {
    kind: link.kind,
    member_id: link.kind === "member" ? link.sourceId : null,
    tracking_id: link.kind === "tracking" ? link.sourceId : null,
    brand_id: link.brandId,
    listing_kind: link.listingKind,
    listing_id: link.listingId,
    visitor_key: deviceHash,
    user_id: userId,
    surface,
    touched_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 30 * 24 * 60 * 60_000).toISOString(),
  };
  const touchId = await deps.insertTouch(row);
  return json(
    { ok: true, recorded: true, touchId, visitorKey: deviceHash },
    201,
  );
}

if (import.meta.main) serve((req) => handleReferralTouch(req));
