/**
 * Ve3 — orchestrate admin venue claim review (RPC + email + push + audit).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildClaimApprovedEmail,
  defaultVenuePublicUrl,
} from "../_shared/email/claimApprovedEmail.ts";
import { buildClaimRejectedEmail } from "../_shared/email/claimRejectedEmail.ts";
import {
  assertNotResendSandbox,
  EMAIL_SENDERS,
  formatSenderHeader,
  renderTransactionalEmail,
} from "../_shared/email/index.ts";
import { sendPush } from "../_shared/push-utils.ts";
// META-ORCH-1062 Phase 2 — the batch bouncer edge fns (run-bouncer /
// run-pre-photo-bouncer) ONLY accept city_id/all_cities (they 400 on a single
// place), so SPEC option (a) is not viable. Per SPEC §2.2 option (b) we import
// the pure deterministic bouncer and re-evaluate the ONE linked row in-process
// on approve. The approval wrapper is already the sole go-live writer for claims
// (Constitution #2 preserved — no third uncoordinated is_servable writer added).
import { bounce, type PlaceRow } from "../_shared/bouncer.ts";
// META-ORCH-1074 Sub-A: write a business.claim_decision notification row
// (inbox + business-app push) alongside the existing email + legacy raw push.
// Single recipient = the brand owner (brandRow.account_id). business.* routes
// to the business OneSignal app automatically via notify-dispatch.
import { dispatchNotification } from "../_shared/stripeEdgeAuth.ts";
import {
  auditActionForReview,
  feedbackPushCopy,
  normalizeFeedbackBody,
  normalizeReviewBody,
  pushCopyForReview,
} from "./reviewLogic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// deno-lint-ignore no-explicit-any
type AdminClient = any;

// META-ORCH-1062 — the bouncer-relevant projection of a place_pool row. Matches
// _shared/bouncer.ts PlaceRow (id, name, lat, lng, types, business_status,
// website, opening_hours, photos, stored_photo_urls, review_count, rating).
const BOUNCER_SELECT =
  "id, name, lat, lng, types, business_status, website, opening_hours, photos, stored_photo_urls, fetched_via, review_count, rating";

interface GoLiveResult {
  rebounced: boolean;
  servable: boolean;
  bounce_reasons: string[];
  scored_signals: string[];
  failed_signals: Array<{ signal_id: string; error: string }>;
  rolled_back: boolean;
}

// META-ORCH-1062 Phase 4 — pure builder for the run-signal-scorer per-place
// invoke body. The scorer hard-requires BOTH signal_id AND place_ids; the live
// keystone bug (1062-A) was a call that passed place_ids ONLY → the scorer
// 400'd `signal_id is required` → place_scores was never produced. This builder
// makes the contract explicit + unit-testable (I-SCORER-INVOKE-HAS-SIGNAL-ID).
export function buildScorerInvokeBody(
  signalId: string,
  placePoolId: string,
): { signal_id: string; place_ids: string[] } {
  if (!signalId) throw new Error("signal_id is required");
  return { signal_id: signalId, place_ids: [placePoolId] };
}

// META-ORCH-1062 Phase 2/4 — the approve go-live orchestration. Pure-ish: all IO
// goes through the injected service-role admin client. Returns a structured
// result the response surfaces so the admin sees exactly what happened (no
// silent failure — Constitution #5).
// META-ORCH-1062 QA: exported (was module-private) so the tester's adversarial
// regression test can drive the full approve orchestration (re-bounce gate,
// Q1 partial-vs-total rollback, ordering) with an injected fake admin client.
// No behavior change — export keyword only.
export async function runApproveGoLive(
  admin: AdminClient,
  placePoolId: string,
  scoreVetoes: Record<string, unknown> | null,
): Promise<GoLiveResult> {
  const result: GoLiveResult = {
    rebounced: false,
    servable: false,
    bounce_reasons: [],
    scored_signals: [],
    failed_signals: [],
    rolled_back: false,
  };

  // ── Phase 2: re-bounce the linked row over its CURRENT data ────────────────
  const { data: ppRow, error: ppErr } = await admin
    .from("place_pool")
    .select(BOUNCER_SELECT)
    .eq("id", placePoolId)
    .maybeSingle();
  if (ppErr || !ppRow) {
    console.error(
      "[admin-review-venue-claim] re-bounce read",
      ppErr?.message ?? "place_pool row not found",
    );
    return result; // identity already verified; deck go-live skipped, reasons empty
  }

  const verdict = bounce(ppRow as PlaceRow);
  result.rebounced = true;
  result.bounce_reasons = verdict.reasons;

  // Always record the bouncer verdict + reasons so the admin can see why a
  // venue can't go live yet (Q3=(b): verified identity, deck-eligibility stored
  // separately as a reason).
  const nowIso = new Date().toISOString();
  if (!verdict.is_servable) {
    await admin
      .from("place_pool")
      .update({
        bouncer_reason: verdict.reasons.join(";") || null,
        bouncer_validated_at: nowIso,
      })
      .eq("id", placePoolId);
    // Do NOT flip is_servable. Claim stays verified; venue stays off-deck.
    return result;
  }

  // ── Phase 4: flip servable (committed BEFORE scoring — the scorer's SELECT
  // filters is_servable=true) then score per active signal ───────────────────
  const livePatch: Record<string, unknown> = {
    is_servable: true,
    is_active: true,
    bouncer_reason: null,
    bouncer_validated_at: nowIso,
  };
  if (scoreVetoes !== null) livePatch.ai_signal_scores_veto = scoreVetoes;
  const { error: liveErr } = await admin
    .from("place_pool")
    .update(livePatch)
    .eq("id", placePoolId);
  if (liveErr) {
    console.error("[admin-review-venue-claim] go-live update", liveErr.message);
    return result; // flip failed; nothing to score
  }
  result.servable = true;

  // Load the active signals (16 live). Score ONCE PER SIGNAL with signal_id +
  // place_ids — the live keystone bug (1062-A) was the missing signal_id.
  const { data: signals, error: sigErr } = await admin
    .from("signal_definitions")
    .select("id")
    .eq("is_active", true);
  if (sigErr || !Array.isArray(signals)) {
    console.error(
      "[admin-review-venue-claim] signal_definitions read",
      sigErr?.message ?? "no signals",
    );
    // No signals to score → treat as total failure (Q1 rollback below).
    result.failed_signals.push({
      signal_id: "*",
      error: sigErr?.message ?? "signal_definitions_unavailable",
    });
  } else {
    for (const sig of signals as Array<{ id: string }>) {
      const signalId = sig.id;
      try {
        const { data: scoreRes, error: scoreErr } = await admin.functions
          .invoke("run-signal-scorer", {
            // I-SCORER-INVOKE-HAS-SIGNAL-ID: BOTH keys are required; the scorer
            // 400s on a missing signal_id. NEVER drop signal_id here.
            body: buildScorerInvokeBody(signalId, placePoolId),
          });
        if (scoreErr) {
          console.error(
            `[admin-review-venue-claim] scorer signal=${signalId}`,
            scoreErr.message ?? String(scoreErr),
          );
          result.failed_signals.push({ signal_id: signalId, error: scoreErr.message ?? "invoke_error" });
        } else {
          result.scored_signals.push(signalId);
          void scoreRes;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[admin-review-venue-claim] scorer signal=${signalId}`, msg);
        result.failed_signals.push({ signal_id: signalId, error: msg });
      }
    }
  }

  // Q1=(b): if EVERY signal-scoring call failed, roll the servable flip back to
  // false so we never leave a servable-but-unscored row. A partial success
  // (≥1 scored signal) keeps the venue live — the venue ranks on the signals it
  // qualified for, and the Sub-D cron retries the rest.
  const totalFailure = result.scored_signals.length === 0 &&
    result.failed_signals.length > 0;
  if (totalFailure) {
    const { error: rbErr } = await admin
      .from("place_pool")
      .update({
        is_servable: false,
        bouncer_reason: "scoring_failed_on_approve",
        bouncer_validated_at: new Date().toISOString(),
      })
      .eq("id", placePoolId);
    if (rbErr) {
      console.error("[admin-review-venue-claim] servable rollback", rbErr.message);
    }
    result.servable = false;
    result.rolled_back = true;
  }

  return result;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "No authorization header" }, 401);

    const rawBody = await req.json().catch(() => null);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: isAdmin, error: adminErr } = await userClient.rpc(
      "is_admin_user",
    );
    if (adminErr) return json({ error: adminErr.message }, 500);
    if (isAdmin !== true) return json({ error: "Forbidden" }, 403);

    // META-ORCH-1062 Phase 1 — pre-review admin write actions (tweak_fields /
    // score_override). These do NOT run biz_review_venue_claim; they call the
    // dedicated SECURITY DEFINER RPCs (which re-assert is_admin_user) and write
    // their own admin_audit_log row, then return early. The RPCs are the
    // server-side authority; this wrapper just shares the admin-gate + audit path.
    const rawAction =
      rawBody !== null && typeof rawBody === "object"
        ? String((rawBody as { action?: unknown }).action ?? "")
        : "";
    // ORCH-1064 — admin leaves a structured feedback round on a pending claim.
    // Like tweak_fields/score_override: call the dedicated SECURITY DEFINER RPC
    // (which re-asserts is_admin_user) through the user client, write an
    // admin_audit_log row, and additionally fire the business push (the RPC has
    // no server-only side-effect; the wrapper owns the push + audit). Returns early.
    if (rawAction === "add_feedback") {
      const adminEarly = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const parsed = normalizeFeedbackBody(rawBody);
      if (!parsed.ok) return json({ error: parsed.error }, 400);

      const { data: fbRes, error: fbErr } = await userClient.rpc(
        "admin_add_venue_claim_feedback",
        {
          p_brand_id: parsed.brandId,
          p_items: parsed.items,
          p_overall_message: parsed.overallMessage,
        },
      );
      if (fbErr) return json({ error: fbErr.message }, 400);

      const round =
        fbRes !== null && typeof fbRes === "object"
          ? (fbRes as { round?: unknown }).round ?? null
          : null;
      const itemCount =
        fbRes !== null && typeof fbRes === "object"
          ? (fbRes as { item_count?: unknown }).item_count ?? null
          : null;

      await adminEarly.from("admin_audit_log").insert({
        admin_email: user.email ?? "unknown",
        action: "venue_claim_feedback",
        target_type: "venue_claim",
        target_id: parsed.brandId,
        metadata: { round, item_count: itemCount },
      });

      // Push the business owner (brand.account_id = OneSignal external_id).
      let pushSent = false;
      const { data: fbBrand, error: fbBrandErr } = await adminEarly
        .from("brands")
        .select("name, account_id")
        .eq("id", parsed.brandId)
        .maybeSingle();
      if (fbBrandErr) {
        console.warn(
          "[admin-review-venue-claim] add_feedback brand lookup",
          fbBrandErr.message,
        );
      }
      if (fbBrand && typeof fbBrand.account_id === "string") {
        const copy = feedbackPushCopy((fbBrand.name as string) ?? "Your venue");
        pushSent = await sendPush({
          targetUserId: fbBrand.account_id,
          title: copy.title,
          body: copy.body,
          data: {
            type: "venue_claim_feedback",
            brand_id: parsed.brandId,
            round,
          },
          androidChannelId: "system",
        });
      }

      return json({ ok: true, round, item_count: itemCount, push_sent: pushSent });
    }

    // ORCH-1066 — deck-score-tuner write actions. Place-keyed (not brand-keyed):
    // they target ANY place_pool row (Google-seeded or claimed, servable or
    // pending). Like tweak_fields/score_override, each calls its dedicated
    // SECURITY DEFINER RPC through the user client (so is_admin_user() sees
    // auth.uid()), writes an admin_audit_log row via the service-role client, and
    // returns early. verify_jwt config is unchanged.
    if (
      rawAction === "set_place_score" ||
      rawAction === "pin_place_score" ||
      rawAction === "score_place_preview"
    ) {
      const adminEarly = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const b = rawBody as Record<string, unknown>;
      const placePoolId = typeof b.place_pool_id === "string"
        ? b.place_pool_id.trim()
        : "";
      if (placePoolId.length === 0) {
        return json({ error: "place_pool_id_required" }, 400);
      }

      if (rawAction === "score_place_preview") {
        const { data: seedRes, error: seedErr } = await userClient.rpc(
          "admin_score_place_preview",
          { p_place_pool_id: placePoolId },
        );
        if (seedErr) return json({ error: seedErr.message }, 400);
        await adminEarly.from("admin_audit_log").insert({
          admin_email: user.email ?? "unknown",
          action: "place_score_preview_seed",
          target_type: "place_pool",
          target_id: placePoolId,
          metadata: { result: seedRes ?? null },
        });
        return json({ ok: true, result: seedRes });
      }

      const signalId = typeof b.signal_id === "string" ? b.signal_id.trim() : "";
      if (signalId.length === 0) return json({ error: "signal_id_required" }, 400);

      if (rawAction === "set_place_score") {
        const score = typeof b.score === "number" ? b.score : Number(b.score);
        const reason = typeof b.reason === "string" ? b.reason : null;
        if (!Number.isFinite(score)) return json({ error: "score_required" }, 400);
        const { data: setRes, error: setErr } = await userClient.rpc(
          "admin_set_place_signal_score",
          {
            p_place_pool_id: placePoolId,
            p_signal_id: signalId,
            p_score: score,
            p_reason: reason,
          },
        );
        if (setErr) return json({ error: setErr.message }, 400);
        await adminEarly.from("admin_audit_log").insert({
          admin_email: user.email ?? "unknown",
          action: "place_score_set",
          target_type: "place_pool",
          target_id: placePoolId,
          metadata: { signal_id: signalId, score, reason, result: setRes ?? null },
        });
        return json({ ok: true, result: setRes });
      }

      // pin_place_score
      const radiusM = typeof b.radius_m === "number"
        ? b.radius_m
        : (b.radius_m === undefined || b.radius_m === null
          ? 16000
          : Number(b.radius_m));
      if (!Number.isFinite(radiusM) || radiusM <= 0) {
        return json({ error: "invalid_radius" }, 400);
      }
      const { data: pinRes, error: pinErr } = await userClient.rpc(
        "admin_pin_place_to_top",
        { p_place_pool_id: placePoolId, p_signal_id: signalId, p_radius_m: radiusM },
      );
      if (pinErr) return json({ error: pinErr.message }, 400);
      await adminEarly.from("admin_audit_log").insert({
        admin_email: user.email ?? "unknown",
        action: "place_score_pin",
        target_type: "place_pool",
        target_id: placePoolId,
        metadata: { signal_id: signalId, radius_m: radiusM, result: pinRes ?? null },
      });
      return json({ ok: true, result: pinRes });
    }

    if (rawAction === "tweak_fields" || rawAction === "score_override") {
      const adminEarly = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const b = rawBody as Record<string, unknown>;
      const brandId = typeof b.brand_id === "string" ? b.brand_id.trim() : "";
      if (brandId.length === 0) return json({ error: "brand_id_required" }, 400);

      if (rawAction === "tweak_fields") {
        const patch = b.patch;
        if (patch === null || typeof patch !== "object") {
          return json({ error: "invalid_patch" }, 400);
        }
        // The RPC runs as the calling admin (RLS-bound via the user client) so
        // is_admin_user() sees auth.uid(); call it through userClient.
        const { data: tweakRes, error: tweakErr } = await userClient.rpc(
          "admin_tweak_venue_claim_fields",
          { p_brand_id: brandId, p_patch: patch },
        );
        if (tweakErr) return json({ error: tweakErr.message }, 400);
        await adminEarly.from("admin_audit_log").insert({
          admin_email: user.email ?? "unknown",
          action: "venue_claim_tweak",
          target_type: "venue_claim",
          target_id: brandId,
          metadata: { patch, result: tweakRes ?? null },
        });
        return json({ ok: true, result: tweakRes });
      }

      // score_override
      const signalId = typeof b.signal_id === "string" ? b.signal_id.trim() : "";
      const score = typeof b.score === "number" ? b.score : Number(b.score);
      const reason = typeof b.reason === "string" ? b.reason : null;
      if (signalId.length === 0) return json({ error: "signal_id_required" }, 400);
      if (!Number.isFinite(score)) return json({ error: "score_required" }, 400);
      const { data: ovRes, error: ovErr } = await userClient.rpc(
        "admin_apply_score_override",
        { p_brand_id: brandId, p_signal_id: signalId, p_score: score, p_reason: reason },
      );
      if (ovErr) return json({ error: ovErr.message }, 400);
      await adminEarly.from("admin_audit_log").insert({
        admin_email: user.email ?? "unknown",
        action: "venue_claim_score_override",
        target_type: "venue_claim",
        target_id: brandId,
        metadata: { signal_id: signalId, score, reason, result: ovRes ?? null },
      });
      return json({ ok: true, result: ovRes });
    }

    const parsed = normalizeReviewBody(rawBody);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    // META-ORCH-1009 Sub-F WS7: optional admin reduce-only score vetoes applied
    // at go-live. Shape: { "<signal_id>": { vetoed_score, reason } }.
    const scoreVetoes =
      rawBody !== null && typeof rawBody === "object" &&
        typeof (rawBody as { score_vetoes?: unknown }).score_vetoes === "object" &&
        (rawBody as { score_vetoes?: unknown }).score_vetoes !== null
        ? (rawBody as { score_vetoes: Record<string, unknown> }).score_vetoes
        : null;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: rpcResult, error: rpcErr } = await userClient.rpc(
      "biz_review_venue_claim",
      {
        p_brand_id: parsed.brandId,
        p_action: parsed.action,
        p_rejection_reason: parsed.action === "reject"
          ? parsed.rejectionReason
          : null,
      },
    );
    if (rpcErr) return json({ error: rpcErr.message }, 400);

    const { data: brandRow, error: brandErr } = await admin
      .from("brands")
      .select(
        "id, name, slug, account_id, claim_status, contact_email, rejection_reason, claim_decision_emailed_at, place_pool_id",
      )
      .eq("id", parsed.brandId)
      .maybeSingle();

    if (brandErr) return json({ error: brandErr.message }, 500);
    if (!brandRow) return json({ error: "Brand not found" }, 404);

    const noop = rpcResult?.noop === true;
    const brandName = brandRow.name as string;

    await admin.from("admin_audit_log").insert({
      admin_email: user.email ?? "unknown",
      action: auditActionForReview(parsed.action),
      target_type: "venue_claim",
      target_id: parsed.brandId,
      metadata: {
        noop,
        rpc_result: rpcResult ?? null,
      },
    });

    // META-ORCH-1062 (Phase 2 + Phase 4, supersedes the Sub-F WS7 block):
    // APPROVE = go live. The identity approval (claim_status='verified') already
    // happened in biz_review_venue_claim above and is NEVER blocked by deck
    // go-live (Open Q3 = (b): claim approval and deck eligibility are separable).
    // Deck go-live here:
    //   1. Phase 2 — re-bounce the linked place_pool row over its CURRENT data
    //      in-process (the batch bouncer fns only accept city scopes). Servable
    //      is only granted if the re-bounce passes (I-CLAIM-REBOUNCE-ON-APPROVE).
    //   2. Phase 4 — flip is_servable=true (committed before scoring), then loop
    //      the ACTIVE signals and invoke run-signal-scorer ONCE PER SIGNAL with
    //      BOTH signal_id + place_ids (the old call passed place_ids only → the
    //      scorer 400'd `signal_id is required` → place_scores was never made →
    //      the venue never reached the deck). Per-signal failures are LOGGED, not
    //      swallowed. If EVERY signal fails (Q1=(b)), roll the servable flip back
    //      to false so we never leave a servable-but-unscored row.
    // REJECT = re-open editing by resetting the operator's "Recommend" edit cap.
    const placePoolId =
      (brandRow as { place_pool_id?: string | null }).place_pool_id ?? null;
    let goLive: GoLiveResult | null = null;
    if (!noop && placePoolId !== null) {
      if (parsed.action === "approve") {
        goLive = await runApproveGoLive(admin, placePoolId, scoreVetoes);
      } else if (parsed.action === "reject") {
        await admin
          .from("place_pool")
          .update({ business_recommend_edit_count: 0 })
          .eq("id", placePoolId);
      }
    }

    let emailSent = false;
    let pushSent = false;

    const shouldNotify = (parsed.action === "approve" ||
      parsed.action === "reject") &&
      !noop &&
      brandRow.claim_decision_emailed_at == null;

    if (shouldNotify) {
      const { data: ownerAuth, error: ownerErr } = await admin.auth.admin
        .getUserById(brandRow.account_id as string);
      if (ownerErr) {
        console.warn("[admin-review-venue-claim] owner lookup", ownerErr.message);
      }

      const to =
        (typeof ownerAuth?.user?.email === "string" &&
            ownerAuth.user.email.length > 0
          ? ownerAuth.user.email
          : null) ??
        (typeof brandRow.contact_email === "string" &&
            brandRow.contact_email.length > 0
          ? brandRow.contact_email
          : null);

      if (to && RESEND_API_KEY) {
        const slug = typeof brandRow.slug === "string" ? brandRow.slug : "";
        const bodyInput = parsed.action === "approve"
          ? buildClaimApprovedEmail({
            brandName,
            publicVenueUrl: defaultVenuePublicUrl(slug),
          })
          : buildClaimRejectedEmail({
            brandName,
            rejectionReason: (brandRow.rejection_reason as string) ??
              parsed.rejectionReason,
          });

        const sender = EMAIL_SENDERS.system;
        try {
          assertNotResendSandbox(sender);
        } catch (e) {
          return json(
            { error: e instanceof Error ? e.message : String(e) },
            500,
          );
        }

        const rendered = renderTransactionalEmail({
          variant: "generic_notification",
          recipient: { name: null, email: to },
          body: bodyInput,
        });

        // no-attachment: Ve3 approve/reject operator notice has no PDF or file payload.
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: formatSenderHeader(rendered.from),
            to: [to],
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
          }),
        });

        if (!res.ok) {
          const t = await res.text();
          return json({ error: `Resend ${res.status}: ${t}` }, 502);
        }

        emailSent = true;
        await admin
          .from("brands")
          .update({ claim_decision_emailed_at: new Date().toISOString() })
          .eq("id", parsed.brandId);
      }
    }

    const pushCopy = pushCopyForReview(parsed.action, brandName);
    if (pushCopy && !noop && typeof brandRow.account_id === "string") {
      pushSent = await sendPush({
        targetUserId: brandRow.account_id,
        title: pushCopy.title,
        body: pushCopy.body,
        data: {
          type: "venue_claim_review",
          brand_id: parsed.brandId,
          action: parsed.action,
        },
        androidChannelId: "system",
      });
    }

    // META-ORCH-1074 Sub-A: business.claim_decision — write an inbox row +
    // business-app push for the brand owner. Branches copy on the decision
    // (approve → info; reject → warning). Idempotent on brandId:decision so a
    // re-run of the same decision collapses. Non-fatal — never fails the review.
    if (!noop && typeof brandRow.account_id === "string") {
      const decision = parsed.action === "approve" ? "approved" : "rejected";
      const rejectionReason = decision === "rejected"
        ? ((brandRow.rejection_reason as string | null) ?? parsed.rejectionReason ?? "")
        : "";
      const title = decision === "approved" ? "Claim approved" : "Claim update";
      const body = decision === "approved"
        ? `${brandName} is yours. Tap to finish setup.`
        : `We couldn't approve your ${brandName} claim. Tap for next steps.`;
      try {
        await dispatchNotification({
          userId: brandRow.account_id,
          brandId: parsed.brandId,
          type: "business.claim_decision",
          title,
          body,
          data: { decision, rejectionReason: rejectionReason || undefined },
          relatedId: parsed.brandId,
          relatedType: "brand",
          idempotencyKey: `business.claim_decision:${parsed.brandId}:${decision}`,
          deepLink: `mingla-business://brand/${parsed.brandId}/listing`,
        });
      } catch (claimNotifyErr) {
        console.warn(
          "[admin-review-venue-claim] business.claim_decision dispatch threw (non-fatal):",
          claimNotifyErr instanceof Error
            ? claimNotifyErr.message
            : String(claimNotifyErr),
        );
      }
    }

    return json({
      ok: true,
      result: rpcResult,
      email_sent: emailSent,
      push_sent: pushSent,
      // META-ORCH-1062: surface the deck go-live outcome so the admin sees the
      // re-bounce verdict + which signals scored / failed (Constitution #5 — no
      // silent failure). null for non-approve actions or noop.
      go_live: goLive,
    });
  } catch (e) {
    console.error("[admin-review-venue-claim]", e);
    return json(
      { error: e instanceof Error ? e.message : String(e) },
      500,
    );
  }
});
