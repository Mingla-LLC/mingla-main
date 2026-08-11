import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { handler as offeringDispatch } from "../offering-invite-dispatch/index.ts";

type Channel = "email" | "push" | "sms";
type PreviewBody = {
  operation: "preview";
  eventId: string;
  action: "reminder" | "retry_delivery";
  rosterKeys: string[];
  channels: Channel[];
};
type ExecuteBody = {
  operation: "execute";
  previewId: string;
  clientRequestId: string;
};
type Body = PreviewBody | ExecuteBody;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const cors = { ...corsHeaders, "content-type": "application/json", "cache-control": "no-store" };

const json = (body: Record<string, unknown>, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: cors });

function isBody(value: unknown): value is Body {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  if (body.operation === "preview") {
    const channels = body.channels;
    const rosterKeys = body.rosterKeys;
    return Object.keys(body).every((key) => ["operation", "eventId", "action", "rosterKeys", "channels"].includes(key)) &&
      typeof body.eventId === "string" && UUID.test(body.eventId) &&
      (body.action === "reminder" || body.action === "retry_delivery") &&
      Array.isArray(rosterKeys) && rosterKeys.length >= 1 && rosterKeys.length <= 500 &&
      rosterKeys.every((key) => typeof key === "string" && key.length >= 1 && key.length <= 100) &&
      new Set(rosterKeys).size === rosterKeys.length &&
      Array.isArray(channels) && channels.length >= 1 && channels.length <= 3 &&
      channels.every((channel) => channel === "email" || channel === "sms" || channel === "push") &&
      new Set(channels).size === channels.length;
  }
  if (body.operation === "execute") {
    return Object.keys(body).every((key) => ["operation", "previewId", "clientRequestId"].includes(key)) &&
      typeof body.previewId === "string" && UUID.test(body.previewId) &&
      typeof body.clientRequestId === "string" && UUID.test(body.clientRequestId);
  }
  return false;
}

async function parseDispatch(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { error: "offering_dispatch_invalid_response" };
}

export async function handler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ ok: false, code: "method_not_allowed" }, 405);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 262_144) return json({ ok: false, code: "request_too_large" }, 413);
  let untrusted: unknown;
  try { untrusted = JSON.parse(text); } catch { return json({ ok: false, code: "invalid_json" }, 400); }
  if (!isBody(untrusted)) return json({ ok: false, code: "invalid_request" }, 400);
  const body = untrusted;
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  if (!url || !anonKey || !serviceKey || !authorization.startsWith("Bearer ")) {
    return json({ ok: false, code: "unauthorized" }, 401);
  }
  const user = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const service = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: actorData, error: actorError } = await user.auth.getUser();
  if (actorError || actorData.user === null) return json({ ok: false, code: "unauthorized" }, 401);
  const actorId = actorData.user.id;

  if (body.operation === "preview") {
    const channels = [...body.channels].sort() as Channel[];
    const rosterKeys = [...body.rosterKeys].sort();
    const { data: resolved, error: resolveError } = await service.rpc("biz_guest_roster_resolve_action", {
      p_actor_id: actorId, p_event_id: body.eventId, p_action: body.action,
      p_roster_keys: rosterKeys, p_channels: channels,
    });
    if (resolveError || resolved === null) {
      const forbidden = resolveError?.message.includes("forbidden") ?? false;
      const changed = resolveError?.message.includes("status_changed") ?? false;
      return json({ ok: false, code: forbidden ? "forbidden" : changed ? "status_changed" : "preview_invalid" }, forbidden ? 403 : 409);
    }
    const resolution = resolved as { selection: Record<string, unknown>; selectedCount: number };
    const dispatchResponse = await offeringDispatch(new Request("https://internal/offering-invite-dispatch", {
      method: "POST",
      headers: { authorization, "content-type": "application/json", "x-mingla-internal-service-key": serviceKey },
      body: JSON.stringify({ eventId: body.eventId, purpose: body.action, selection: resolution.selection,
        channels, clientRequestId: crypto.randomUUID(), mode: "preview" }),
    }));
    const preview = await parseDispatch(dispatchResponse);
    if (!dispatchResponse.ok) return json({ ok: false, code: preview.error ?? "preview_failed" }, dispatchResponse.status);
    const { data: previewId, error: storeError } = await service.rpc("biz_guest_roster_store_preview", {
      p_actor_id: actorId, p_event_id: body.eventId, p_action: body.action,
      p_selection: resolution.selection, p_channels: channels, p_selected_count: resolution.selectedCount,
      p_quote_hash: preview.quoteHash,
      p_estimated_cost_minor: preview.estimatedCostMinor, p_currency: preview.currency,
    });
    if (storeError || typeof previewId !== "string") return json({ ok: false, code: "preview_persistence_failed" }, 500);
    return json({ ok: true, previewId, expiresInSeconds: 300, selectedCount: resolution.selectedCount,
      eligibleCount: preview.eligibleCount, reachableCount: preview.reachableCount,
      suppressedCount: preview.suppressedCount, skippedCount: preview.skippedCount,
      skipReasonCounts: preview.skipReasonCounts, perChannelReachable: preview.perChannelReachable,
      smsSegments: preview.smsSegments, estimatedCostMinor: preview.estimatedCostMinor,
      currency: preview.currency, lastContactAt: preview.lastContactAt });
  }

  const { data: stored, error: previewError } = await service.rpc("biz_guest_roster_get_preview", {
    p_actor_id: actorId, p_preview_id: body.previewId, p_client_request_id: body.clientRequestId,
  });
  if (previewError || stored === null) {
    const forbidden = previewError?.message.includes("forbidden") ?? false;
    const expired = previewError?.message.includes("expired") ?? false;
    return json({ ok: false, code: forbidden ? "forbidden" : expired ? "preview_expired" : "preview_invalid" }, forbidden ? 403 : 409);
  }
  const preview = stored as { eventId: string; action: string; selection: Record<string, unknown>; channels: Channel[];
    quoteHash: string; estimatedCostMinor: number; currency: string | null };
  const dispatchResponse = await offeringDispatch(new Request("https://internal/offering-invite-dispatch", {
    method: "POST",
    headers: { authorization, "content-type": "application/json", "x-mingla-internal-service-key": serviceKey },
    body: JSON.stringify({ eventId: preview.eventId, purpose: preview.action, selection: preview.selection,
      channels: preview.channels, clientRequestId: body.clientRequestId, mode: "confirm",
      quoteHash: preview.quoteHash, expectedCostMinor: preview.estimatedCostMinor, currency: preview.currency }),
  }));
  const result = await parseDispatch(dispatchResponse);
  if (!dispatchResponse.ok) return json({ ok: false, code: result.error ?? "execute_failed", providerIo: result.providerIo ?? false }, dispatchResponse.status);
  const { error: consumeError } = await service.rpc("biz_guest_roster_consume_preview", {
    p_actor_id: actorId, p_preview_id: body.previewId, p_client_request_id: body.clientRequestId,
  });
  if (consumeError) return json({ ok: false, code: "preview_consume_failed", providerIo: result.providerIo ?? false }, 502);
  return json({ ok: true, status: "queued", groupId: result.groupId, selectedCount: result.selectedCount,
    reachableCount: result.reachableCount, suppressedCount: result.suppressedCount,
    estimatedCostMinor: result.estimatedCostMinor, currency: result.currency, replayed: result.replayed ?? false });
}

if (import.meta.main) serve(handler);
