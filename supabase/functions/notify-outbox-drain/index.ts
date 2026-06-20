// META-ORCH-1161 Sub-A — notify-outbox-drain.
//
// The 1-min cron (20261110000003_orch_1161_outbox_drain_cron.sql) POSTs here.
// Claims pending notification_outbox rows and forwards each to notify-dispatch v2
// with the {category_key,...} contract. Service-role only.
//
// verify_jwt=false (config.toml): invoked by pg_cron with the service-role bearer.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const BATCH_LIMIT = 25;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "missing_authorization" }, 401);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: "server_misconfigured" }, 500);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Claim a batch of pending rows (best-effort; the unique idempotency_key on the
  // outbox + the notifications UNIQUE(idempotency_key) make a double-process a
  // no-op duplicate downstream).
  const { data: rows, error: claimErr } = await admin
    .from("notification_outbox")
    .select("id, category_key, user_id, contact, brand_id, payload, idempotency_key, country_code, attempts")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (claimErr) {
    console.error("[notify-outbox-drain] claim failed:", claimErr.message);
    return json({ error: "claim_failed" }, 500);
  }
  if (!rows || rows.length === 0) {
    return json({ ok: true, processed: 0 });
  }

  let processed = 0;
  let failed = 0;

  for (const row of rows as Array<Record<string, unknown>>) {
    const id = row.id as string;
    // Mark processing to avoid an overlapping cron re-claiming the same row.
    await admin.from("notification_outbox").update({ status: "processing" }).eq("id", id);

    // Resolve the brand display name for the copy (sender identity).
    let brandName = "Mingla";
    if (row.brand_id) {
      const { data: brand } = await admin
        .from("brands")
        .select("name")
        .eq("id", row.brand_id)
        .maybeSingle();
      if (brand?.name && typeof brand.name === "string") brandName = brand.name;
    }

    const payload = {
      ...((row.payload as Record<string, unknown>) ?? {}),
      brand_name: brandName,
    };

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/notify-dispatch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({
          category_key: row.category_key,
          user_id: row.user_id ?? null,
          contact: row.contact ?? null,
          payload,
          idempotency_key: row.idempotency_key,
          country_code: row.country_code ?? null,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`notify-dispatch ${res.status}: ${text}`);
      }
      await admin
        .from("notification_outbox")
        .update({ status: "done", processed_at: new Date().toISOString() })
        .eq("id", id);
      processed++;
    } catch (err) {
      failed++;
      const attempts = ((row.attempts as number) ?? 0) + 1;
      // Re-queue (pending) unless we've exhausted attempts → failed (no silent drop).
      await admin
        .from("notification_outbox")
        .update({
          status: attempts >= 3 ? "failed" : "pending",
          attempts,
          last_error: err instanceof Error ? err.message : String(err),
        })
        .eq("id", id);
      console.error("[notify-outbox-drain] dispatch failed for", id, err);
    }
  }

  return json({ ok: true, processed, failed });
});
