import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { safeBrandPersonResolution } from "../_shared/brandPeople.ts";

interface IngestRow {
  id: string;
  source_kind: "event_rsvp" | "rsvp_plus_one" | "order" | "ticket_holder";
  source_id: string;
  operation: "upsert" | "retire";
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const bearer = request.headers.get("authorization") ?? "";
  if (
    serviceKey.length === 0 || (bearer !== `Bearer ${serviceKey}` &&
      (cronSecret.length === 0 || bearer !== `Bearer ${cronSecret}`))
  ) {
    return json({ error: "forbidden" }, 403);
  }
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  if (url.length === 0) return json({ error: "service_unavailable" }, 503);
  const client = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
  const { data, error } = await client.rpc("biz_claim_brand_person_ingest", {
    p_limit: 100,
  });
  if (error) return json({ error: "ingest_claim_failed" }, 500);
  const rows = (data ?? []) as IngestRow[];
  const counts = {
    claimed: rows.length,
    linked: 0,
    conflict: 0,
    unlinked: 0,
    retired: 0,
    retryable: 0,
    dead: 0,
    finishUnknown: 0,
  };
  for (const row of rows) {
    try {
      const { data: outcome, error: resolutionError } = await client.rpc(
        "biz_resolve_brand_person_source_derived",
        { p_source_kind: row.source_kind, p_source_id: row.source_id },
      );
      if (resolutionError) throw new Error("resolver_failed");
      const label = safeBrandPersonResolution(outcome).linkOutcome;
      if (label === "linked" || label === "already_linked") counts.linked += 1;
      else if (label === "conflict") counts.conflict += 1;
      else if (label === "retired") counts.retired += 1;
      else counts.unlinked += 1;
      const { error: finishError } = await client.rpc(
        "biz_finish_brand_person_ingest",
        {
          p_id: row.id,
          p_succeeded: true,
          p_safe_error_code: null,
        },
      );
      if (finishError) throw new Error("finish_failed");
    } catch (error) {
      const code = error instanceof Error && error.message === "finish_failed"
        ? "ingest_finish_failed"
        : "ingest_resolver_failed";
      const { error: finishError } = await client.rpc(
        "biz_finish_brand_person_ingest",
        {
          p_id: row.id,
          p_succeeded: false,
          p_safe_error_code: code,
        },
      );
      if (finishError) {
        counts.finishUnknown += 1;
      } else {
        const { data: finished, error: finishedError } = await client.from(
          "brand_person_ingest_outbox",
        ).select("status").eq("id", row.id).single();
        if (finishedError || finished === null) counts.finishUnknown += 1;
        else if (finished.status === "dead") counts.dead += 1;
        else counts.retryable += 1;
      }
    }
  }
  return json(counts);
});
