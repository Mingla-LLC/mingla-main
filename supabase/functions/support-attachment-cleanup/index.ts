// #4382 — daily clean-up of support uploads that were never sent.
//
// Called by the pg_cron job issue_4382_support_attachment_cleanup with the
// service-role bearer (verify_jwt = false; the bearer is checked here). Rows
// with no message after 24 hours are claimed (purge_started_at), their
// objects removed from the private support-attachments bucket, and only then
// the rows deleted. A claimed row cannot be attached by support-send, so a
// late send can never point at a deleted file. A failed removal leaves the
// claim in place; the next run (after an hour) tries again.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";

const BUCKET = "support-attachments";

function response(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

  let removed = 0;
  let deleted = 0;
  let failed = 0;
  for (let round = 0; round < 5; round += 1) {
    const { data: claimed, error: claimError } = await admin.rpc(
      "issue_4382_claim_stale_support_attachments",
      { p_limit: 200 },
    );
    if (claimError) {
      console.error(JSON.stringify({ event: "support_attachment_cleanup_claim_failed", code: claimError.code ?? null }));
      return response(500, { code: "CLAIM_FAILED" });
    }
    const rows = (claimed ?? []) as { attachment_id: string; storage_path: string }[];
    if (rows.length === 0) break;

    const { error: removeError } = await admin.storage.from(BUCKET).remove(
      rows.map((row) => row.storage_path),
    );
    if (removeError) {
      failed += rows.length;
      console.error(JSON.stringify({
        event: "support_attachment_cleanup_remove_failed",
        count: rows.length,
        message: removeError.message,
      }));
      break;
    }
    removed += rows.length;
    const { data: finished, error: finishError } = await admin.rpc(
      "issue_4382_finish_stale_support_attachments",
      { p_attachment_ids: rows.map((row) => row.attachment_id) },
    );
    if (finishError) {
      console.error(JSON.stringify({ event: "support_attachment_cleanup_finish_failed", code: finishError.code ?? null }));
      return response(500, { code: "FINISH_FAILED", removed });
    }
    deleted += typeof finished === "number" ? finished : 0;
    if (rows.length < 200) break;
  }

  console.log(JSON.stringify({
    event: "support_attachment_cleanup_run",
    removed_objects: removed,
    deleted_rows: deleted,
    failed_objects: failed,
  }));
  return response(failed > 0 ? 502 : 200, { ok: failed === 0, removed, deleted, failed });
});
