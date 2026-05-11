// ORCH-0770 shared helpers for event-cover video processing edge functions.
// @ts-ignore - Deno ESM import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// @ts-ignore - Deno ESM import
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cld-signature, x-cld-timestamp",
};

export const FINAL_MAX_BYTES = Number.parseInt(
  Deno.env.get("EVENT_COVER_FINAL_MAX_BYTES") ?? "26214400",
  10,
);
export const MAX_DURATION_MS = Number.parseInt(
  Deno.env.get("EVENT_COVER_MAX_DURATION_MS") ?? "15000",
  10,
);
export const MAX_SOURCE_VIDEO_BYTES = Number.parseInt(
  Deno.env.get("EVENT_COVER_MAX_SOURCE_VIDEO_BYTES") ?? "524288000",
  10,
);
export const MAX_SOURCE_VIDEO_DURATION_MS = Number.parseInt(
  Deno.env.get("EVENT_COVER_MAX_SOURCE_VIDEO_DURATION_MS") ?? "300000",
  10,
);

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function isValidUuid(input: unknown): input is string {
  return typeof input === "string" && UUID_REGEX.test(input);
}

export function serviceRoleClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}

export async function requireUserId(req: Request): Promise<string | Response> {
  const authHeader = req.headers.get("authorization") ?? "";
  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return jsonResponse({ error: "unauthenticated" }, 401);

  const token = tokenMatch[1];
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) return jsonResponse({ error: "unauthenticated" }, 401);
  return data.user.id;
}

export async function requireEventManager(
  supabase: SupabaseClient,
  eventId: string,
  brandId: string,
  userId: string,
): Promise<{ event: { id: string; brand_id: string; status: string | null } } | Response> {
  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id, brand_id, status")
    .eq("id", eventId)
    .eq("brand_id", brandId)
    .is("deleted_at", null)
    .maybeSingle();
  if (eventError) {
    console.error("[event-cover-video] event read failed:", eventError);
    return jsonResponse(
      { error: "internal_error", detail: "event_read_failed" },
      500,
    );
  }
  if (!event) return jsonResponse({ error: "not_found", detail: "event_not_found" }, 404);

  const { data: rank, error: rankError } = await supabase.rpc(
    "biz_brand_effective_rank",
    { p_brand_id: brandId, p_user_id: userId },
  );
  if (rankError) {
    console.error("[event-cover-video] role check failed:", rankError);
    return jsonResponse(
      { error: "internal_error", detail: "role_check_failed" },
      500,
    );
  }
  const { data: requiredRank, error: requiredRankError } = await supabase.rpc(
    "biz_role_rank",
    { p_role: "event_manager" },
  );
  if (requiredRankError) {
    console.error("[event-cover-video] role rank failed:", requiredRankError);
    return jsonResponse(
      { error: "internal_error", detail: "role_rank_failed" },
      500,
    );
  }
  if (Number(rank ?? 0) < Number(requiredRank ?? 40)) {
    return jsonResponse({ error: "forbidden", detail: "permission_denied" }, 403);
  }
  return { event };
}

export function providerConfigured(): boolean {
  return (
    (Deno.env.get("EVENT_COVER_VIDEO_PROVIDER") ?? "cloudinary") === "cloudinary" &&
    Boolean(Deno.env.get("CLOUDINARY_CLOUD_NAME")) &&
    Boolean(Deno.env.get("CLOUDINARY_API_KEY")) &&
    Boolean(Deno.env.get("CLOUDINARY_API_SECRET"))
  );
}

export async function sha1Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function cloudinarySignature(params: Record<string, string>): Promise<string> {
  const secret = Deno.env.get("CLOUDINARY_API_SECRET") ?? "";
  const base = Object.keys(params)
    .filter((key) => params[key] !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return sha1Hex(`${base}${secret}`);
}

export type CloudinaryNotificationSignatureResult =
  | { ok: true }
  | { ok: false; code: string; status: number; message: string };

export async function verifyCloudinaryNotificationSignature(input: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  apiSecret: string;
  nowMs?: number;
  toleranceSeconds?: number;
}): Promise<CloudinaryNotificationSignatureResult> {
  if (input.apiSecret.length === 0) {
    return {
      ok: false,
      code: "missing_api_secret",
      message: "Cloudinary API secret is not configured.",
      status: 500,
    };
  }
  if (input.signature === null || input.signature.trim().length === 0) {
    return {
      ok: false,
      code: "missing_signature",
      message: "Cloudinary signature is missing.",
      status: 403,
    };
  }
  if (input.timestamp === null || input.timestamp.trim().length === 0) {
    return {
      ok: false,
      code: "missing_timestamp",
      message: "Cloudinary timestamp is missing.",
      status: 403,
    };
  }

  const timestampSeconds = Number.parseInt(input.timestamp, 10);
  if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) {
    return {
      ok: false,
      code: "invalid_timestamp",
      message: "Cloudinary timestamp is invalid.",
      status: 403,
    };
  }

  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const tolerance = input.toleranceSeconds ?? 3600;
  if (Math.abs(nowSeconds - timestampSeconds) > tolerance) {
    return {
      ok: false,
      code: "stale_timestamp",
      message: "Cloudinary timestamp is outside the allowed tolerance.",
      status: 403,
    };
  }

  const expected = await sha1Hex(`${input.rawBody}${input.timestamp}${input.apiSecret}`);
  if (expected !== input.signature.trim()) {
    return {
      ok: false,
      code: "invalid_signature",
      message: "Cloudinary signature is invalid.",
      status: 403,
    };
  }

  return { ok: true };
}

export function validateTrimRange(input: {
  sourceDurationMs: number | null;
  trimStartMs: number;
  trimEndMs: number;
}): Response | null {
  if (!Number.isFinite(input.trimStartMs) || !Number.isFinite(input.trimEndMs)) {
    return jsonResponse({ error: "validation_error", detail: "trim_invalid" }, 400);
  }
  if (input.trimStartMs < 0 || input.trimEndMs <= input.trimStartMs) {
    return jsonResponse({ error: "validation_error", detail: "trim_invalid" }, 400);
  }
  if (input.trimEndMs - input.trimStartMs > MAX_DURATION_MS) {
    return jsonResponse({ error: "validation_error", detail: "trim_over_duration" }, 422);
  }
  if (
    typeof input.sourceDurationMs === "number" &&
    input.sourceDurationMs > 0 &&
    input.trimEndMs > input.sourceDurationMs + 250
  ) {
    return jsonResponse({ error: "validation_error", detail: "trim_out_of_range" }, 422);
  }
  return null;
}

export function assertProcessedDerivative(input: {
  url: unknown;
  mimeType: unknown;
  bytes: unknown;
  durationMs: unknown;
  videoCodec?: unknown;
  audioCodec?: unknown;
}): { ok: true; url: string; bytes: number; durationMs: number } | { ok: false; code: string; message: string } {
  if (typeof input.url !== "string" || !/^https:\/\//i.test(input.url)) {
    return { ok: false, code: "processed_url_invalid", message: "Processed video URL was invalid." };
  }
  if (input.mimeType !== "video/mp4") {
    return { ok: false, code: "processed_mime_invalid", message: "Processed video was not video/mp4." };
  }
  const bytes = typeof input.bytes === "number" ? input.bytes : Number(input.bytes);
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes > FINAL_MAX_BYTES) {
    return { ok: false, code: "processed_size_invalid", message: "Processed video was over the final size budget." };
  }
  const durationMs =
    typeof input.durationMs === "number" ? input.durationMs : Number(input.durationMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_DURATION_MS) {
    return { ok: false, code: "processed_duration_invalid", message: "Processed video was over the duration limit." };
  }
  if (
    typeof input.videoCodec === "string" &&
    input.videoCodec.length > 0 &&
    !/h\.?264|avc1|libx264/i.test(input.videoCodec)
  ) {
    return { ok: false, code: "processed_codec_invalid", message: "Processed video was not H.264." };
  }
  if (
    typeof input.audioCodec === "string" &&
    input.audioCodec.length > 0 &&
    !/aac|mp4a/i.test(input.audioCodec)
  ) {
    return { ok: false, code: "processed_audio_invalid", message: "Processed video audio was not AAC." };
  }
  return { ok: true, url: input.url, bytes, durationMs };
}
