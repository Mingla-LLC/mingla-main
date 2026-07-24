/**
 * admin-ad-creative-upload — ISSUE-866 WP3 [Full Rooms Ad Engine — Creative
 * Library].
 *
 * Records a canonical creative row (SPEC §4.4a) — the client has already put
 * bytes in storage (image → #864's meta-ad-creatives bucket; video → Bunny) —
 * with the Amendment A1-6 byte-probe as the validation step:
 *
 *   1. ADMIN GATE FIRST (verify_jwt=true + in-code admin_users active gate —
 *      identical to the WP1 admin-ad-* fns; auth precedes input validation).
 *   2. Server-side BYTE-PROBE of the ACTUAL BYTES — populates width/height/
 *      aspect_ratio/duration_seconds/mime_type/byte_size/has_audio/
 *      content_hash. Admin-supplied dimensions are IGNORED (A1-6a / GR-22).
 *   3. The §2 validation matrix per requested channel (default: all five) —
 *      hard-rejects only on [SPEC]/[OFFICIAL] rows; [3P] rows warn (A1-6b);
 *      deterministic-fix gaps surface as typed needs_transcode outcomes.
 *   4. COMMS-0102 crawler-permissiveness check: Meta ad review DOWNLOADS the
 *      creative image_url — robots-blocked hosts hard-fail (proven, subcode
 *      3858258). The image source URL is checked STRICT (fail); video file/
 *      poster URLs are checked WARN.
 *   5. Venue/brand tags must reference EXISTING rows (place_pool / brands) —
 *      else 422, no write (RT-4: no new venue table).
 *   6. action='validate' returns the probe + matrix report WITHOUT writing;
 *      action='record' (default) INSERTs ad_creatives and returns the row.
 *
 * FAIL-CLOSE: probe failure, unresolvable byte source, kind mismatch, or a
 * 422 tag → NO row is written. This endpoint never calls an ad platform —
 * platform upload is lazy, at ad-create, via resolveCreativeRef (§4.3).
 *
 * NO platform token is read, logged, or echoed here (SC-SEC-1).
 */

// @ts-ignore — Deno ESM import; types resolved at runtime.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore — Deno ESM import; types resolved at runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isPlatform, PLATFORMS, type Platform } from "../_shared/adChannel.ts";
import {
  CreativeProbeError,
  type CreativeProbeResult,
  probeCreativeBytes,
  ratioOf,
} from "../_shared/adCreativeProbe.ts";
import {
  type ChannelValidationResult,
  classifyRatio,
  type CreativeMediaFacts,
  validateCreativeForChannels,
} from "../_shared/adCreativeMatrix.ts";
import {
  checkCreativeUrlCrawlerAccessible,
  CreativeByteSourceError,
  type CrawlerCheckResult,
  fetchCreativeBytes,
} from "../_shared/adCreative.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const VARIANT_RATIOS = new Set(["4:5", "1:1", "9:16", "1.91:1"]);

interface VariantInput {
  source_url: string;
  storage_path?: string;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  // ── ADMIN GATE FIRST (WP1 idiom: auth precedes input validation). ───────────
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const jwt = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !user) return json({ error: "unauthorized" }, 401);
  const { data: adminRow } = await supabase
    .from("admin_users")
    .select("id")
    .eq("email", user.email)
    .eq("status", "active")
    .maybeSingle();
  if (!adminRow) return json({ error: "forbidden" }, 403);

  // ── Input validation (mirrors the DB CHECKs — fail-close before any fetch). ─
  const action = body.action ?? "record";
  if (action !== "record" && action !== "validate") {
    return json({ error: "validation_error", detail: "action_invalid" }, 400);
  }
  const kind = body.kind;
  if (kind !== "image" && kind !== "video") {
    return json({ error: "validation_error", detail: "kind_invalid" }, 422);
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return json({ error: "validation_error", detail: "name_required" }, 422);

  const sourceUrl = typeof body.source_url === "string" ? body.source_url : null;
  const bunnyVideoId = typeof body.bunny_video_id === "string" ? body.bunny_video_id : null;
  const posterUrl = typeof body.poster_url === "string" ? body.poster_url : null;
  const mp4MasterUrl = typeof body.mp4_master_url === "string" ? body.mp4_master_url : null;

  if (kind === "image" && !sourceUrl) {
    return json({ error: "validation_error", detail: "image_source_url_required" }, 422);
  }
  if (kind === "video" && (!bunnyVideoId || !posterUrl)) {
    // OD-4 CHECK stands (reinforced by A1-8c — Reddit requires a video thumbnail).
    return json({ error: "validation_error", detail: "video_bunny_id_and_poster_required" }, 422);
  }
  // A1-1: content_hash is probe-derived and NOT NULL — every creative needs a
  // resolvable byte source at create. Bunny serves HLS (A1-3), so a video
  // needs the MP4 master (or a direct-MP4 source URL).
  const probeUrl = kind === "image"
    ? sourceUrl
    : mp4MasterUrl ?? (sourceUrl && /\.mp4(\?|#|$)/i.test(sourceUrl) ? sourceUrl : null);
  if (!probeUrl) {
    return json({
      error: "validation_error",
      detail: "video_mp4_source_required",
      message:
        "content_hash is computed from the canonical bytes (A1-1) and Bunny serves HLS, not a downloadable MP4 (A1-3) — supply mp4_master_url (or a direct-MP4 source_url) for video creatives.",
    }, 422);
  }

  const platformsInput = Array.isArray(body.platforms) ? body.platforms : [...PLATFORMS];
  const platforms: Platform[] = [];
  for (const value of platformsInput) {
    if (!isPlatform(value)) {
      return json({ error: "validation_error", detail: `platform_invalid:${String(value)}` }, 422);
    }
    platforms.push(value);
  }

  // ── Venue/brand tags reference EXISTING entities or the write is rejected. ──
  const placeId = typeof body.place_id === "string" ? body.place_id : null;
  const brandId = typeof body.brand_id === "string" ? body.brand_id : null;
  if (placeId) {
    const { data: place } = await supabase
      .from("place_pool")
      .select("id")
      .eq("id", placeId)
      .maybeSingle();
    if (!place) return json({ error: "venue_not_found", detail: "place_id does not exist in place_pool" }, 422);
  }
  if (brandId) {
    const { data: brand } = await supabase
      .from("brands")
      .select("id")
      .eq("id", brandId)
      .maybeSingle();
    if (!brand) return json({ error: "brand_not_found", detail: "brand_id does not exist in brands" }, 422);
  }

  // ── The A1-6 byte-probe (never trust admin-supplied dimensions). ────────────
  let probe: CreativeProbeResult;
  try {
    const bytes = await fetchCreativeBytes(probeUrl);
    probe = await probeCreativeBytes(bytes);
  } catch (err) {
    if (err instanceof CreativeProbeError || err instanceof CreativeByteSourceError) {
      return json({ error: "probe_failed", detail: err.detail, message: err.message }, 422);
    }
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[admin-ad-creative-upload] probe unexpected:", detail);
    return json({ error: "internal_error" }, 500);
  }
  if (probe.kind !== kind) {
    return json({
      error: "validation_error",
      detail: "kind_mismatch",
      message: `Declared kind "${kind}" but the bytes probe as ${probe.kind} (${probe.mimeType}).`,
    }, 422);
  }

  // ── Variant slots (A1-6c): probed server-side too — never client-trusted. ───
  const variantsInput = (body.variants && typeof body.variants === "object" && !Array.isArray(body.variants))
    ? body.variants as Record<string, unknown>
    : {};
  const variants: Record<string, Record<string, unknown>> = {};
  for (const [ratioLabel, raw] of Object.entries(variantsInput)) {
    if (!VARIANT_RATIOS.has(ratioLabel)) {
      return json({ error: "validation_error", detail: `variant_ratio_unknown:${ratioLabel}` }, 422);
    }
    const slot = raw as VariantInput;
    if (!slot || typeof slot.source_url !== "string") {
      return json({ error: "validation_error", detail: `variant_source_url_required:${ratioLabel}` }, 422);
    }
    let variantProbe: CreativeProbeResult;
    try {
      const variantBytes = await fetchCreativeBytes(slot.source_url);
      variantProbe = await probeCreativeBytes(variantBytes);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json({
        error: "probe_failed",
        detail: `variant_probe_failed:${ratioLabel}`,
        message,
      }, 422);
    }
    const probedLabel = classifyRatio(
      ratioOf(variantProbe.width, variantProbe.height),
      [ratioLabel],
      0.03,
    );
    if (probedLabel !== ratioLabel) {
      return json({
        error: "validation_error",
        detail: `variant_ratio_mismatch:${ratioLabel}`,
        message: `The ${ratioLabel} variant slot probes as ${variantProbe.width}×${variantProbe.height} — not ${ratioLabel}.`,
      }, 422);
    }
    variants[ratioLabel] = {
      source_url: slot.source_url,
      storage_path: typeof slot.storage_path === "string" ? slot.storage_path : null,
      width: variantProbe.width,
      height: variantProbe.height,
      content_hash: variantProbe.contentHash,
      byte_size: variantProbe.byteSize,
    };
  }

  // ── The §2 matrix per requested channel (A1-6b tiers). ──────────────────────
  const facts: CreativeMediaFacts = {
    kind,
    mimeType: probe.mimeType,
    container: probe.container,
    width: probe.width,
    height: probe.height,
    aspectRatio: probe.aspectRatio,
    durationSeconds: probe.durationSeconds,
    hasAudio: probe.hasAudio,
    byteSize: probe.byteSize,
    overallBitrateKbps: probe.overallBitrateKbps,
    posterPresent: posterUrl !== null,
    variantRatios: Object.keys(variants),
  };
  const channels: ChannelValidationResult[] = validateCreativeForChannels(platforms, facts);

  // ── COMMS-0102 crawler-permissiveness (Meta hard-fails robots-blocked hosts).
  const crawler: CrawlerCheckResult[] = [];
  if (kind === "image" && sourceUrl) {
    // Meta ad review DOWNLOADS image_url — strict (tier "fail" on block).
    crawler.push(await checkCreativeUrlCrawlerAccessible(sourceUrl, { strict: platforms.includes("meta") }));
  }
  if (kind === "video") {
    // TikTok UPLOAD_BY_URL and Meta advideos file_url fetch these server-side —
    // warn tier (their robots behavior is not live-proven the way Meta images are).
    crawler.push(await checkCreativeUrlCrawlerAccessible(probeUrl, { strict: false }));
    if (posterUrl) crawler.push(await checkCreativeUrlCrawlerAccessible(posterUrl, { strict: false }));
  }

  const validation = {
    content_hash: probe.contentHash,
    probe: {
      kind: probe.kind,
      mime_type: probe.mimeType,
      container: probe.container,
      width: probe.width,
      height: probe.height,
      aspect_ratio: probe.aspectRatio,
      duration_seconds: probe.durationSeconds,
      has_audio: probe.hasAudio,
      byte_size: probe.byteSize,
      overall_bitrate_kbps: probe.overallBitrateKbps,
      video_codec_fourcc: probe.videoCodecFourcc,
    },
    channels,
    crawler,
  };

  if (action === "validate") return json({ validation });

  // ── Record the canonical row — probe-derived fields only (A1-6a). ───────────
  // ai_generated: A1-8 — stock/real UI + Remotion is the default pipeline.
  // Magnific is explicit opt-in, so an omitted flag defaults to non-generated.
  // Explicit true still propagates for creative containing generated pixels.
  const aiGenerated = typeof body.ai_generated === "boolean" ? body.ai_generated : false;
  const { data: creative, error: insertError } = await supabase
    .from("ad_creatives")
    .insert({
      kind,
      name,
      source_url: sourceUrl,
      storage_bucket: typeof body.storage_bucket === "string" ? body.storage_bucket : null,
      storage_path: typeof body.storage_path === "string" ? body.storage_path : null,
      bunny_video_id: bunnyVideoId,
      poster_url: posterUrl,
      mp4_master_url: mp4MasterUrl,
      place_id: placeId,
      brand_id: brandId,
      width: probe.width,
      height: probe.height,
      aspect_ratio: probe.aspectRatio,
      duration_seconds: probe.durationSeconds,
      mime_type: probe.mimeType,
      byte_size: probe.byteSize,
      has_audio: probe.hasAudio,
      content_hash: probe.contentHash,
      ai_generated: aiGenerated,
      variants,
      status: "active",
      created_by: user.id,
    })
    .select("*")
    .maybeSingle();
  if (insertError) {
    console.error("[admin-ad-creative-upload] insert failed:", insertError.message);
    return json({ error: "internal_error" }, 500);
  }

  return json({ creative, validation });
});
