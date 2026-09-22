// Issue #3429 — service-only bounded deletion worker for private Ari objects.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import { ARI_ATTACHMENT_BUCKET } from "../_shared/agentAttachments.ts";
import {
  reclaimExpiredAriAttachments,
  sweepStaleAriAttachmentProcessing,
} from "../_shared/agentAttachmentFinalize.ts";

function response(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function errorDigest(error: unknown): Promise<string> {
  const category = error instanceof Error ? error.name : "unknown";
  const bytes = new TextEncoder().encode(`ari-attachment-cleanup:${category}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest).map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return response(405, { code: "METHOD_NOT_ALLOWED" });
  }
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = request.headers.get("Authorization") ?? "";
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return response(401, { code: "UNAUTHENTICATED" });
  }
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  if (!url) return response(500, { code: "INTERNAL" });
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 10 * 60_000).toISOString();

  // REWORK-1 backstop: no attachment may stay `processing` past its 60-second
  // lease once this worker has observed it, even if no client ever asks.
  let interruptedCount = 0;
  try {
    interruptedCount = await sweepStaleAriAttachmentProcessing({
      admin,
      nowMs: now.getTime(),
    });
  } catch {
    return response(500, { code: "PROCESSING_SWEEP_FAILED" });
  }

  // Deleting abandoned metadata invokes the migration trigger, which queues
  // original and derivative opaque paths before the row disappears. REWORK-2
  // R-1: the reclaimed state list — `ready` included — lives with the rest of
  // the attachment lifecycle in `agentAttachmentFinalize.ts`, so the states
  // this worker reclaims and the states the duplicate check reads can never
  // drift apart again.
  try {
    await reclaimExpiredAriAttachments({ admin, nowMs: now.getTime() });
  } catch {
    return response(500, { code: "ABANDONED_RECLAIM_FAILED" });
  }

  const { data: jobs, error: jobError } = await admin
    .from("agent_attachment_cleanup_jobs")
    .select("id,storage_path,attempt_count,created_at")
    .is("completed_at", null)
    .lte("run_after", now.toISOString())
    .or(`locked_at.is.null,locked_at.lt.${staleBefore}`)
    .order("created_at", { ascending: true })
    .limit(50);
  if (jobError) return response(500, { code: "QUEUE_UNAVAILABLE" });

  let completed = 0;
  let failed = 0;
  for (const job of jobs ?? []) {
    const lockedAt = new Date().toISOString();
    const { data: locked } = await admin.from("agent_attachment_cleanup_jobs")
      .update({ locked_at: lockedAt, updated_at: lockedAt })
      .eq("id", job.id)
      .is("completed_at", null)
      .or(`locked_at.is.null,locked_at.lt.${staleBefore}`)
      .select("id")
      .maybeSingle();
    if (!locked) continue;
    try {
      const { error } = await admin.storage.from(ARI_ATTACHMENT_BUCKET).remove([
        job.storage_path,
      ]);
      if (error) throw error;
      const finishedAt = new Date().toISOString();
      await admin.from("agent_attachment_cleanup_jobs").update({
        completed_at: finishedAt,
        locked_at: null,
        last_error_digest: null,
        updated_at: finishedAt,
      }).eq("id", job.id).eq("locked_at", lockedAt);
      completed += 1;
    } catch (error: unknown) {
      const attempts = Number(job.attempt_count ?? 0) + 1;
      const delayMinutes = Math.min(12 * 60, 2 ** Math.min(attempts, 9));
      await admin.from("agent_attachment_cleanup_jobs").update({
        attempt_count: attempts,
        run_after: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
        locked_at: null,
        last_error_digest: await errorDigest(error),
        updated_at: new Date().toISOString(),
      }).eq("id", job.id).eq("locked_at", lockedAt);
      failed += 1;
    }
  }

  await admin.from("agent_activity_events").delete().lt(
    "expires_at",
    now.toISOString(),
  );
  await admin.from("agent_turn_claim_guards").delete().lt(
    "expires_at",
    now.toISOString(),
  );

  const { count: alertCount } = await admin.from(
    "agent_attachment_cleanup_jobs",
  )
    .select("id", { count: "exact", head: true })
    .is("completed_at", null)
    .or(
      `created_at.lt.${
        new Date(now.getTime() - 24 * 60 * 60_000).toISOString()
      },attempt_count.gte.5`,
    );
  if ((alertCount ?? 0) > 0) {
    console.error(JSON.stringify({
      event: "ari_attachment_cleanup_alert",
      overdue_or_repeated_count: alertCount,
    }));
  }
  console.log(JSON.stringify({
    event: "ari_attachment_cleanup_run",
    interrupted_processing_count: interruptedCount,
    selected_count: jobs?.length ?? 0,
    completed_count: completed,
    failed_count: failed,
  }));
  return response(200, {
    interrupted_processing_count: interruptedCount,
    selected_count: jobs?.length ?? 0,
    completed_count: completed,
    failed_count: failed,
    alert_count: alertCount ?? 0,
  });
});
