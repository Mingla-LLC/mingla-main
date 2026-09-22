/**
 * attendance-claim-handoff — issue #3524.
 *
 * WHAT IT IS FOR. A guest opens their ticket confirmation email on a DESKTOP.
 * There is no app to open. Before this, the page dropped them on a mobile store
 * listing for an OS they are not holding. Now it shows a sheet with a scannable
 * code, and this function mints that code.
 *
 * WHY THE CODE IS NOT THE CLAIM TOKEN. Seth's decision 5 point 4: the claim
 * token is a bearer credential, so rendering it as a QR is a ticket that can be
 * photographed off a screen. This mints a SEPARATE credential worth ten minutes
 * and one use. A photograph taken after the countdown is worthless, and even
 * inside the ten minutes it is worthless to anyone who cannot also receive mail
 * at the purchase address — redemption runs the same identity predicate as every
 * other claim, on the phone, which is the only place it can be run.
 *
 * IT MINTS; IT NEVER CLAIMS. No `orders` row is written here. The RPC re-verifies
 * the claim token WITHOUT consuming it and inserts one handoff row.
 *
 * verify_jwt = false, BY NECESSITY, not by convenience: the desktop buyer has no
 * Mingla account yet — that is the entire defect this issue is about — and the
 * claim fragment IS the credential. The identity predicate cannot be applied
 * here because there is no identity yet.
 *
 * The raw code is returned ONCE, in the success response, and is never logged.
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  attendanceClaimHandoffUrls,
  bytesToPostgresHex,
  claimJson,
  decodeOrderClaimToken,
  hmacOrderClaimDigest,
  mintOrderClaimToken,
  parseAttendanceClaimRequest,
  sha256Digest,
} from "../_shared/attendanceClaim.ts";
import { resolveAttendanceClaimPepperRing } from "../_shared/governedAdSecret.ts";
import { ticketCorsHeaders } from "../_shared/ticketCheckout.ts";

/** Ten minutes, stated once, returned to the client so the countdown and the
 * database agree about the window. The client never decides validity — the
 * server does — but it must not display a code it knows is dead. */
const HANDOFF_TTL_SECONDS = 600;

function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ticketCorsHeaders });
  }
  const json = (status: number, body: Record<string, unknown>) =>
    claimJson(status, body, ticketCorsHeaders);
  if (req.method !== "POST") {
    return json(400, { ok: false, error: "handoff_invalid" });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const pepperRing = resolveAttendanceClaimPepperRing();
  if (!url || !service || !pepperRing) {
    return json(500, { ok: false, error: "handoff_failed" });
  }

  const body = parseAttendanceClaimRequest(await req.json().catch(() => null));
  // The desktop holds the CLAIM TOKEN from the email fragment. A handoff code
  // cannot mint another handoff code — that would be a credential that renews
  // itself past its own ten-minute window.
  if (!body || body.credential.kind !== "token") {
    return json(400, { ok: false, error: "handoff_invalid" });
  }
  // Only a purchase has a desktop scan sheet. RSVP pass recovery is #871/#3440's
  // product with its own token and its own flows.
  if (body.kind !== "order") {
    return json(400, { ok: false, error: "handoff_invalid" });
  }

  try {
    const raw = decodeOrderClaimToken(body.credential.value);
    if (!raw) return json(400, { ok: false, error: "handoff_invalid" });
    const proof = await hmacOrderClaimDigest(raw, pepperRing.current.secret);
    let legacyProof: Uint8Array | null = null;
    if (pepperRing.previous) {
      legacyProof = await hmacOrderClaimDigest(
        raw,
        pepperRing.previous.secret,
      );
    } else if (pepperRing.current.generation === "legacy_v1") {
      // In the bundle-absent compatibility state, the current direct secret is
      // also the only legacy verifier. Same arm as `claim-attendance`.
      legacyProof = proof;
    }

    const { token: code, raw: rawCode } = mintOrderClaimToken();
    const codeDigest = await hmacOrderClaimDigest(
      rawCode,
      pepperRing.current.secret,
    );
    const ipHash = await (async () => {
      const ip = clientIp(req);
      if (!ip) return null;
      return Array.from(await sha256Digest(ip))
        .map((b) => b.toString(16).padStart(2, "0")).join("");
    })();

    const admin = createClient(url, service, {
      auth: { persistSession: false },
    });
    const { data, error } = await admin.rpc("mint_attendance_claim_handoff", {
      p_kind: body.kind,
      p_event_id: body.eventId,
      p_source_id: body.sourceId,
      p_current_proof_digest: bytesToPostgresHex(proof),
      p_legacy_proof_digest: legacyProof
        ? bytesToPostgresHex(legacyProof)
        : null,
      p_code_digest: bytesToPostgresHex(codeDigest),
      p_ip_hash: ipHash,
    });
    if (error) {
      if (error.message.includes("invalid_claim")) {
        return json(400, { ok: false, error: "handoff_invalid" });
      }
      throw error;
    }
    const result = data as {
      result:
        | "minted"
        | "invalid"
        | "ineligible"
        | "expired"
        | "conflict"
        | "rate_limited";
    };
    if (result.result === "rate_limited") {
      return json(429, {
        ok: false,
        error: "handoff_rate_limited",
        retryAfterSeconds: HANDOFF_TTL_SECONDS,
      });
    }
    if (result.result === "expired") {
      return json(410, { ok: false, error: "claim_expired" });
    }
    if (result.result === "ineligible" || result.result === "conflict") {
      return json(409, { ok: false, error: "handoff_ineligible" });
    }
    if (result.result !== "minted") {
      return json(400, { ok: false, error: "handoff_invalid" });
    }

    // The raw code leaves the server exactly here and nowhere else. It is not
    // logged, and it is not written to the database — only its HMAC digest is.
    const { webClaimUrl } = attendanceClaimHandoffUrls({
      kind: body.kind,
      eventId: body.eventId,
      sourceId: body.sourceId,
      code,
    });
    return json(200, {
      ok: true,
      handoffUrl: webClaimUrl,
      expiresInSeconds: HANDOFF_TTL_SECONDS,
    });
  } catch {
    // No detail, and never the token or the code. A caller holding a valid
    // fragment learns only that minting failed.
    return json(500, { ok: false, error: "handoff_failed" });
  }
});
