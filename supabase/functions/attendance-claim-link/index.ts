import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  attendanceClaimUrls,
  bytesToPostgresHex,
  claimJson,
  hmacOrderClaimDigest,
  mintOrderClaimToken,
  parseAttendanceClaimLinkRequest,
  sha256Digest,
} from "../_shared/attendanceClaim.ts";
import { ticketCorsHeaders } from "../_shared/ticketCheckout.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ticketCorsHeaders });
  }
  const json = (status: number, body: Record<string, unknown>) =>
    claimJson(status, body, ticketCorsHeaders);
  if (req.method !== "POST") {
    return json(400, { ok: false, error: "claim_link_invalid" });
  }
  const body = parseAttendanceClaimLinkRequest(
    await req.json().catch(() => null),
  );
  if (!body) {
    return json(400, { ok: false, error: "claim_link_invalid" });
  }
  const { checkoutSessionId, buyerStatusToken } = body;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const pepper = Deno.env.get("ATTENDANCE_CLAIM_PEPPER");
  if (!url || !key || !pepper) {
    return json(500, { ok: false, error: "claim_link_failed" });
  }
  try {
    const admin = createClient(url, key, { auth: { persistSession: false } });
    const proof = Array.from(await sha256Digest(buyerStatusToken))
      .map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const { data: session } = await admin.from("ticket_checkout_sessions")
      .select("id,event_id,order_id,buyer_status_token_hash,status")
      .eq("id", checkoutSessionId).eq("buyer_status_token_hash", proof)
      .in("status", ["paid_completed", "free_completed"]).maybeSingle();
    if (!session || !session.order_id) {
      return json(404, { ok: false, error: "claim_link_invalid" });
    }
    const { data: allowed, error: rateError } = await admin.rpc(
      "take_attendance_claim_link_attempt",
      { p_session_id: session.id },
    );
    if (rateError) {
      return json(500, { ok: false, error: "claim_link_failed" });
    }
    if (allowed !== true) {
      return json(429, {
        ok: false,
        error: "claim_link_rate_limited",
        retryAfterSeconds: 600,
      });
    }
    const minted = mintOrderClaimToken();
    const digest = await hmacOrderClaimDigest(minted.raw, pepper);
    const { data: issuance, error: issuanceError } = await admin.rpc(
      "issue_order_attendance_claim_proof",
      {
        p_order_id: session.order_id,
        p_event_id: session.event_id,
        p_digest: bytesToPostgresHex(digest),
        p_allow_retry_rotation: true,
      },
    );
    if (issuanceError) {
      return json(500, { ok: false, error: "claim_link_failed" });
    }
    const result = typeof issuance === "object" && issuance !== null &&
        "result" in issuance && typeof issuance.result === "string"
      ? issuance.result
      : "invalid";
    if (result !== "issued") {
      return json(409, { ok: false, error: "claim_link_ineligible" });
    }
    const links = attendanceClaimUrls({
      kind: "order",
      eventId: session.event_id,
      sourceId: session.order_id,
      token: minted.token,
    });
    return json(200, {
      ok: true,
      kind: "order",
      eventId: session.event_id,
      sourceId: session.order_id,
      ...links,
    });
  } catch {
    return json(500, { ok: false, error: "claim_link_failed" });
  }
});
