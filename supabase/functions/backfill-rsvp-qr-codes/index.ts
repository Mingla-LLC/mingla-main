/**
 * ORCH-1203 GAP-C1 — backfill-rsvp-qr-codes
 *
 * Every-15-min cron-driven guarantee: any `going` RSVP (primary in event_rsvps +
 * guests in event_rsvp_guests) left with qr_code=NULL — e.g. submitted while the
 * QR pepper was transiently missing — gets a signed, scan-valid qr minted AND
 * exactly one QR-bearing rsvp_pass delivered, once the pepper is restored.
 *
 * Flow:
 *   1. Resolve the pepper from env (qrTokenPepper()) — the same source the inline
 *      submit path uses. ORCH-0777 removed the DB GUC, so the pepper lives ONLY
 *      here; we PASS it into the backfill RPC.
 *   2. Call public.backfill_going_rsvp_qr_codes(pepper) — mints the qr via the
 *      SHARED biz_rsvp_mint_qr routine (I-4) and enqueues one rsvp_pass per
 *      newly-minted row. ORCH-1206 (I-3): the enqueue now uses the CANONICAL
 *      key `rsvp_pass:<rsvpId>:<guestId|primary>` (the same key submit + approve
 *      use) so no recipient is ever double-sent across the lifecycle. The
 *      backfill also only touches going+APPROVED rows (never pending).
 *   3. Drain: invoke rsvp-notify once per still-pending rsvp_pass row —
 *      rsvp_notifications has no standalone cron drainer, so we trigger sends
 *      the same per-row way the inline dispatcher does. Already-sent rows
 *      short-circuit inside rsvp-notify.
 *
 * verify_jwt=false (config.toml) — guarded here by a service-role Bearer match
 * (the cron presents the service-role key). NOT a public route.
 *
 * If the pepper is missing the RPC no-ops (returns 0) and nothing is drained —
 * the C-1 ops alert in public-submit-rsvp is what flags the misconfig.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { qrTokenPepper } from "../_shared/ticketCheckout.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.error("[backfill-rsvp-qr-codes] missing SUPABASE_URL / service key");
    return json(500, { error: "server_misconfigured" });
  }

  // Service-role Bearer guard (verify_jwt=false; the cron presents the key).
  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${serviceKey}`) {
    return json(401, { error: "unauthorized" });
  }

  // 1. Resolve the pepper (env-only). Missing → RPC no-ops; nothing to drain.
  let pepper: string | null = null;
  try {
    pepper = qrTokenPepper();
  } catch (err) {
    console.warn(
      "[backfill-rsvp-qr-codes] qr_token_pepper unavailable — backfill no-op",
      String(err),
    );
    pepper = null;
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // 2. Mint + enqueue (idempotent; only NULL-qr going rows touched).
  let minted = 0;
  try {
    const { data, error } = await admin.rpc("backfill_going_rsvp_qr_codes", {
      p_qr_token_pepper: pepper,
    });
    if (error) {
      console.error("[backfill-rsvp-qr-codes] rpc error", error.message);
      return json(500, { error: "backfill_failed" });
    }
    minted = typeof data === "number" ? data : 0;
  } catch (err) {
    console.error("[backfill-rsvp-qr-codes] rpc threw", String(err));
    return json(500, { error: "backfill_failed" });
  }

  // 3. Drain: invoke rsvp-notify per still-pending QR rsvp_pass row.
  //    ORCH-1206 (I-3) — the backfill now enqueues under the CANONICAL keyspace
  //    `rsvp_pass:<rsvpId>:<guestId|primary>` (the same key the submit + approve
  //    paths use), so the old ORCH-1203 backfill-only prefix filter would miss every
  //    backfilled/approved pass. Drain ALL still-pending rsvp_pass rows instead
  //    (template_key='rsvp_pass' + status='pending'). The status='pending' guard
  //    already excludes already-sent rows, and rsvp-notify short-circuits any
  //    row that flipped to 'sent' between this query and the invoke — so we
  //    never double-invoke a sent pass. Cap the batch so a tick stays bounded.
  let drained = 0;
  let drainFailed = 0;
  try {
    const { data: pendingRows } = await admin
      .from("rsvp_notifications")
      .select("id")
      .eq("template_key", "rsvp_pass")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(200);

    for (const row of (pendingRows ?? []) as Array<{ id: string }>) {
      try {
        await admin.functions.invoke("rsvp-notify", {
          body: { notificationId: row.id },
        });
        drained += 1;
      } catch (invokeErr) {
        // Row stays pending for the next 15-min tick; non-fatal.
        drainFailed += 1;
        console.warn(
          "[backfill-rsvp-qr-codes] rsvp-notify invoke failed",
          String(invokeErr),
        );
      }
    }
  } catch (err) {
    console.warn("[backfill-rsvp-qr-codes] drain query failed", String(err));
  }

  console.info("[backfill-rsvp-qr-codes] tick complete", {
    pepperPresent: pepper !== null,
    minted,
    drained,
    drainFailed,
  });

  return json(200, {
    ok: true,
    pepperPresent: pepper !== null,
    minted,
    drained,
    drainFailed,
  });
});
