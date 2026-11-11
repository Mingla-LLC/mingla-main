// #4382 — one-off copy of the beta feedback voice notes and screenshots into
// the private support-attachments bucket.
//
// Plain SQL cannot copy storage objects, so the migration wrote the
// support_attachments rows with their new paths and remembered the source
// (import_source_bucket / import_source_path). This function copies each
// object that is not yet copied, then records its size and import_copied_at.
// It is idempotent: a second run copies nothing and reports the totals.
//
// Run it once after the migrations are applied and this function is
// deployed, with the service-role key (verify_jwt = false; checked here):
//   curl -sS -X POST "$SUPABASE_URL/functions/v1/support-beta-feedback-import" \
//     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -d '{}'
// The response must show pending = 0 before the retire migration in
// scripts/deferred-migrations is moved into supabase/migrations.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";

const TARGET = "support-attachments";

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

  const { data: rows, error } = await admin
    .from("support_attachments")
    .select("id, storage_path, mime, import_source_bucket, import_source_path")
    .not("import_source_path", "is", null)
    .is("import_copied_at", null)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) return response(500, { code: "READ_FAILED" });

  let copied = 0;
  const failures: { id: string; reason: string }[] = [];
  for (const row of rows ?? []) {
    const id = row.id as string;
    try {
      const { data: blob, error: downloadError } = await admin.storage
        .from(row.import_source_bucket as string)
        .download(row.import_source_path as string);
      if (downloadError || !blob) throw new Error("source_missing");
      const bytes = blob.size;
      if (!Number.isInteger(bytes) || bytes < 1) {
        throw new Error("source_empty");
      }
      const { error: uploadError } = await admin.storage.from(TARGET).upload(
        row.storage_path as string,
        blob,
        { contentType: row.mime as string, upsert: true },
      );
      if (uploadError) throw new Error("upload_failed");
      const { data: marked, error: markError } = await admin.rpc(
        "issue_4382_mark_attachment_imported",
        { p_attachment_id: id, p_bytes: bytes },
      );
      if (markError || marked !== true) throw new Error("mark_failed");
      copied += 1;
    } catch (err) {
      failures.push({
        id,
        reason: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  const { count: pending } = await admin
    .from("support_attachments")
    .select("id", { count: "exact", head: true })
    .not("import_source_path", "is", null)
    .is("import_copied_at", null);
  const { count: done } = await admin
    .from("support_attachments")
    .select("id", { count: "exact", head: true })
    .not("import_copied_at", "is", null);

  console.log(JSON.stringify({
    event: "support_beta_feedback_import_run",
    copied,
    failed: failures.length,
    pending: pending ?? null,
    copied_total: done ?? null,
  }));
  return response(failures.length > 0 ? 502 : 200, {
    ok: failures.length === 0,
    copied,
    failed: failures,
    pending: pending ?? null,
    copied_total: done ?? null,
  });
});
