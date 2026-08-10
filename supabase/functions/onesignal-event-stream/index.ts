import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveAppCredentials } from "../_shared/push-utils.ts";
import {
  readOneSignalEventStreamTokenRing,
  verifyOneSignalEventStreamBearer,
} from "../_shared/oneSignalEventStreamAuth.ts";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EVENT_KIND = /^message\.push\.[a-z_]{1,40}$/;
const MAX_BODY = 8192;
const empty = (status: number) =>
  new Response(null, { status, headers: { "cache-control": "no-store" } });

export interface EventStreamDependencies {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: unknown }>;
}

export function createOneSignalEventStreamHandler(
  dependencies?: EventStreamDependencies,
) {
  return async (request: Request): Promise<Response> => {
    let ring;
    try {
      ring = readOneSignalEventStreamTokenRing();
    } catch {
      return empty(503);
    }
    if (
      !verifyOneSignalEventStreamBearer(
        request.headers.get("authorization"),
        ring,
      )
    ) return empty(401);
    if (request.method !== "POST") return empty(405);
    if (
      !(request.headers.get("content-type") ?? "").toLowerCase().startsWith(
        "application/json",
      )
    ) return empty(415);
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BODY) return empty(413);
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await request.arrayBuffer());
    } catch {
      return empty(400);
    }
    if (bytes.length > MAX_BODY) return empty(413);
    let value: unknown;
    try {
      value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      return empty(400);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return empty(400);
    }
    const body = value as Record<string, unknown>;
    const category = body.categoryKey;
    if (
      typeof category !== "string" ||
      new TextEncoder().encode(category).length > 64
    ) return empty(400);
    if (category.trim() === "" || category !== "offering_invitation") {
      return empty(204);
    }
    if (
      body.schemaVersion !== 1 || typeof body.eventKind !== "string" ||
      !EVENT_KIND.test(body.eventKind) ||
      typeof body.occurredAt !== "string" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(
        body.occurredAt,
      ) || !Number.isFinite(Date.parse(body.occurredAt)) ||
      ![
        body.eventId,
        body.appId,
        body.messageId,
        body.externalId,
        body.attemptId,
      ].every((item) => typeof item === "string" && UUID.test(item))
    ) return empty(400);
    const { appId } = resolveAppCredentials("consumer");
    if (!UUID.test(appId)) return empty(503);
    if (body.appId !== appId) return empty(204);
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if ((!url || !key) && !dependencies) return empty(503);
    const client = dependencies ??
      createClient(url, key, { auth: { persistSession: false } });
    const { error } = await client.rpc("biz_reconcile_offering_push_event", {
      p_event_id: body.eventId,
      p_event_kind: body.eventKind,
      p_occurred_at: body.occurredAt,
      p_provider_app_id: body.appId,
      p_provider_message_id: body.messageId,
      p_external_id: body.externalId,
      p_attempt_id: body.attemptId,
    });
    if (error) return empty(503);
    return empty(204);
  };
}

if (import.meta.main) serve(createOneSignalEventStreamHandler());
