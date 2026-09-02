/**
 * attendance-claim-identity — issue #2217.
 *
 * Reconnects a paid guest order to the account that just signed in, when the
 * app was installed AFTER checkout and the #871 claim token could not survive
 * the install.
 *
 * THE REQUEST BODY CARRIES NO IDENTIFIER, AND THERE IS NOWHERE TO PUT ONE.
 * That is the security property, not a convenience: the identifiers matched are
 * read server-side off `auth.identities` for the JWT's user id. Knowing the
 * buyer's email or phone is worth nothing here — to present an identifier you
 * must first have received a code at it. See the #2217 migration header for the
 * full argument and for why `email_confirmed_at` is not used.
 *
 * verify_jwt = true. An anonymous caller has no identifiers to match and must
 * never reach the claim RPC.
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { claimJson } from "../_shared/attendanceClaim.ts";
import { ticketCorsHeaders } from "../_shared/ticketCheckout.ts";

type Outcome =
  | "success"
  | "idempotent_success"
  | "invalid"
  | "rate_limited"
  | "internal_error";

const STRICT_BEARER_TOKEN = /^Bearer ([^\s]+)$/i;

function extractBearerToken(authorization: string | null): string | null {
  return authorization?.match(STRICT_BEARER_TOKEN)?.[1] ?? null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ticketCorsHeaders });
  }
  const json = (status: number, body: Record<string, unknown>) =>
    claimJson(status, body, ticketCorsHeaders);
  if (req.method !== "POST") {
    return json(400, { ok: false, error: "claim_invalid" });
  }
  const callerToken = extractBearerToken(req.headers.get("authorization"));
  if (!callerToken) {
    return json(401, { ok: false, error: "authentication_required" });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) {
    return json(500, { ok: false, error: "claim_failed" });
  }

  const viewer = createClient(url, anon, {
    auth: { persistSession: false },
  });
  const { data: authData, error: authError } = await viewer.auth.getUser(
    callerToken,
  );
  if (authError) {
    return json(401, { ok: false, error: "authentication_required" });
  }
  if (!authData.user) {
    return json(401, { ok: false, error: "authentication_required" });
  }

  const admin = createClient(url, service, { auth: { persistSession: false } });
  let attemptId: string | null = null;
  let admitted = false;
  let outcome: Outcome = "internal_error";
  try {
    // Same admission ledger and same 10-per-10-minutes budget as the token
    // claim. A sign-in sweep is cheap but it is still an unauthenticated-origin
    // asset transfer and gets counted.
    const { data: admission, error: admissionError } = await admin.rpc(
      "begin_attendance_claim_attempt",
      { p_user_id: authData.user.id, p_kind: "order" },
    );
    if (admissionError || typeof admission !== "object" || admission === null) {
      throw admissionError ?? new Error("claim_admission_failed");
    }
    const record = admission as Record<string, unknown>;
    attemptId = typeof record.attemptId === "string" ? record.attemptId : null;
    admitted = record.allowed === true;
    if (!attemptId) throw new Error("claim_admission_missing_attempt");
    if (!admitted) {
      outcome = "rate_limited";
      return json(429, {
        ok: false,
        error: "claim_rate_limited",
        retryAfterSeconds: 600,
      });
    }

    const { data, error } = await admin.rpc(
      "claim_attendance_by_verified_identity",
      { p_user_id: authData.user.id },
    );
    if (error) throw error;

    const result = data as {
      claimed?: Array<{ orderId?: string; eventId?: string }>;
      count?: number;
    } | null;
    const claimed = Array.isArray(result?.claimed) ? result.claimed : [];
    const eventIds = claimed.flatMap((entry) =>
      typeof entry?.eventId === "string" ? [entry.eventId] : []
    );
    outcome = eventIds.length > 0 ? "success" : "idempotent_success";
    return json(200, { ok: true, count: eventIds.length, eventIds });
  } catch {
    outcome = "internal_error";
    return json(500, { ok: false, error: "claim_failed" });
  } finally {
    if (attemptId && admitted) {
      await admin.from("attendance_claim_attempts").update({
        completed_at: new Date().toISOString(),
        outcome,
      }).eq("id", attemptId).is("completed_at", null);
    }
  }
});
