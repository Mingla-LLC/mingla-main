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
  | "invalid"
  | "ineligible"
  | "conflict"
  | "rate_limited"
  | "internal_error"
  // #3524 — the three refusals that are not faults. `identity_mismatch` is a
  // different person; `contact_unproved` is the rightful buyer whose inbox is
  // not yet proved, told so it can be acted on rather than sent in a circle;
  // `expired` is a link that aged out. All three are recorded so the per-user
  // rate limiter still sees the attempt, and NONE of them consumes the token.
  | "identity_mismatch"
  | "contact_unproved"
  | "expired";

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

    // #3524 — TWO credentials reach this function and they take different rails.
    //
    //   `token`       came from the confirmation email. It is verified against
    //                 the order's stored digest, exactly as it always was.
    //   `handoffCode` came from the desktop scan sheet. It is consumed
    //                 single-use and the RPC then calls THE claim body in SQL,
    //                 so the identity predicate, the expiry and the chat join
    //                 happen in the one place they exist.
    //
    // Both branches are written as explicit, separately named `admin.rpc(...)`
    // calls rather than one call dispatched through a variable, because
    // #2979's contract test asserts there is EXACTLY ONE claim-decision RPC
    // named in this file — one claim decision, not a family of them. A
    // variable-dispatched call would satisfy the letter of that while hiding a
    // second rail behind a string. Keep them separate, and do not name the
    // claim RPC anywhere else in this file, comments included: that gate is a
    // plain occurrence count and it counts comments too.
    let data: unknown = null;
    let error: { message: string } | null = null;
    if (body.credential.kind === "handoff") {
      const rawCode = decodeOrderClaimToken(body.credential.value);
      if (!rawCode) {
        outcome = "invalid";
        return claimJson(400, { ok: false, error: "claim_invalid" });
      }
      // The handoff digest uses the SAME governed pepper ring as the claim
      // token. Plaintext never reaches the database.
      const codeDigest = await hmacOrderClaimDigest(
        rawCode,
        pepperRing.current.secret,
      );
      const redeemed = await admin.rpc("redeem_attendance_claim_handoff", {
        p_user_id: authData.user.id,
        p_kind: body.kind,
        p_event_id: body.eventId,
        p_source_id: body.sourceId,
        p_code_digest: bytesToPostgresHex(codeDigest),
      });
      data = redeemed.data;
      error = redeemed.error;
    } else {
      let proof: Uint8Array | null = null;
      let legacyProof: Uint8Array | null = null;
      if (body.kind === "order") {
        const raw = decodeOrderClaimToken(body.credential.value);
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
        proof = await sha256Digest(body.credential.value);
      }
      if (!proof) {
        outcome = "invalid";
        return claimJson(400, { ok: false, error: "claim_invalid" });
      }
      const claimed = await admin.rpc("claim_attendance_internal_v2", {
        p_user_id: authData.user.id,
        p_kind: body.kind,
        p_event_id: body.eventId,
        p_source_id: body.sourceId,
        p_current_proof_digest: bytesToPostgresHex(proof),
        p_legacy_proof_digest: legacyProof
          ? bytesToPostgresHex(legacyProof)
          : null,
      });
      data = claimed.data;
      error = claimed.error;
    }
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
      chatJoined?: boolean;
      conversationId?: string | null;
      contactMasked?: string | null;
      contactChannel?: "email" | "phone" | null;
      result:
        | "claimed"
        | "already_claimed"
        | "invalid"
        | "ineligible"
        | "conflict"
        | "secret_unavailable"
        | "identity_mismatch"
        | "contact_unproved"
        | "expired";
    };
    if (result.result === "secret_unavailable") {
      outcome = "internal_error";
      return claimJson(503, {
        ok: false,
        error: "claim_temporarily_unavailable",
      });
    }
    // #3524 — the ticket is refused because this account has not proved it owns
    // the purchase contact. The masked hint comes FROM THE SERVER, already
    // masked; this function never has an unmasked contact to leak. The token is
    // untouched, so the rightful account can still use the same link.
    // #3524 — the rightful buyer whose inbox is simply unproved. Beside
    // `claim_identity_mismatch`, carrying the same already-masked hint, and
    // consuming nothing for the same reason: the app offers to send a code and
    // the same link must still work when they come back with one.
    if (result.result === "contact_unproved") {
      outcome = "contact_unproved";
      return claimJson(409, {
        ok: false,
        error: "claim_contact_unproved",
        contactMasked: result.contactMasked ?? null,
        contactChannel: result.contactChannel ?? null,
      });
    }
    if (result.result === "identity_mismatch") {
      outcome = "identity_mismatch";
      return claimJson(409, {
        ok: false,
        error: "claim_identity_mismatch",
        contactMasked: result.contactMasked ?? null,
        contactChannel: result.contactChannel ?? null,
      });
    }
    // #3524 — the emailed link aged out. Also non-consuming: the identity rail
    // picks the order up on the next sign-in, which is what the copy promises.
    if (result.result === "expired") {
      outcome = "expired";
      return claimJson(410, { ok: false, error: "claim_expired" });
    }
    if (
      result.result === "already_claimed" ||
      result.result === "invalid" ||
      result.result === "conflict"
    ) {
      outcome = result.result === "conflict" ? "conflict" : "invalid";
      return claimJson(400, { ok: false, error: "claim_invalid" });
    }
    if (result.result === "ineligible") {
      outcome = "ineligible";
      return claimJson(409, { ok: false, error: "claim_ineligible" });
    }
    if (result.result !== "claimed") {
      outcome = "internal_error";
      return claimJson(500, { ok: false, error: "claim_failed" });
    }
    outcome = "success";
    return claimJson(200, {
      ok: true,
      status: "claimed",
      eventId: result.eventId,
      // #3524 — the group chat is the second half of what the buyer was
      // promised, and it can legitimately not exist (an `experience` has no
      // chat). Pass the truth through so no surface promises a chat it did not
      // join.
      chatJoined: result.chatJoined === true,
      conversationId: result.conversationId ?? null,
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
