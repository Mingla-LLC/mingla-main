import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const headers = {
  ...corsHeaders,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "content-type": "application/json",
  "cache-control": "no-store",
};
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

export async function handler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST" && request.method !== "GET") {
    return json({ error: "method_not_allowed" }, 405);
  }
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const auth = request.headers.get("authorization") ?? "";
  if (
    url.length === 0 || anonKey.length === 0 || serviceKey.length === 0 ||
    !auth.startsWith("Bearer ")
  ) return json({ error: "unauthorized" }, 401);
  const user = createClient(url, anonKey, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const service = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
  const { data: actor, error: actorError } = await user.auth.getUser();
  if (actorError || actor.user === null) {
    return json({ error: "unauthorized" }, 401);
  }

  if (request.method === "GET") {
    const jobId = new URL(request.url).searchParams.get("jobId");
    if (jobId === null) return json({ error: "job_id_required" }, 400);
    const { data, error } = await user.rpc("biz_get_brand_people_export_job", {
      p_job_id: jobId,
    });
    if (error) return json({ error: "forbidden" }, 403);
    const job = data as {
      jobId: string;
      status: string;
      result: { fileName: string; expiresAt: string } | null;
      safeErrorCode: string | null;
    };
    if (job.result === null) {
      return json({
        jobId: job.jobId,
        status: job.status,
        result: null,
        safeErrorCode: job.safeErrorCode,
      });
    }
    const { data: storagePath, error: storageError } = await service.rpc(
      "biz_get_brand_people_export_storage",
      { p_job_id: job.jobId },
    );
    if (storageError || typeof storagePath !== "string") {
      return json({ error: "export_storage_unavailable" }, 500);
    }
    const { data: signed, error: signedError } = await service.storage.from(
      "brand-people-exports",
    ).createSignedUrl(storagePath, 60);
    if (signedError || signed === null) {
      return json({ error: "signed_url_failed" }, 500);
    }
    return json({
      jobId: job.jobId,
      status: job.status,
      result: job.result,
      signedUrl: signed.signedUrl,
      signedUrlExpiresInSeconds: 60,
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (typeof body !== "object" || body === null) {
    return json({ error: "invalid_request" }, 400);
  }
  const input = body as Record<string, unknown>;
  if (input.operation === "status") {
    if (typeof input.jobId !== "string") return json({ error: "job_id_required" }, 400);
    const { data, error } = await user.rpc("biz_get_brand_people_export_job", { p_job_id: input.jobId });
    if (error) return json({ error: "forbidden" }, 403);
    const job = data as { jobId: string; status: string; result: { fileName: string; expiresAt: string } | null; safeErrorCode: string | null };
    if (job.result === null) return json(job as unknown as Record<string, unknown>);
    const { data: storagePath, error: storageError } = await service.rpc("biz_get_brand_people_export_storage", { p_job_id: job.jobId });
    if (storageError || typeof storagePath !== "string") return json({ error: "export_storage_unavailable" }, 500);
    const { data: signed, error: signedError } = await service.storage.from("brand-people-exports").createSignedUrl(storagePath, 60);
    if (signedError || signed === null) return json({ error: "signed_url_failed" }, 500);
    return json({ ...job, signedUrl: signed.signedUrl, signedUrlExpiresInSeconds: 60 });
  }
  const { data: jobData, error: jobError } = await user.rpc(
    "biz_export_brand_people",
    {
      p_scope: input.scope,
      p_event_id: input.eventId ?? null,
      p_filter: input.filter ?? "all",
      p_search: input.search ?? null,
      p_sort: input.sort ?? "action_priority",
      p_filter_snapshot: input.filterSnapshot ?? {},
      p_client_request_id: input.clientRequestId,
    },
  );
  if (jobError) {
    return json({
      error: jobError.message.includes("forbidden")
        ? "forbidden"
        : "export_request_invalid",
    }, jobError.message.includes("forbidden") ? 403 : 400);
  }
  return json(jobData as Record<string, unknown>, 202);
}

if (import.meta.main) serve(handler);
