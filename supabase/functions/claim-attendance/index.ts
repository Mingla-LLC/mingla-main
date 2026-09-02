import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  bytesToPostgresHex,
  claimJson,
  decodeOrderClaimToken,
  hmacOrderClaimDigest,
  parseAttendanceClaimRequest,
  sha256Digest,
} from "../_shared/attendanceClaim.ts";
import { resolveAttendanceClaimPepperRing } from "../_shared/governedAdSecret.ts";

type Outcome =
  | "success"
  | "idempotent_success"
  | "invalid"
  | "ineligible"
  | "conflict"
  | "rate_limited"
  | "internal_error";

const STRICT_BEARER_TOKEN = /^Bearer ([^\s]+)$/i;

function extractBearerToken(authorization: string | null): string | null {
  return authorization?.match(STRICT_BEARER_TOKEN)?.[1] ?? null;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return claimJson(400, { ok: false, error: "claim_invalid" });
  }
  const callerToken = extractBearerToken(req.headers.get("authorization"));
  if (!callerToken) {
    return claimJson(401, { ok: false, error: "authentication_required" });
  }
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const pepperRing = resolveAttendanceClaimPepperRing();
  if (!url || !anon || !service || !pepperRing) {
    return claimJson(500, { ok: false, error: "claim_failed" });
  }
  const viewer = createClient(url, anon, {
    auth: { persistSession: false },
  });
  const { data: authData, error: authError } = await viewer.auth.getUser(
    callerToken,
  );
  if (authError) {
    return claimJson(401, { ok: false, error: "authentication_required" });
  }
  if (!authData.user) {
    return claimJson(401, { ok: false, error: "authentication_required" });
  }
  const body = parseAttendanceClaimRequest(await req.json().catch(() => null));
  if (!body) {
    return claimJson(400, { ok: false, error: "claim_invalid" });
  }

  const admin = createClient(url, service, { auth: { persistSession: false } });
  let attemptId: string | null = null;
  let admitted = false;
  let outcome: Outcome = "internal_error";
  try {
    const { data: admission, error: admissionError } = await admin.rpc(
      "begin_attendance_claim_attempt",
      { p_user_id: authData.user.id, p_kind: body.kind },
    );
    if (admissionError || !admission || typeof admission !== "object") {
      throw admissionError ?? new Error("claim_admission_failed");
    }
    const admissionRecord = admission as Record<string, unknown>;
    attemptId = typeof admissionRecord.attemptId === "string"
      ? admissionRecord.attemptId
      : null;
    admitted = admissionRecord.allowed === true;
    if (!attemptId) throw new Error("claim_admission_missing_attempt");
    if (!admitted) {
      outcome = "rate_limited";
      return claimJson(429, {
        ok: false,
        error: "claim_rate_limited",
        retryAfterSeconds: 600,
      });
    }

    let proof: Uint8Array | null = null;
    let legacyProof: Uint8Array | null = null;
    if (body.kind === "order") {
      const raw = decodeOrderClaimToken(body.token);
      if (raw) {
        proof = await hmacOrderClaimDigest(raw, pepperRing.current.secret);
        if (pepperRing.previous) {
          legacyProof = await hmacOrderClaimDigest(
            raw,
            pepperRing.previous.secret,
          );
        } else if (pepperRing.current.generation === "legacy_v1") {
          // In the bundle-absent compatibility state, the current direct
          // secret is also the only legacy verifier.
          legacyProof = proof;
        }
      }
    } else {
      proof = await sha256Digest(body.token);
    }
    if (!proof) {
      outcome = "invalid";
      return claimJson(400, { ok: false, error: "claim_invalid" });
    }

    const { data, error } = await admin.rpc("claim_attendance_internal_v2", {
      p_user_id: authData.user.id,
      p_kind: body.kind,
      p_event_id: body.eventId,
      p_source_id: body.sourceId,
      p_current_proof_digest: bytesToPostgresHex(proof),
      p_legacy_proof_digest: legacyProof
        ? bytesToPostgresHex(legacyProof)
        : null,
    });
    if (error) {
      if (error.message.includes("event_not_available")) {
        outcome = "ineligible";
        return claimJson(409, { ok: false, error: "claim_ineligible" });
      }
      if (error.message.includes("invalid_claim")) {
        outcome = "invalid";
        return claimJson(400, { ok: false, error: "claim_invalid" });
      }
      throw error;
    }
    const result = data as {
      eventId?: string;
      result:
        | "claimed"
        | "already_claimed"
        | "invalid"
        | "ineligible"
        | "conflict"
        | "secret_unavailable";
    };
    if (result.result === "secret_unavailable") {
      outcome = "internal_error";
      return claimJson(503, {
        ok: false,
        error: "claim_temporarily_unavailable",
      });
    }
    if (result.result === "invalid" || result.result === "conflict") {
      outcome = result.result === "conflict" ? "conflict" : "invalid";
      return claimJson(400, { ok: false, error: "claim_invalid" });
    }
    if (result.result === "ineligible") {
      outcome = "ineligible";
      return claimJson(409, { ok: false, error: "claim_ineligible" });
    }
    outcome = result.result === "already_claimed"
      ? "idempotent_success"
      : "success";
    return claimJson(200, {
      ok: true,
      status: result.result,
      eventId: result.eventId,
    });
  } catch {
    outcome = "internal_error";
    return claimJson(500, { ok: false, error: "claim_failed" });
  } finally {
    if (attemptId && admitted) {
      await admin.from("attendance_claim_attempts").update({
        completed_at: new Date().toISOString(),
        outcome,
      }).eq("id", attemptId).is("completed_at", null);
    }
  }
});
