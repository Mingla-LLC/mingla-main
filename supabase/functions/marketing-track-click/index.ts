// ORCH-0815-B — Public click-tracking redirect for marketing emails.
//
// Mounted at `/m/{tracking_id}` (buyer's email client GET on tap). Looks
// up the click row, marks first-click + bumps message click_count,
// appends UTM params to the destination URL, and 302-redirects.
//
// verify_jwt: false — public, anonymous, authenticated by the opaque
// UUID-shaped tracking_id (existence in DB = authorisation).
//
// Cross-references:
//   - SPEC: Mingla_Artifacts/specs/SPEC_ORCH-0815_B_COMPOSER_AND_SEND.md §7.2
//   - Marketing-send writes the marketing_clicks rows that this function
//     reads. See supabase/functions/marketing-send/index.ts sendEmail().

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { serviceClient, ticketCorsHeaders } from "../_shared/ticketCheckout.ts";
import { TRACKING_ID_RE } from "../_shared/marketingTokens.ts";

const FALLBACK_URL = "https://mingla.app";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ticketCorsHeaders });
  }
  if (req.method !== "GET") {
    return jsonError("method_not_allowed", 405);
  }

  // Path shape — Supabase Functions strips the /functions/v1/<name>
  // prefix server-side; the remaining pathname is the param.
  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter((s) => s.length > 0);
  const trackingId = segments[segments.length - 1] ?? "";

  if (!TRACKING_ID_RE.test(trackingId)) {
    return jsonError("invalid_tracking_id", 400);
  }

  const supabase = serviceClient();

  // Single round-trip — pull the click row + the related message id.
  const { data: clickRow, error: clickErr } = await supabase
    .from("marketing_clicks")
    .select(
      "id, campaign_id, message_id, destination_url, clicked_at",
    )
    .eq("tracking_id", trackingId)
    .maybeSingle();

  if (clickErr) {
    console.error(
      `[marketing-track-click] query failed for ${trackingId}`,
      clickErr.message,
    );
    // Don't bounce — emails should never feel broken. Redirect to home.
    return redirect(FALLBACK_URL);
  }
  if (clickRow === null) {
    return redirect(FALLBACK_URL);
  }

  // First-click capture: only set clicked_at if it was null.
  const isFirstClick = clickRow.clicked_at === null;
  const nowIso = new Date().toISOString();

  const userAgent = req.headers.get("user-agent") ?? null;
  const fwdFor = req.headers.get("x-forwarded-for") ?? "";
  const ipHash = fwdFor.length > 0 ? await sha256Hex(fwdFor) : null;

  // Update click row.
  await supabase
    .from("marketing_clicks")
    .update({
      ...(isFirstClick ? { clicked_at: nowIso } : {}),
      user_agent: userAgent,
      ip_hash: ipHash,
    })
    .eq("id", clickRow.id);

  // Bump the message's click_count + last_clicked_at unless message is
  // missing (defensive — message_id is nullable on the table). Also read the
  // channel so the UTM medium is honest for SMS vs email (META-ORCH-1161 §6.7).
  let messageChannel = "email";
  if (clickRow.message_id !== null) {
    const { data: msgRow, error: msgErr } = await supabase
      .from("marketing_messages")
      .select("click_count, status, channel")
      .eq("id", clickRow.message_id)
      .maybeSingle();
    if (!msgErr && msgRow !== null && typeof msgRow.channel === "string") {
      messageChannel = msgRow.channel;
    }
    if (!msgErr && msgRow !== null) {
      const nextStatus = msgRow.status === "sent" || msgRow.status === "delivered"
        ? "clicked"
        : msgRow.status;
      await supabase
        .from("marketing_messages")
        .update({
          click_count: (msgRow.click_count ?? 0) + 1,
          last_clicked_at: nowIso,
          status: nextStatus,
        })
        .eq("id", clickRow.message_id);
    }
  }

  // Compose destination URL with UTM params (overwrite any existing
  // utm_* on the destination — campaign-attributable always wins).
  let destination: URL;
  try {
    destination = new URL(clickRow.destination_url);
  } catch (_err) {
    return redirect(FALLBACK_URL);
  }
  destination.searchParams.set("utm_source", "mingla");
  // META-ORCH-1161 §6.7 — honest channel attribution (sms vs email).
  destination.searchParams.set("utm_medium", messageChannel === "sms" ? "sms" : "email");
  destination.searchParams.set("utm_campaign", clickRow.campaign_id);
  destination.searchParams.set("utm_content", clickRow.id);

  return redirect(destination.toString());
});

function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      ...ticketCorsHeaders,
      "Location": location,
      "Cache-Control": "no-store",
    },
  });
}

function jsonError(code: string, status: number): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { ...ticketCorsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
