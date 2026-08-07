import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mapCuratedSnapshot, mapPlaceSnapshot, publicSnapshotResponse, sharedCardOneLink, shareText } from "./snapshot.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-mingla-shared-card-proxy",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" },
});
const SHARE_RE = /^[a-f0-9]{36}$/;
const clean = shareText;
async function actorHash(secret: string, actor: string) {
  const bytes = new TextEncoder().encode(`${secret}:${actor}`);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function constantTimeEqualSecret(provided: string, expected: string) {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(providedHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (req.method === "GET") {
      const expectedProxySecret = Deno.env.get("SHARED_CARD_PROXY_SECRET") || "";
      const providedProxySecret = req.headers.get("x-mingla-shared-card-proxy") || "";
      if (!expectedProxySecret || !providedProxySecret ||
        !(await constantTimeEqualSecret(providedProxySecret, expectedProxySecret))) {
        return json({ error: "not_found" }, 404);
      }
      const url = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const db = createClient(url, serviceKey, { auth: { persistSession: false } });
      const shareId = new URL(req.url).searchParams.get("shareId") || "";
      if (!SHARE_RE.test(shareId)) return json({ error: "not_found" }, 404);
      // Vercel WAF is the gateway-backed rate limit and owns caller fairness.
      // This single aggregate bucket is only a
      // defense-in-depth circuit breaker, so no public share can exhaust a
      // per-share bucket and deny that link to every other viewer.
      const hash = await actorHash(serviceKey, "trusted-vercel-share-proxy");
      const { data: allowed, error: limitError } = await db.rpc("consume_shared_card_rate_limit", {
        p_actor_hash: hash, p_action: "read", p_limit: 6000, p_window_seconds: 60,
      });
      if (limitError) throw limitError;
      if (!allowed) return json({ error: "rate_limited" }, 429);
      const { data, error } = await db.from("shared_card_snapshots").select("share_id,snapshot_version,kind,title,cover_url,metadata,stops,attribution,created_at,expires_at,revoked_at").eq("share_id", shareId).maybeSingle();
      if (error || !data) return json({ error: "not_found" }, 404);
      if (data.revoked_at || new Date(data.expires_at).getTime() <= Date.now()) return json({ error: "gone" }, 410);
      return json(publicSnapshotResponse(data));
    }
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(url, serviceKey, { auth: { persistSession: false } });
    const auth = req.headers.get("authorization") || "";
    const jwt = auth.replace(/^Bearer\s+/i, "");
    const { data: userData } = await db.auth.getUser(jwt);
    const user = userData.user;
    if (!user) return json({ error: "unauthorized" }, 401);
    const hash = await actorHash(serviceKey, user.id);
    const { data: allowed, error: limitError } = await db.rpc("consume_shared_card_rate_limit", {
      p_actor_hash: hash, p_action: "create", p_limit: 20, p_window_seconds: 3600,
    });
    if (limitError) throw limitError;
    if (!allowed) return json({ error: "rate_limited" }, 429);
    const raw = await req.json().catch(() => null) as Record<string, unknown> | null;
    const kind = raw?.kind === "curated" ? "curated" : raw?.kind === "place" ? "place" : null;
    const ids = raw?.sourceIds && typeof raw.sourceIds === "object" && !Array.isArray(raw.sourceIds)
      ? raw.sourceIds as Record<string, unknown> : {};
    if (!kind) return json({ error: "validation" }, 400);
    let title = ""; let coverUrl: string | null = null; let metadata: Record<string, unknown> = {};
    let stops: Array<Record<string, unknown>> = []; let sourceIds: Record<string, unknown> = {};
    if (kind === "place") {
      const placePoolId = clean(ids.placePoolId, 64);
      const googlePlaceId = clean(ids.googlePlaceId, 256);
      if (!placePoolId && !googlePlaceId) return json({ error: "validation" }, 400);
      let query = db.from("place_pool").select("id,google_place_id,name,address,city,country,primary_type_display_name,primary_type,rating,price_level,photo_collage_url,stored_photo_urls,is_active,is_servable,editorial_summary,generative_summary,opening_hours,google_maps_uri,national_phone_number,website").limit(1);
      query = placePoolId ? query.eq("id", placePoolId) : query.eq("google_place_id", googlePlaceId);
      const { data: place } = await query.maybeSingle();
      if (!place || place.is_active !== true || place.is_servable === false) return json({ error: "not_found" }, 404);
      ({ title, coverUrl, metadata, stops, sourceIds } = mapPlaceSnapshot(place));
    } else {
      const savedCardId = clean(ids.savedCardId, 64);
      if (!savedCardId) return json({ error: "validation" }, 400);
      const { data: saved } = await db.from("saved_card").select("id,profile_id,experience_id,title,category,image_url,card_data").eq("id", savedCardId).eq("profile_id", user.id).maybeSingle();
      if (!saved) return json({ error: "not_found" }, 404);
      ({ title, coverUrl, metadata, stops, sourceIds } = mapCuratedSnapshot(saved));
    }
    if (!title) return json({ error: "not_found" }, 404);
    const rawAttribution = raw?.attribution && typeof raw.attribution === "object" && !Array.isArray(raw.attribution) ? raw.attribution as Record<string, unknown> : {};
    const attribution = Object.fromEntries([["channel", clean(rawAttribution.channel, 40)], ["referralCode", clean(rawAttribution.referralCode, 80)]].filter(([, value]) => value));
    const { data, error } = await db.from("shared_card_snapshots").insert({
      owner_profile_id: user.id, snapshot_version: 1, kind, title,
      cover_url: coverUrl, metadata, stops, source_ids: sourceIds, attribution,
    }).select("share_id,snapshot_version,kind,title,cover_url,metadata,stops,source_ids,attribution,created_at,expires_at").single();
    if (error) throw error;
    const referral = clean(attribution.referralCode, 80);
    const appUrl = sharedCardOneLink(data.kind, data.share_id, referral);
    return json({ snapshot: data, canonicalUrl: `https://usemingla.com/p/${data.share_id}`, appUrl, s4Url: data.cover_url ? `https://usemingla.com/share/${data.share_id}.png` : null, s5Url: data.cover_url ? `https://usemingla.com/og/share/${data.share_id}.png` : null }, 201);
  } catch (error) {
    console.error("shared-card failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "server" }, 500);
  }
});
