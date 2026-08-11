/**
 * admin-payout-hold-migrate — #1173 (sub-issue D of #1013) [Admin payout-hold migration].
 *
 * Admin-gated, idempotent, BATCHED migration of EXISTING Stripe organiser
 * accounts onto (or off) a manual event-anchored payout schedule. The admin
 * twin of the onboard-path flip (brand-stripe-onboard §4.2), for accounts that
 * already exist and never flow through fresh onboarding.
 *
 *   - direction:"hold"     → setManualPayoutSchedule + stamp_payout_hold_cutover.
 *   - direction:"rollback" → restoreDailyPayoutSchedule + rollback_payout_hold_cutover.
 *   - dry_run:true         → resolve state + return would-be result; NO Stripe, NO mutation.
 *
 * verify_jwt = true (config.toml): no-JWT callers rejected at the gateway (401);
 * this fn re-verifies the JWT is a real user AND an active admin (else 403).
 *
 * Atomicity via compensation (per brand): flip → stamp; if the stamp RPC fails,
 * restoreDailyPayoutSchedule is called so a brand is NEVER left manual-but-
 * unstamped (the one dangerous state). One brand's failure never aborts the
 * batch. Idempotent: an already-stamped brand is skipped WITHOUT a Stripe call.
 *
 * #1807 — PAYSTACK LANE. A Paystack-only (Nigerian) brand has no
 * stripe_connect_accounts row, so before this it was recorded
 * skipped_no_account every time and could never be stamped — which left
 * issue_1389_prepare_payment raising stay_bank_not_ready for every NGN Stay
 * booking. Account resolution is now: Stripe row → Stripe lane (unchanged);
 * else an ACTIVE brand_paystack_recipients row → Paystack lane; else
 * skipped_no_account (unchanged). Stripe wins if both somehow exist.
 *
 * The Paystack lane has NO schedule flip and NO compensation, by design.
 * Paystack has no payout-schedule concept: settlement routing is decided per
 * charge by the split fields (ticket-checkout-create/ngPaystackSplit.ts — an
 * unstamped brand splits to the organiser sub-account at charge; a stamped
 * brand settles 100% to Mingla for later event-anchored release). The stamp
 * is therefore the ONLY mutation, so there is nothing to compensate: it calls
 * stamp_payout_hold_cutover / rollback_payout_hold_cutover with a NULL
 * p_stripe_account_id (both the column and the RPC parameter are nullable —
 * 20270110000007_issue_1173_stripe_schedule_flip.sql:32,74-81) and writes the
 * same ledger + admin-audit trails. Idempotency, dry-run, the admin gate,
 * batch limits and per-brand isolation are identical across both lanes.
 *
 * A failed stamp on the Paystack lane records the #1807 result 'stamp_failed'
 * — NOT 'stamp_failed_rolled_back' (nothing was rolled back) and NOT
 * 'flip_failed' (there is no schedule flip on this rail). The ledger CHECK is
 * widened for it, and both RPCs are made rail-aware so the interval columns
 * are NULL rather than fabricated 'daily'/'manual', by
 * 20270317001807_issue_1807_paystack_cutover_ledger_truth.sql.
 *
 * Audit (two trails): (1) one payout_hold_cutover_migrations row per per-brand
 * attempt (written inside the stamp/rollback RPC for mutating cases, directly
 * for skip/fail cases); (2) one admin_write_audit row per mutating/failed brand
 * (ORCH-1271 helper → admin_audit_log). Audit-write failure is non-fatal.
 *
 * HARD out-of-scope: creates/replaces/detaches NO Stripe account; touches NO
 * charge path, no release amounts, no publish/sell gating. Moves NO money.
 */

// @ts-ignore — Deno ESM import; types resolved at runtime.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore — Deno ESM import; types resolved at runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  restoreDailyPayoutSchedule,
  setManualPayoutSchedule,
  type StripeV2Account,
} from "../_shared/stripeBlueprintClient.ts";

const MAX_BATCH = 50;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVISIBLE_WS = /[\s\u00A0\u200B\u200C\u200D\u2028\u2029\uFEFF]/g;

type Direction = "hold" | "rollback";
type MigrateResult =
  | "flipped"
  | "skipped_already_stamped"
  | "skipped_no_account"
  | "flip_failed"
  // #1807 — the stamp failed and there was NO provider mutation to compensate.
  // Reachable only from the Paystack lane; the Stripe lane has a flip to undo
  // and therefore records stamp_failed_rolled_back instead.
  | "stamp_failed"
  | "stamp_failed_rolled_back"
  | "rolled_back"
  | "rollback_failed";

interface MigrateBody {
  brand_ids?: unknown;
  reason?: unknown;
  direction?: unknown;
  dry_run?: unknown;
}

interface PerBrandResult {
  brand_id: string;
  result: MigrateResult;
  error_message?: string;
}

export type MigrateDeps = {
  env: (key: string) => string | undefined;
  createAdmin: typeof createClient;
  setManualPayoutSchedule: (
    accountId: string,
    idempotencyKey: string,
  ) => Promise<StripeV2Account>;
  restoreDailyPayoutSchedule: (
    accountId: string,
    idempotencyKey: string,
  ) => Promise<StripeV2Account>;
};

const defaultDeps: MigrateDeps = {
  env: (key) => Deno.env.get(key),
  createAdmin: createClient,
  setManualPayoutSchedule,
  restoreDailyPayoutSchedule,
};

const EMPTY_COUNTS: Record<MigrateResult, number> = {
  flipped: 0,
  skipped_already_stamped: 0,
  skipped_no_account: 0,
  flip_failed: 0,
  stamp_failed: 0,
  stamp_failed_rolled_back: 0,
  rolled_back: 0,
  rollback_failed: 0,
};

export async function handleAdminPayoutHoldMigrate(
  req: Request,
  deps: MigrateDeps = defaultDeps,
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  let body: MigrateBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  // ── Validate request. ───────────────────────────────────────────────────────
  const rawDirection = typeof body.direction === "string"
    ? body.direction
    : "hold";
  if (rawDirection !== "hold" && rawDirection !== "rollback") {
    return json({ error: "validation_error", detail: "direction_invalid" }, 400);
  }
  const direction: Direction = rawDirection;
  const dryRun = body.dry_run === true;

  if (!Array.isArray(body.brand_ids) || body.brand_ids.length === 0) {
    return json(
      { error: "validation_error", detail: "brand_ids_required" },
      400,
    );
  }
  if (body.brand_ids.length > MAX_BATCH) {
    return json(
      { error: "batch_too_large", detail: `max ${MAX_BATCH} brands per batch` },
      400,
    );
  }
  const brandIds: string[] = [];
  for (const raw of body.brand_ids) {
    if (typeof raw !== "string" || !UUID_REGEX.test(raw)) {
      return json(
        { error: "validation_error", detail: "brand_id_invalid_uuid" },
        400,
      );
    }
    brandIds.push(raw);
  }
  const rawReason = typeof body.reason === "string" ? body.reason : "";
  if (rawReason.replace(INVISIBLE_WS, "") === "") {
    return json({ error: "reason_required", field: "reason" }, 400);
  }
  const reason = rawReason.trim();

  // ── ADMIN GATE (mirrors admin-stripe-connect-action). ────────────────────────
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const supabase = deps.createAdmin(
    deps.env("SUPABASE_URL") ?? "",
    deps.env("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(
    token,
  );
  if (authError || !user) return json({ error: "unauthorized" }, 401);
  const { data: adminRow } = await supabase
    .from("admin_users")
    .select("id")
    .eq("email", user.email)
    .eq("status", "active")
    .maybeSingle();
  if (!adminRow) return json({ error: "forbidden" }, 403);

  const batchId = crypto.randomUUID();
  const results: PerBrandResult[] = [];
  const counts: Record<MigrateResult, number> = { ...EMPTY_COUNTS };

  // Direct service-role insert of a batch-ledger row (skip/fail cases only —
  // the mutating-success rows are written inside the stamp/rollback RPC).
  const recordLedger = async (
    brandId: string,
    stripeAccountId: string | null,
    result: MigrateResult,
    priorInterval: string | null,
    newInterval: string | null,
    cutoverBefore: string | null,
    cutoverAfter: string | null,
    errorMessage: string | null,
  ): Promise<void> => {
    const { error } = await supabase
      .from("payout_hold_cutover_migrations")
      .insert({
        batch_id: batchId,
        brand_id: brandId,
        stripe_account_id: stripeAccountId,
        direction,
        prior_interval: priorInterval,
        new_interval: newInterval,
        cutover_before: cutoverBefore,
        cutover_after: cutoverAfter,
        result,
        error_message: errorMessage,
        actor_email: user.email,
        actor_uid: user.id,
        reason,
      });
    if (error) {
      console.error(
        "[admin-payout-hold-migrate] ledger insert failed (non-fatal):",
        error.message,
      );
    }
  };

  const recordAdminAudit = async (
    brandId: string,
    stripeAccountId: string | null,
    result: MigrateResult,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): Promise<void> => {
    const { error } = await supabase.rpc("admin_write_audit", {
      p_action: direction === "hold"
        ? "payout_hold.migrate"
        : "payout_hold.rollback",
      p_entity_type: "brand",
      p_entity_id: brandId,
      p_reason: reason,
      p_metadata: {
        batch_id: batchId,
        stripe_account_id: stripeAccountId,
        result,
        before,
        after,
      },
      p_actor_email: user.email,
      p_actor_uid: user.id,
    });
    if (error) {
      console.error(
        "[admin-payout-hold-migrate] admin audit failed (non-fatal):",
        error.message,
      );
    }
  };

  const push = (
    brandId: string,
    result: MigrateResult,
    errorMessage?: string,
  ): void => {
    counts[result] += 1;
    results.push(
      errorMessage
        ? { brand_id: brandId, result, error_message: errorMessage }
        : { brand_id: brandId, result },
    );
  };

  // ── Per brand, sequential, each isolated (one failure never aborts others). ──
  for (const brandId of brandIds) {
    // #1807 — declared OUTSIDE the try so the unexpected-error catch at the
    // bottom knows which rail it was on. ALWAYS false for a brand that has a
    // Stripe connected account, so the Stripe outcome there is unchanged.
    let paystackLane = false;
    try {
      // Resolve the connected account + current stamp state.
      const { data: scaRow, error: scaError } = await supabase
        .from("stripe_connect_accounts")
        .select("stripe_account_id")
        .eq("brand_id", brandId)
        .maybeSingle();
      if (scaError) throw scaError;

      const { data: brandRow, error: brandError } = await supabase
        .from("brands")
        .select("payout_hold_cutover_at")
        .eq("id", brandId)
        .maybeSingle();
      if (brandError) throw brandError;

      const stripeAccountId: string | null = scaRow?.stripe_account_id ?? null;
      const cutoverAt: string | null = brandRow?.payout_hold_cutover_at ?? null;

      // #1807 — resolve a Paystack transfer recipient ONLY when there is no
      // Stripe row. Stripe wins when both exist (a brand should not have both;
      // no merge policy is invented here), and a Stripe brand issues exactly
      // the same reads it always did — this query never runs for it.
      if (!stripeAccountId) {
        const { data: recipientRow, error: recipientError } = await supabase
          .from("brand_paystack_recipients")
          .select("id")
          .eq("brand_id", brandId)
          .eq("is_active", true)
          .maybeSingle();
        if (recipientError) throw recipientError;
        paystackLane = recipientRow != null;
      }

      if (!stripeAccountId && !paystackLane) {
        if (!dryRun) {
          await recordLedger(
            brandId,
            null,
            "skipped_no_account",
            null,
            null,
            cutoverAt,
            cutoverAt,
            null,
          );
        }
        push(brandId, "skipped_no_account");
        continue;
      }

      if (!stripeAccountId) {
        // ── #1807 PAYSTACK LANE ────────────────────────────────────────────
        // No provider mutation exists on this rail (see the header note), so
        // the stamp RPC is the whole transaction and there is nothing to
        // compensate. prior_interval / new_interval are Stripe payout-schedule
        // concepts and are written NULL rather than fabricated.
        if (direction === "hold") {
          if (cutoverAt !== null) {
            // Idempotent no-op — mirrors the Stripe lane.
            if (!dryRun) {
              await recordLedger(
                brandId,
                null,
                "skipped_already_stamped",
                null,
                null,
                cutoverAt,
                cutoverAt,
                null,
              );
              await recordAdminAudit(
                brandId,
                null,
                "skipped_already_stamped",
                { cutover_at: cutoverAt },
                { cutover_at: cutoverAt },
              );
            }
            push(brandId, "skipped_already_stamped");
            continue;
          }

          if (dryRun) {
            push(brandId, "flipped"); // would-be
            continue;
          }

          try {
            const { error: stampError } = await supabase.rpc(
              "stamp_payout_hold_cutover",
              {
                p_brand_id: brandId,
                p_stripe_account_id: null,
                p_batch_id: batchId,
                p_actor_email: user.email,
                p_actor_uid: user.id,
                p_reason: reason,
              },
            );
            if (stampError) throw stampError;
          } catch (stampErr) {
            // Nothing was mutated on the provider, so the brand is already in
            // the state we found it (unstamped). NO compensation call, and so
            // NOT stamp_failed_rolled_back — nothing was rolled back. Not
            // flip_failed either: there is no schedule flip on this rail.
            const message = stampErr instanceof Error
              ? stampErr.message
              : String(stampErr);
            await recordLedger(
              brandId,
              null,
              "stamp_failed",
              null,
              null,
              null,
              null,
              message,
            );
            await recordAdminAudit(
              brandId,
              null,
              "stamp_failed",
              { cutover_at: null },
              { cutover_at: null, error: message },
            );
            push(brandId, "stamp_failed", message);
            continue;
          }

          // The stamp RPC already wrote the 'flipped' ledger row; write the
          // admin_audit_log trail.
          await recordAdminAudit(
            brandId,
            null,
            "flipped",
            { cutover_at: null },
            { stamped: true },
          );
          push(brandId, "flipped");
          continue;
        }

        // direction === "rollback"
        if (dryRun) {
          push(brandId, "rolled_back"); // would-be
          continue;
        }
        try {
          const { error: rollbackError } = await supabase.rpc(
            "rollback_payout_hold_cutover",
            {
              p_brand_id: brandId,
              p_stripe_account_id: null,
              p_batch_id: batchId,
              p_actor_email: user.email,
              p_actor_uid: user.id,
              p_reason: reason,
            },
          );
          if (rollbackError) throw rollbackError;
        } catch (rpcErr) {
          const message = rpcErr instanceof Error
            ? rpcErr.message
            : String(rpcErr);
          await recordLedger(
            brandId,
            null,
            "rollback_failed",
            null,
            null,
            cutoverAt,
            cutoverAt,
            message,
          );
          await recordAdminAudit(
            brandId,
            null,
            "rollback_failed",
            { cutover_at: cutoverAt },
            { cutover_at: cutoverAt, error: message },
          );
          push(brandId, "rollback_failed", message);
          continue;
        }
        await recordAdminAudit(
          brandId,
          null,
          "rolled_back",
          { cutover_at: cutoverAt },
          { cutover_at: null },
        );
        push(brandId, "rolled_back");
        continue;
      }

      if (direction === "hold") {
        if (cutoverAt !== null) {
          // Idempotent no-op — do NOT call Stripe.
          if (!dryRun) {
            await recordLedger(
              brandId,
              stripeAccountId,
              "skipped_already_stamped",
              "manual",
              "manual",
              cutoverAt,
              cutoverAt,
              null,
            );
            await recordAdminAudit(
              brandId,
              stripeAccountId,
              "skipped_already_stamped",
              { cutover_at: cutoverAt },
              { cutover_at: cutoverAt, schedule: "manual" },
            );
          }
          push(brandId, "skipped_already_stamped");
          continue;
        }

        if (dryRun) {
          push(brandId, "flipped"); // would-be
          continue;
        }

        // Flip to manual.
        try {
          await deps.setManualPayoutSchedule(
            stripeAccountId,
            `${batchId}:${brandId}`,
          );
        } catch (flipErr) {
          const message = flipErr instanceof Error
            ? flipErr.message
            : String(flipErr);
          await recordLedger(
            brandId,
            stripeAccountId,
            "flip_failed",
            "daily",
            "daily",
            null,
            null,
            message,
          );
          await recordAdminAudit(
            brandId,
            stripeAccountId,
            "flip_failed",
            { cutover_at: null, schedule: "daily" },
            { schedule: "daily", error: message },
          );
          push(brandId, "flip_failed", message);
          continue;
        }

        // Stamp cutover atomically. On failure → compensate (restore daily).
        try {
          const { error: stampError } = await supabase.rpc(
            "stamp_payout_hold_cutover",
            {
              p_brand_id: brandId,
              p_stripe_account_id: stripeAccountId,
              p_batch_id: batchId,
              p_actor_email: user.email,
              p_actor_uid: user.id,
              p_reason: reason,
            },
          );
          if (stampError) throw stampError;
        } catch (stampErr) {
          const message = stampErr instanceof Error
            ? stampErr.message
            : String(stampErr);
          try {
            await deps.restoreDailyPayoutSchedule(
              stripeAccountId,
              `${batchId}:rollback:${brandId}`,
            );
          } catch (rbErr) {
            const rbMessage = rbErr instanceof Error
              ? rbErr.message
              : String(rbErr);
            console.error(
              "[admin-payout-hold-migrate] compensation restore FAILED (manual review):",
              rbMessage,
            );
          }
          await recordLedger(
            brandId,
            stripeAccountId,
            "stamp_failed_rolled_back",
            "manual",
            "daily",
            null,
            null,
            message,
          );
          await recordAdminAudit(
            brandId,
            stripeAccountId,
            "stamp_failed_rolled_back",
            { cutover_at: null },
            { schedule: "daily", error: message },
          );
          push(brandId, "stamp_failed_rolled_back", message);
          continue;
        }

        // Flip + stamp both succeeded. The stamp RPC already wrote the
        // 'flipped' ledger row; write the admin_audit_log trail.
        await recordAdminAudit(
          brandId,
          stripeAccountId,
          "flipped",
          { cutover_at: null, schedule: "daily" },
          { schedule: "manual" },
        );
        push(brandId, "flipped");
        continue;
      }

      // direction === "rollback"
      if (dryRun) {
        push(brandId, "rolled_back"); // would-be
        continue;
      }
      try {
        await deps.restoreDailyPayoutSchedule(
          stripeAccountId,
          `${batchId}:rollback:${brandId}`,
        );
      } catch (rbErr) {
        const message = rbErr instanceof Error ? rbErr.message : String(rbErr);
        await recordLedger(
          brandId,
          stripeAccountId,
          "rollback_failed",
          "manual",
          "manual",
          cutoverAt,
          cutoverAt,
          message,
        );
        await recordAdminAudit(
          brandId,
          stripeAccountId,
          "rollback_failed",
          { cutover_at: cutoverAt, schedule: "manual" },
          { schedule: "manual", error: message },
        );
        push(brandId, "rollback_failed", message);
        continue;
      }
      // Restore succeeded → NULL the cutover (RPC writes the 'rolled_back' row).
      try {
        const { error: rollbackError } = await supabase.rpc(
          "rollback_payout_hold_cutover",
          {
            p_brand_id: brandId,
            p_stripe_account_id: stripeAccountId,
            p_batch_id: batchId,
            p_actor_email: user.email,
            p_actor_uid: user.id,
            p_reason: reason,
          },
        );
        if (rollbackError) throw rollbackError;
      } catch (rpcErr) {
        // Daily is already restored (safe); the stamp-NULL failed. Record it.
        const message = rpcErr instanceof Error
          ? rpcErr.message
          : String(rpcErr);
        await recordLedger(
          brandId,
          stripeAccountId,
          "rollback_failed",
          "daily",
          "daily",
          cutoverAt,
          cutoverAt,
          message,
        );
        await recordAdminAudit(
          brandId,
          stripeAccountId,
          "rollback_failed",
          { cutover_at: cutoverAt, schedule: "manual" },
          { schedule: "daily", cutover_at: cutoverAt, error: message },
        );
        push(brandId, "rollback_failed", message);
        continue;
      }
      await recordAdminAudit(
        brandId,
        stripeAccountId,
        "rolled_back",
        { cutover_at: cutoverAt, schedule: "manual" },
        { cutover_at: null, schedule: "daily" },
      );
      push(brandId, "rolled_back");
    } catch (err) {
      // Unexpected per-brand error (e.g. DB read failure) — isolate it.
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[admin-payout-hold-migrate] brand ${brandId} unexpected error:`,
        message,
      );
      // #1807 — flip_failed claims a payout-schedule flip was attempted, which
      // is only ever true on the Stripe rail. paystackLane is ALWAYS false for
      // a brand with a Stripe account, so this is identical for Stripe. It is
      // also false when the rail was never determined (an error thrown by the
      // account-resolution reads themselves), which is the honest reading:
      // the hold attempt failed before a rail was known.
      const failResult: MigrateResult = direction === "rollback"
        ? "rollback_failed"
        : paystackLane
        ? "stamp_failed"
        : "flip_failed";
      if (!dryRun) {
        await recordLedger(
          brandId,
          null,
          failResult,
          null,
          null,
          null,
          null,
          message,
        );
      }
      push(brandId, failResult, message);
    }
  }

  return json({
    batch_id: batchId,
    direction,
    dry_run: dryRun,
    results,
    counts,
  });
}

if (import.meta.main) {
  serve((req: Request) => handleAdminPayoutHoldMigrate(req));
}
