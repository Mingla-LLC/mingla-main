// @ts-ignore Deno ESM runtime import.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore Deno ESM runtime import.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { AdConnectionRow } from "../_shared/adChannel.ts";
import { TIKTOK_API_BASE } from "../_shared/adCreative.ts";
import {
  assertCreativeCdnConfigured,
  CreativeTrustError,
} from "../_shared/adCreativePrepare.ts";
import {
  AdDestinationError,
  resolveAdDestination,
} from "../_shared/adDestination.ts";
import {
  buildMetaCreativeBody,
  metaGraph,
  resolveMetaClient,
} from "../_shared/meta.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const REQUEST_KEYS = new Set([
  "creative_library_id",
  "platform",
  "lane",
  "placement_id",
  "destination",
  "preview_input",
]);
const PREVIEW_INPUT_KEYS = new Set([
  "primary_text",
  "headline",
  "description",
  "call_to_action_type",
]);
const META_FORMATS: Record<string, string> = {
  meta_feed_1x1: "MOBILE_FEED_STANDARD",
  meta_feed_4x5: "MOBILE_FEED_STANDARD",
  meta_reels_9x16: "INSTAGRAM_REELS",
  meta_right_191x1: "RIGHT_COLUMN_STANDARD",
};
const TIKTOK_PLACEMENTS = new Set([
  "tiktok_infeed_9x16",
  "tiktok_1x1",
  "tiktok_16x9",
]);

function requiredProviderToken(connection: AdConnectionRow): string {
  const token = (Deno.env.get(connection.token_env_var) ?? "").trim();
  if (!token) throw new Error("provider_not_connected");
  return token;
}

function extractTrustedMetaIframe(body: unknown): string {
  if (typeof body !== "string" || !body.trim()) {
    throw new Error("preview_contract_unrecognized");
  }
  if (
    /<script\b|srcdoc\s*=|\son[a-z]+\s*=|<object\b|<embed\b|<form\b|javascript:/i
      .test(body)
  ) {
    throw new Error("preview_contract_unrecognized");
  }
  const frames = body.match(/<iframe\b[^>]*>/gi) ?? [];
  if (frames.length !== 1) throw new Error("preview_contract_unrecognized");
  const srcMatch = frames[0].match(/\ssrc\s*=\s*(["'])(.*?)\1/i);
  if (!srcMatch) throw new Error("preview_contract_unrecognized");
  let url: URL;
  try {
    url = new URL(srcMatch[2]);
  } catch {
    throw new Error("preview_contract_unrecognized");
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" || url.username || url.password ||
    !(host === "facebook.com" || host.endsWith(".facebook.com") ||
      host === "fbcdn.net" || host.endsWith(".fbcdn.net"))
  ) {
    throw new Error("preview_contract_unrecognized");
  }
  return url.toString();
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

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

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  for (const key of Object.keys(body)) {
    if (!REQUEST_KEYS.has(key)) {
      return json({ error: "unknown_field", detail: key }, 400);
    }
  }
  const creativeId = typeof body.creative_library_id === "string"
    ? body.creative_library_id.trim()
    : "";
  const platform = body.platform;
  const placementId = typeof body.placement_id === "string"
    ? body.placement_id
    : "";
  if (!creativeId) return json({ error: "creative_library_id_required" }, 400);
  if (platform !== "meta" && platform !== "tiktok") {
    return json({ error: "platform_invalid" }, 422);
  }
  if (body.lane !== "consumer") return json({ error: "lane_invalid" }, 422);
  if (
    (platform === "meta" && !META_FORMATS[placementId]) ||
    (platform === "tiktok" && !TIKTOK_PLACEMENTS.has(placementId))
  ) {
    return json({ error: "placement_unsupported" }, 422);
  }
  const previewInput = body.preview_input;
  if (
    !previewInput || typeof previewInput !== "object" ||
    Array.isArray(previewInput)
  ) {
    return json({ error: "preview_input_invalid" }, 400);
  }
  for (const key of Object.keys(previewInput as Record<string, unknown>)) {
    if (!PREVIEW_INPUT_KEYS.has(key)) {
      return json({ error: "preview_input_unknown_field", detail: key }, 400);
    }
  }
  const copy = previewInput as Record<string, unknown>;
  const primaryText = typeof copy.primary_text === "string"
    ? copy.primary_text.trim()
    : "";
  const headline = typeof copy.headline === "string"
    ? copy.headline.trim()
    : "";
  const description = typeof copy.description === "string"
    ? copy.description.trim()
    : "";
  const cta = typeof copy.call_to_action_type === "string"
    ? copy.call_to_action_type.trim()
    : "";
  if (
    !primaryText || primaryText.length > 500 ||
    !headline || headline.length > 255 ||
    description.length > 500 || !cta || cta.length > 64
  ) {
    return json({ error: "preview_input_invalid" }, 400);
  }
  const traceId = crypto.randomUUID();
  try {
    assertCreativeCdnConfigured();
  } catch (error) {
    const code = error instanceof CreativeTrustError
      ? error.code
      : "creative_cdn_config_missing";
    return json({ error: code, trace_id: traceId }, 503);
  }

  let destination;
  try {
    destination = await resolveAdDestination(supabase, body.destination);
  } catch (error) {
    if (error instanceof AdDestinationError) {
      return json({
        error: error.code,
        message: error.message,
        trace_id: traceId,
      }, error.status);
    }
    return json({ error: "destination_lookup_failed", trace_id: traceId }, 503);
  }

  const { data: connectionRow, error: connectionError } = await supabase
    .from("ad_connections")
    .select("*")
    .eq("platform", platform)
    .eq("lane", "consumer")
    .maybeSingle();
  if (connectionError) {
    return json({ error: "connection_lookup_failed", trace_id: traceId }, 503);
  }
  if (
    !connectionRow || !connectionRow.connected ||
    connectionRow.status !== "connected"
  ) {
    return json({ error: `${platform}_not_connected`, trace_id: traceId }, 424);
  }
  const connection = connectionRow as unknown as AdConnectionRow;

  const { data: creative, error: creativeError } = await supabase
    .from("ad_creatives")
    .select("id,kind,status,content_hash,ai_generated")
    .eq("id", creativeId)
    .maybeSingle();
  if (creativeError) {
    return json({ error: "creative_lookup_failed", trace_id: traceId }, 503);
  }
  if (!creative) {
    return json({ error: "creative_not_found", trace_id: traceId }, 404);
  }
  if (creative.kind !== "video" || creative.status !== "active") {
    return json(
      { error: "creative_kind_or_status_invalid", trace_id: traceId },
      422,
    );
  }
  const { data: ref, error: refError } = await supabase
    .from("ad_creative_platform_refs")
    .select("*")
    .eq("creative_id", creativeId)
    .eq("platform", platform)
    .eq("lane", "consumer")
    .eq("external_account_id", connection.external_account_id)
    .eq("content_hash", creative.content_hash)
    .eq("status", "ready")
    .maybeSingle();
  if (refError) {
    return json(
      { error: "creative_ref_lookup_failed", trace_id: traceId },
      503,
    );
  }
  if (!ref?.external_ref) {
    return json({ error: "creative_not_ready", trace_id: traceId }, 422);
  }

  const audit = async (
    action: "preview_request" | "preview_ready" | "preview_failed",
    result: string,
  ) => {
    await supabase.from("ad_status_events").insert({
      creative_ref_id: ref.id,
      platform,
      entity: "creative_ref",
      action,
      actor: user.id,
      from_status: "ready",
      to_status: "ready",
      external_ids: null,
      provider_response: { trace_id: traceId, result },
    });
  };
  await audit("preview_request", "started");

  if (platform === "meta") {
    try {
      const client = resolveMetaClient(connection);
      const extra =
        ref.external_ref_extra && typeof ref.external_ref_extra === "object"
          ? ref.external_ref_extra as Record<string, unknown>
          : {};
      const thumbnail = typeof extra.thumbnail_image_hash === "string"
        ? extra.thumbnail_image_hash
        : "";
      if (!thumbnail) {
        return json({ error: "creative_not_ready", trace_id: traceId }, 422);
      }
      const inlineCreative = buildMetaCreativeBody(client.config.pageId, {
        destUrl: destination.canonical_url,
        message: primaryText,
        headline,
        description,
        videoId: String(ref.external_ref),
        videoThumbnailImageHash: thumbnail,
        callToActionType: cta,
        aiGenerated: creative.ai_generated === true,
        campaignName: "Mingla preview",
        adName: "Mingla preview",
        validateOnly: false,
      }, client.config.igUserId);
      const payload = await metaGraph(
        client,
        "GET",
        `act_${connection.external_account_id}/generatepreviews`,
        {
          ad_format: META_FORMATS[placementId],
          creative: inlineCreative,
        },
      );
      const first = Array.isArray(payload.data)
        ? payload.data[0] as Record<string, unknown> | undefined
        : undefined;
      const previewUrl = extractTrustedMetaIframe(first?.body);
      await audit("preview_ready", "platform_rendered");
      return json({
        trace_id: traceId,
        platform,
        placement_id: placementId,
        source: "platform_rendered",
        url: previewUrl,
        destination: {
          page_type: destination.page_type,
          brand_slug: destination.brand_slug,
          entity_slug: destination.entity_slug,
        },
      });
    } catch {
      await audit("preview_failed", "preview_contract_unrecognized");
      return json(
        { error: "preview_contract_unrecognized", trace_id: traceId },
        502,
      );
    }
  }

  try {
    const extra =
      ref.external_ref_extra && typeof ref.external_ref_extra === "object"
        ? ref.external_ref_extra as Record<string, unknown>
        : {};
    const videoId = typeof extra.video_id === "string" ? extra.video_id : "";
    if (!videoId) {
      return json({ error: "preview_not_ready", trace_id: traceId }, 409);
    }
    const query = new URLSearchParams({
      advertiser_id: connection.external_account_id,
      video_ids: JSON.stringify([videoId]),
    });
    const response = await fetch(
      `${TIKTOK_API_BASE}/file/video/ad/info/?${query.toString()}`,
      {
        method: "GET",
        headers: { "Access-Token": requiredProviderToken(connection) },
      },
    );
    const payload = await responseJson(response);
    if (!response.ok || payload.code !== 0) throw new Error("provider_error");
    const data = payload.data && typeof payload.data === "object"
      ? payload.data as Record<string, unknown>
      : {};
    const list = Array.isArray(data.list) ? data.list : [];
    const entry = list.find((item) =>
      item && typeof item === "object" &&
      String((item as Record<string, unknown>).video_id ?? "") === videoId
    ) as Record<string, unknown> | undefined;
    if (
      !entry || entry.displayable !== true ||
      typeof entry.preview_url !== "string" || !entry.preview_url
    ) {
      await audit("preview_failed", "preview_not_ready");
      return json({ error: "preview_not_ready", trace_id: traceId }, 409);
    }
    let previewUrl: URL;
    try {
      previewUrl = new URL(entry.preview_url);
    } catch {
      await audit("preview_failed", "preview_contract_unrecognized");
      return json(
        { error: "preview_contract_unrecognized", trace_id: traceId },
        502,
      );
    }
    if (
      previewUrl.protocol !== "https:" || previewUrl.username ||
      previewUrl.password
    ) {
      await audit("preview_failed", "preview_contract_unrecognized");
      return json(
        { error: "preview_contract_unrecognized", trace_id: traceId },
        502,
      );
    }
    const expiry = Date.parse(String(entry.preview_url_expire_time ?? ""));
    if (!Number.isFinite(expiry)) {
      await audit("preview_failed", "preview_expiry_invalid");
      return json({ error: "preview_expiry_invalid", trace_id: traceId }, 502);
    }
    if (expiry <= Date.now() + 5 * 60_000) {
      await audit("preview_failed", "preview_link_expiring");
      return json({ error: "preview_link_expiring", trace_id: traceId }, 409);
    }
    await audit("preview_ready", "platform_external_link");
    return json({
      trace_id: traceId,
      platform,
      placement_id: placementId,
      source: "platform_external_link",
      url: previewUrl.toString(),
      expires_at: new Date(expiry).toISOString(),
      destination: {
        page_type: destination.page_type,
        brand_slug: destination.brand_slug,
        entity_slug: destination.entity_slug,
      },
    });
  } catch {
    await audit("preview_failed", "preview_provider_failed");
    return json({ error: "preview_provider_failed", trace_id: traceId }, 503);
  }
});

async function responseJson(
  response: Response,
): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}
