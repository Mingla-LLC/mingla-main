// @ts-ignore Deno ESM runtime import.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore Deno ESM runtime import.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { AdConnectionRow } from "../_shared/adChannel.ts";
import type { AdCreativeRow } from "../_shared/adCreative.ts";
import { CreativeUploadError } from "../_shared/adCreative.ts";
import {
  assertCreativeCdnConfigured,
  capabilityFor,
  CreativeTrustError,
  isPreparationPlatform,
  type PreparationPlatform,
  PREPARE_PROVIDER_ADAPTERS,
  type PrepareBeginRow,
  ProviderRateLimitError,
  toPreparationState,
  verifyCreativeBytes,
} from "../_shared/adCreativePrepare.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

const REQUEST_KEYS = new Set([
  "action",
  "creative_library_id",
  "platform",
  "lane",
]);
const SAFE_ERROR_MESSAGES: Record<string, string> = {
  provider_terminal:
    "The platform could not process this video. Retry this platform.",
  provider_init_failed:
    "The platform could not accept this video. Check the format or connection, then retry.",
  preparation_deadline_exceeded:
    "The platform is taking longer than this check allowed. Check status before uploading again.",
  provider_check_transient:
    "The platform status could not be checked. Try again shortly.",
  provider_rate_limited: "The platform asked us to wait before checking again.",
};

function elapsedSeconds(startedAt: string | null): number {
  if (!startedAt) return 0;
  const started = Date.parse(startedAt);
  return Number.isFinite(started)
    ? Math.max(0, Math.floor((Date.now() - started) / 1000))
    : 0;
}

function envelope(
  row: PrepareBeginRow,
  creativeId: string,
  platform: PreparationPlatform,
  traceId: string,
  opts: {
    cached?: boolean;
    retryAfterSeconds?: number;
    preview?: Record<string, unknown> | null;
    errorCode?: string | null;
    retryable?: boolean;
  } = {},
): Record<string, unknown> {
  const code = opts.errorCode ?? row.current_error_code;
  return {
    trace_id: traceId,
    creative_library_id: creativeId,
    ref_id: row.ref_id,
    platform,
    lane: "consumer",
    state: toPreparationState(row.current_status),
    capability: capabilityFor(platform),
    cached: opts.cached ?? row.current_status === "ready",
    retryable: opts.retryable ?? row.current_retryable,
    started_at: row.current_attempt_started_at,
    last_checked_at: row.current_last_checked_at,
    deadline_at: row.current_deadline_at,
    elapsed_seconds: elapsedSeconds(row.current_attempt_started_at),
    retry_after_seconds: opts.retryAfterSeconds ?? null,
    preview: opts.preview ?? null,
    error: code
      ? {
        code,
        message: SAFE_ERROR_MESSAGES[code] ??
          "We could not finish this platform handoff. Retry this row.",
        trace_id: traceId,
      }
      : null,
  };
}

function rowFromRef(data: Record<string, unknown>): PrepareBeginRow {
  return {
    ref_id: String(data.id),
    won: false,
    decision: data.status === "ready"
      ? "return_ready"
      : data.status === "pending"
      ? "return_not_started"
      : data.status === "failed" || data.status === "timed_out"
      ? "return_terminal"
      : "return_active",
    current_attempt_id: typeof data.attempt_id === "string"
      ? data.attempt_id
      : null,
    current_attempt_count: Number(data.attempt_count ?? 0),
    current_status: String(data.status) as PrepareBeginRow["current_status"],
    current_external_ref: typeof data.external_ref === "string"
      ? data.external_ref
      : null,
    current_external_ref_extra:
      data.external_ref_extra && typeof data.external_ref_extra === "object"
        ? data.external_ref_extra as Record<string, unknown>
        : {},
    current_content_hash: String(data.content_hash ?? ""),
    current_attempt_started_at: typeof data.attempt_started_at === "string"
      ? data.attempt_started_at
      : null,
    current_provider_ref_recorded_at:
      typeof data.provider_ref_recorded_at === "string"
        ? data.provider_ref_recorded_at
        : null,
    current_last_checked_at: typeof data.last_checked_at === "string"
      ? data.last_checked_at
      : null,
    current_deadline_at: typeof data.deadline_at === "string"
      ? data.deadline_at
      : null,
    current_error_code: typeof data.error_code === "string"
      ? data.error_code
      : null,
    current_retryable: data.retryable === true,
    current_provider_terminal_attempt_id:
      typeof data.provider_terminal_attempt_id === "string"
        ? data.provider_terminal_attempt_id
        : null,
    current_provider_terminal_at: typeof data.provider_terminal_at === "string"
      ? data.provider_terminal_at
      : null,
    current_provider_terminal_code:
      typeof data.provider_terminal_code === "string"
        ? data.provider_terminal_code
        : null,
    current_trace_id: typeof data.trace_id === "string" ? data.trace_id : null,
  };
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
  const action = body.action;
  const creativeId = typeof body.creative_library_id === "string"
    ? body.creative_library_id.trim()
    : "";
  const platform = body.platform;
  const lane = body.lane;
  if (!["start", "status", "retry"].includes(String(action))) {
    return json({ error: "action_invalid" }, 400);
  }
  if (!creativeId) return json({ error: "creative_library_id_required" }, 400);
  if (!isPreparationPlatform(platform)) {
    return json({ error: "platform_invalid" }, 422);
  }
  if (lane !== "consumer") return json({ error: "lane_invalid" }, 422);
  const traceId = crypto.randomUUID();
  try {
    assertCreativeCdnConfigured();
  } catch (error) {
    if (error instanceof CreativeTrustError) {
      return json({ error: error.code, trace_id: traceId }, error.status);
    }
    return json(
      { error: "creative_cdn_config_missing", trace_id: traceId },
      503,
    );
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

  const { data: creativeRow, error: creativeError } = await supabase
    .from("ad_creatives")
    .select("*")
    .eq("id", creativeId)
    .maybeSingle();
  if (creativeError) {
    return json({ error: "creative_lookup_failed", trace_id: traceId }, 503);
  }
  if (!creativeRow) {
    return json({ error: "creative_not_found", trace_id: traceId }, 404);
  }
  const creative = creativeRow as unknown as AdCreativeRow;
  if (creative.status !== "active" || creative.kind !== "video") {
    return json(
      { error: "creative_kind_or_status_invalid", trace_id: traceId },
      422,
    );
  }
  if (
    platform === "snapchat" && (creative.duration_seconds ?? Infinity) > 180
  ) {
    return json(
      { error: "snapchat_video_duration_invalid", trace_id: traceId },
      422,
    );
  }

  const { data: beginData, error: beginError } = await supabase.rpc(
    "ad_creative_prepare_begin",
    {
      p_creative_id: creativeId,
      p_platform: platform,
      p_lane: "consumer",
      p_external_account_id: connection.external_account_id,
      p_external_kind: "video",
      p_content_hash: creative.content_hash,
      p_action: action,
      p_trace_id: traceId,
    },
  );
  if (beginError || !Array.isArray(beginData) || !beginData[0]) {
    return json({ error: "prepare_begin_failed", trace_id: traceId }, 500);
  }
  let row = beginData[0] as PrepareBeginRow;

  const audit = async (
    auditAction: string,
    fromStatus: string | null,
    toStatus: string | null,
    providerResponse: Record<string, unknown> | null = null,
  ): Promise<boolean> => {
    const { error } = await supabase.from("ad_status_events").insert({
      creative_ref_id: row.ref_id,
      platform,
      entity: "creative_ref",
      action: auditAction,
      actor: user.id,
      from_status: fromStatus,
      to_status: toStatus,
      external_ids: null,
      provider_response: providerResponse
        ? { ...providerResponse, trace_id: traceId }
        : { trace_id: traceId },
    });
    return !error;
  };

  const reload = async (): Promise<PrepareBeginRow | null> => {
    const { data, error } = await supabase
      .from("ad_creative_platform_refs")
      .select("*")
      .eq("id", row.ref_id)
      .maybeSingle();
    return error || !data ? null : rowFromRef(data);
  };

  const cas = async (
    values: Record<string, unknown>,
    auditAction: string,
    fromStatus: string,
    toStatus: string,
    providerResponse: Record<string, unknown> | null = null,
  ): Promise<"updated" | "stale" | "audit_failed"> => {
    const { data, error } = await supabase
      .from("ad_creative_platform_refs")
      .update(values)
      .eq("id", row.ref_id)
      .eq("attempt_id", row.current_attempt_id)
      .select("*")
      .maybeSingle();
    if (error) return "audit_failed";
    if (!data) {
      const staleAttempt = row.current_attempt_id;
      const canonical = await reload();
      if (!canonical) return "audit_failed";
      row = canonical;
      const audited = await audit(
        "prepare_check",
        fromStatus,
        row.current_status,
        {
          decision: "stale_attempt_reload",
          stale_attempt_id: staleAttempt,
          canonical_attempt_id: row.current_attempt_id,
          canonical_status: row.current_status,
        },
      );
      return audited ? "stale" : "audit_failed";
    }
    row = rowFromRef(data);
    return await audit(auditAction, fromStatus, toStatus, providerResponse)
      ? "updated"
      : "audit_failed";
  };

  if (row.decision === "identity_conflict") {
    return json({ error: "creative_identity_changed", trace_id: traceId }, 409);
  }
  if (row.decision === "action_not_applicable") {
    const code =
      row.current_status === "processing" && !row.current_external_ref
        ? "ref_state_invalid"
        : "action_not_applicable";
    return json({ error: code, trace_id: traceId }, 409);
  }
  if (
    row.decision === "return_not_started" || row.decision === "return_active" ||
    row.decision === "return_ready" || row.decision === "return_terminal"
  ) {
    const cached = row.current_status === "ready" ||
      row.current_status === "failed" ||
      row.current_status === "timed_out";
    const status =
      row.current_status === "uploading" || row.current_status === "processing"
        ? 202
        : 200;
    return json(
      envelope(row, creativeId, platform, traceId, { cached }),
      status,
    );
  }

  const adapter = PREPARE_PROVIDER_ADAPTERS[platform];
  if (row.decision === "initiate") {
    if (
      !await audit("prepare_begin", "pending", "uploading", {
        decision: "initiate",
      })
    ) {
      return json({ error: "audit_write_failed", trace_id: traceId }, 500);
    }
    try {
      const bytes = await verifyCreativeBytes(creative);
      let initiateStopResult: "stale" | "audit_failed" | null = null;
      await adapter.initiate(creative, connection, bytes, {
        saveProviderRef: async (ref, extra = {}) => {
          const result = await cas(
            {
              external_ref: ref,
              external_ref_extra: extra,
              provider_ref_recorded_at: new Date().toISOString(),
              status: "uploading",
              error: null,
              error_code: null,
              retryable: false,
              provider_terminal_attempt_id: null,
              provider_terminal_at: null,
              provider_terminal_code: null,
            },
            "prepare_ref_saved",
            "uploading",
            "uploading",
          );
          if (result !== "updated") initiateStopResult = result;
          return result === "updated";
        },
        mergeProviderExtra: async (extra) => {
          const result = await cas(
            {
              external_ref_extra: {
                ...row.current_external_ref_extra,
                ...extra,
              },
            },
            "prepare_check",
            row.current_status,
            row.current_status,
            { decision: "poster_saved" },
          );
          if (result !== "updated") initiateStopResult = result;
          return result === "updated";
        },
        markProcessing: async () => {
          const result = await cas(
            {
              status: "processing",
              error: null,
              error_code: null,
              retryable: false,
            },
            "prepare_check",
            row.current_status,
            "processing",
            { decision: "upload_complete" },
          );
          if (result !== "updated") initiateStopResult = result;
          return result === "updated";
        },
      });
      if (initiateStopResult) {
        if (initiateStopResult === "audit_failed") {
          return json({ error: "audit_write_failed", trace_id: traceId }, 500);
        }
        const status = row.current_status === "uploading" ||
            row.current_status === "processing"
          ? 202
          : 200;
        return json(envelope(row, creativeId, platform, traceId), status);
      }
      return json(
        envelope(row, creativeId, platform, traceId, {
          retryAfterSeconds: platform === "meta" ? 5 : 10,
        }),
        202,
      );
    } catch (error) {
      if (error instanceof CreativeTrustError) {
        return json({
          error: error.code,
          message: error.message,
          trace_id: traceId,
        }, error.status);
      }
      if (error instanceof ProviderRateLimitError) {
        const retryAfter = error.retryAfterSeconds;
        return json(
          envelope(row, creativeId, platform, traceId, {
            cached: false,
            retryAfterSeconds: retryAfter,
            errorCode: "provider_rate_limited",
            retryable: true,
          }),
          429,
          { "Retry-After": String(retryAfter) },
        );
      }
      // #1288: the user-facing envelope stays generic (provider_init_failed / 502),
      // but the real provider failure was previously never logged, so the live sweep
      // saw only an opaque 502. Surface the machine-readable code + message (for a
      // CreativeUploadError the code lives in `.detail`, NOT `.code`) to the server
      // log only. Prepare-adapter messages carry an HTTP status + scrubbed body —
      // never tokens/bodies/env values (scrubCreativeSecrets already redacted them).
      console.error(
        "[admin-ad-creative-prepare] initiate failed:",
        error instanceof CreativeUploadError
          ? `${error.platform}/${error.detail}: ${error.message}`
          : error instanceof Error
          ? error.message
          : String(error),
      );
      const fromStatus = row.current_status;
      const result = await cas(
        {
          status: "failed",
          last_checked_at: new Date().toISOString(),
          error: "The platform could not accept this video.",
          error_code: "provider_init_failed",
          retryable: true,
          provider_terminal_attempt_id: null,
          provider_terminal_at: null,
          provider_terminal_code: null,
        },
        "prepare_failed",
        fromStatus,
        "failed",
        { decision: "provider_init_failed" },
      );
      if (result === "audit_failed") {
        return json({ error: "audit_write_failed", trace_id: traceId }, 500);
      }
      return json(
        envelope(row, creativeId, platform, traceId, {
          cached: false,
          errorCode: "provider_init_failed",
        }),
        502,
      );
    }
  }

  if (row.decision === "check_existing" && row.current_external_ref) {
    try {
      // Meta can return a stable video id before its independent poster upload
      // finishes. Reconciliation fills only that missing poster; it never
      // creates a replacement video or discards the already-persisted id.
      if (
        platform === "meta" && adapter.resume &&
        typeof row.current_external_ref_extra.thumbnail_image_hash !== "string"
      ) {
        const bytes = await verifyCreativeBytes(creative);
        let resumeStopResult: "stale" | "audit_failed" | null = null;
        await adapter.resume(
          creative,
          connection,
          bytes,
          row.current_external_ref,
          row.current_external_ref_extra,
          {
            saveProviderRef: () => Promise.resolve(true),
            mergeProviderExtra: async (extra) => {
              const result = await cas(
                {
                  external_ref_extra: {
                    ...row.current_external_ref_extra,
                    ...extra,
                  },
                },
                "prepare_check",
                row.current_status,
                row.current_status,
                { decision: "poster_saved" },
              );
              if (result !== "updated") resumeStopResult = result;
              return result === "updated";
            },
            markProcessing: async () => {
              const result = await cas(
                {
                  status: "processing",
                  retryable: false,
                  error: null,
                  error_code: null,
                },
                "prepare_check",
                row.current_status,
                "processing",
                { decision: "poster_resume_complete" },
              );
              if (result !== "updated") resumeStopResult = result;
              return result === "updated";
            },
          },
        );
        if (resumeStopResult) {
          if (resumeStopResult === "audit_failed") {
            return json(
              { error: "audit_write_failed", trace_id: traceId },
              500,
            );
          }
          const status =
            ["uploading", "processing"].includes(row.current_status)
              ? 202
              : 200;
          return json(envelope(row, creativeId, platform, traceId), status);
        }
      }
      const checked = await adapter.check(
        row.current_external_ref,
        row.current_external_ref_extra,
        connection,
      );
      if (checked.state === "ready") {
        const result = await cas(
          {
            status: "ready",
            last_checked_at: new Date().toISOString(),
            uploaded_at: new Date().toISOString(),
            retryable: false,
            error: null,
            error_code: null,
            provider_terminal_attempt_id: null,
            provider_terminal_at: null,
            provider_terminal_code: null,
            // ISSUE-997 D1: a provider whose stable media id is only learned at
            // READY time (Google/YouTube: youtube_video_id, known only once the
            // upload reaches PROCESSED) surfaces it via checked.mergeExtra so the
            // READY ref carries it in external_ref_extra. Providers that record
            // their full extra at initiate (Meta/Snap/TikTok) never set mergeExtra,
            // so this spread is omitted for them and their external_ref_extra is
            // left exactly as persisted at upload — a strict no-op.
            ...(checked.mergeExtra
              ? {
                external_ref_extra: {
                  ...row.current_external_ref_extra,
                  ...checked.mergeExtra,
                },
              }
              : {}),
          },
          "prepare_ready",
          row.current_status,
          "ready",
          { decision: "ready" },
        );
        if (result === "audit_failed") {
          return json({ error: "audit_write_failed", trace_id: traceId }, 500);
        }
        return json(envelope(row, creativeId, platform, traceId, {
          cached: false,
          preview: checked.preview ?? null,
        }));
      }
      if (checked.state === "terminal") {
        const terminalCode = checked.terminalCode ?? "provider_terminal";
        const result = await cas(
          {
            status: "failed",
            last_checked_at: new Date().toISOString(),
            retryable: true,
            error: "The platform could not process this video.",
            error_code: "provider_terminal",
            provider_terminal_attempt_id: row.current_attempt_id,
            provider_terminal_at: new Date().toISOString(),
            provider_terminal_code: terminalCode,
          },
          "prepare_failed",
          row.current_status,
          "failed",
          {
            decision: "provider_terminal",
            terminal_code: terminalCode,
          },
        );
        if (result === "audit_failed") {
          return json({ error: "audit_write_failed", trace_id: traceId }, 500);
        }
        return json(
          envelope(row, creativeId, platform, traceId, {
            cached: false,
            errorCode: "provider_terminal",
          }),
          502,
        );
      }
      const result = await cas(
        {
          status: "processing",
          last_checked_at: new Date().toISOString(),
          retryable: false,
          error: null,
          error_code: null,
          provider_terminal_attempt_id: null,
          provider_terminal_at: null,
          provider_terminal_code: null,
        },
        "prepare_check",
        row.current_status,
        "processing",
        { decision: "processing" },
      );
      if (result === "audit_failed") {
        return json({ error: "audit_write_failed", trace_id: traceId }, 500);
      }
      return json(
        envelope(row, creativeId, platform, traceId, {
          cached: false,
          retryAfterSeconds: checked.retryAfterSeconds ?? 10,
          preview: checked.preview ?? null,
        }),
        202,
      );
    } catch (error) {
      if (error instanceof ProviderRateLimitError) {
        const retryAfter = error.retryAfterSeconds;
        return json(
          envelope(row, creativeId, platform, traceId, {
            cached: false,
            retryAfterSeconds: retryAfter,
            errorCode: "provider_rate_limited",
            retryable: true,
          }),
          429,
          { "Retry-After": String(retryAfter) },
        );
      }
      const deadline = row.current_deadline_at
        ? Date.parse(row.current_deadline_at)
        : NaN;
      if (Number.isFinite(deadline) && Date.now() >= deadline) {
        const result = await cas(
          {
            status: "timed_out",
            last_checked_at: new Date().toISOString(),
            error: "Preparation exceeded its server deadline.",
            error_code: "preparation_deadline_exceeded",
            retryable: true,
            provider_terminal_attempt_id: null,
            provider_terminal_at: null,
            provider_terminal_code: null,
          },
          "prepare_timeout",
          row.current_status,
          "timed_out",
          { decision: "deadline" },
        );
        if (result === "audit_failed") {
          return json({ error: "audit_write_failed", trace_id: traceId }, 500);
        }
        return json(envelope(row, creativeId, platform, traceId));
      }
      const result = await cas(
        {
          last_checked_at: new Date().toISOString(),
          error: "The platform status could not be checked.",
          error_code: "provider_check_transient",
          retryable: true,
          provider_terminal_attempt_id: null,
          provider_terminal_at: null,
          provider_terminal_code: null,
        },
        "prepare_check",
        row.current_status,
        row.current_status,
        { decision: "transient" },
      );
      if (result === "audit_failed") {
        return json({ error: "audit_write_failed", trace_id: traceId }, 500);
      }
      return json(
        envelope(row, creativeId, platform, traceId, {
          cached: false,
          retryAfterSeconds: 10,
          errorCode: "provider_check_transient",
        }),
        503,
        { "Retry-After": "10" },
      );
    }
  }

  return json({ error: "ref_state_invalid", trace_id: traceId }, 409);
});
