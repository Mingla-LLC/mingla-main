/**
 * gig-hire — the Host pays a creator fee (#3872), and every payment the
 * provider took is recorded (#4402).
 *
 * Actions:
 *   start / topup        create the offer (or top-up) and the provider payment.
 *   confirm              the native card sheet's confirm (kept for old builds).
 *   confirm_reference    the Host return page and the hire sheet: check one
 *                        hold or top-up with the provider and record it.
 *   reconcile            machine only (pg_cron every 15 minutes): every
 *                        pending, recently retired or refund-due row.
 *
 * The handler takes its clients and provider calls as dependencies so the
 * Deno suite exercises it without the network (index.ts wires the real ones).
 */
// @ts-ignore — Deno ESM import; types resolved at runtime
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { PaystackInitializeParams } from "../_shared/paystack.ts";
import type { StripeClient } from "../_shared/stripe.ts";
import {
  gigPaymentReturnUrl,
  gigPaystackInitialize,
  type GigQuote,
  gigStripeIntent,
  gigTopupPaystackInitialize,
  gigTopupStripeIntent,
  quoteGig,
} from "../_shared/gigMoney.ts";
import {
  applyGigOutcomeEffects,
  type GigCaptureOutcome,
  type GigMismatchAlertInput,
  type GigPaymentKind,
  gigPaystackReference,
  type GigProbeTarget,
  type GigRail,
  type GigStripeIntentLike,
  isGigPaymentKind,
  parseGigReference,
  type PaystackProbeOutcome,
  probeGigPayment,
  supabaseGigCaptureStore,
} from "../_shared/gigPaymentCapture.ts";

export interface GigHireDeps {
  /** Business web origin for the Paystack return page (null → default). */
  webOrigin: string | null;
  userClient(authorization: string): SupabaseClient;
  serviceClient(): SupabaseClient;
  paystackInitialize(
    input: PaystackInitializeParams,
  ): Promise<{ authorization_url: string; reference: string }>;
  paystackVerifyOutcome(reference: string): Promise<PaystackProbeOutcome>;
  stripe(): StripeClient;
  isCronCaller(authorization: string): Promise<boolean>;
  notifyMismatch(input: GigMismatchAlertInput): Promise<number>;
  requestLateRefund(contractId: string): Promise<{ ok: boolean }>;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SETTLED = new Set([
  "captured",
  "released",
  "refunded",
  "partially_refunded",
]);

/** Old SQL (before the #4402 migration applies) has no such function. */
function isMissingFunction(
  error: { code?: string; message?: string } | null,
): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" ||
    /could not find the function|does not exist/i.test(
      String(error.message ?? ""),
    );
}

type HostCheck = { ok: true; brandId: string } | { ok: false };

async function hostOfContract(
  db: SupabaseClient,
  contractId: string,
  userId: string,
): Promise<HostCheck> {
  const { data: contract, error } = await db.from("gig_contracts")
    .select("id,brand_id").eq("id", contractId).maybeSingle();
  if (error) throw new Error(`contract_read_failed:${error.message}`);
  if (!contract) return { ok: false };
  const { data: writer, error: writerError } = await db.rpc(
    "issue_3872_gig_host_writer",
    { p_brand_id: contract.brand_id, p_actor: userId },
  );
  if (writerError) throw new Error(`host_check_failed:${writerError.message}`);
  return writer === true
    ? { ok: true, brandId: String(contract.brand_id) }
    : { ok: false };
}

/** The row to check for a contract: a pending top-up first, else the hold. */
async function ledgerTarget(
  db: SupabaseClient,
  contractId: string,
  kind?: GigPaymentKind,
): Promise<(GigProbeTarget & { status: string }) | null> {
  if (kind !== "gig_hold") {
    const { data: adj, error } = await db.from("gig_hold_adjustments")
      .select("terms_version,rail,status,provider_ref")
      .eq("contract_id", contractId).eq("kind", "topup")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(`topup_read_failed:${error.message}`);
    if (adj && (kind === "gig_topup" || adj.status === "pending")) {
      return {
        kind: "gig_topup",
        contractId,
        termsVersion: Number(adj.terms_version),
        rail: adj.rail === "stripe" ? "stripe" : "paystack",
        reference: adj.rail === "stripe" ? (adj.provider_ref ?? null) : null,
        status: String(adj.status),
      };
    }
    if (kind === "gig_topup") return null;
  }
  const { data: contract, error: contractError } = await db.from(
    "gig_contracts",
  )
    .select("current_terms_version").eq("id", contractId).maybeSingle();
  if (contractError) {
    throw new Error(`contract_read_failed:${contractError.message}`);
  }
  if (!contract) return null;
  const { data: hold, error } = await db.from("gig_holds")
    .select("terms_version,rail,status,provider_ref")
    .eq("contract_id", contractId)
    .eq("terms_version", Number(contract.current_terms_version)).maybeSingle();
  if (error) throw new Error(`hold_read_failed:${error.message}`);
  if (!hold) return null;
  return {
    kind: "gig_hold",
    contractId,
    termsVersion: Number(hold.terms_version),
    rail: hold.rail === "stripe" ? "stripe" : "paystack",
    reference: hold.rail === "stripe" ? (hold.provider_ref ?? null) : null,
    status: String(hold.status),
  };
}

/** What the Host screens show for a check. */
export function paymentCheckAnswer(
  outcome: GigCaptureOutcome,
): Record<string, unknown> {
  switch (outcome.status) {
    case "captured":
    case "replayed":
      return { ok: true, status: outcome.status, payment_check: "paid" };
    case "late_capture_refund_due":
      return {
        ok: false,
        error: "payment_late_refunded",
        payment_check: "refunded",
      };
    case "pending":
      return { ok: false, error: "payment_pending", payment_check: "pending" };
    case "not_paid":
      return { ok: false, error: "payment_failed", payment_check: "not_paid" };
    case "mismatch":
      return {
        ok: false,
        error: "payment_mismatch",
        payment_check: "mismatch",
      };
    default: {
      const never: never = outcome;
      return {
        ok: false,
        error: "payment_check_failed",
        detail: String(never),
      };
    }
  }
}

export function createGigHireHandler(
  deps: GigHireDeps,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }
    const authorization = req.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) {
      return json({ error: "unauthorized" }, 401);
    }
    const body = await req.json().catch(() => null) as
      | Record<string, unknown>
      | null;
    if (!body) return json({ error: "invalid_json" }, 400);
    const action = String(body.action ?? "");
    const serviceDb = deps.serviceClient();
    const probeDeps = {
      store: supabaseGigCaptureStore(serviceDb),
      paystackVerifyOutcome: deps.paystackVerifyOutcome,
      stripeRetrieve: (id: string) => deps.stripe().paymentIntents.retrieve(id),
    };
    const probe = async (target: GigProbeTarget, source: string) => {
      const outcome = await probeGigPayment(probeDeps, target);
      const reference = target.reference ??
        gigPaystackReference(
          target.kind,
          target.contractId,
          target.termsVersion,
        );
      const effects = await applyGigOutcomeEffects(serviceDb, outcome, {
        source,
        rail: target.rail,
        reference,
        notifyMismatch: deps.notifyMismatch,
        requestLateRefund: deps.requestLateRefund,
      });
      return { outcome, effects };
    };

    // ---- reconcile: machine only, before any user lookup ----
    if (action === "reconcile") {
      if (!(await deps.isCronCaller(authorization))) {
        return json({ error: "unauthorized" }, 401);
      }
      const { data, error } = await serviceDb.rpc(
        "gig_payment_reconcile_candidates",
        { p_older_than: "30 minutes", p_limit: 100 },
      );
      if (error) {
        console.error("[gig-hire] reconcile candidates failed", error);
        return json({
          error: "reconcile_candidates_failed",
          detail: error.message,
        }, 500);
      }
      const candidates =
        ((data as { candidates?: unknown[] } | null)?.candidates ??
          []) as Array<Record<string, unknown>>;
      const summary = {
        checked: 0,
        captured: 0,
        replayed: 0,
        late_capture_refund_due: 0,
        refunds_requested: 0,
        refunds_failed: 0,
        still_pending: 0,
        not_paid: 0,
        mismatched: 0,
        errors: 0,
      };
      const rows: Array<Record<string, unknown>> = [];
      for (const candidate of candidates) {
        const kind = candidate.kind;
        const contractId = String(candidate.contract_id ?? "");
        if (!isGigPaymentKind(kind) || !uuid.test(contractId)) continue;
        summary.checked += 1;
        if (candidate.reason === "refund_due") {
          try {
            const refund = await deps.requestLateRefund(contractId);
            if (refund.ok) summary.refunds_requested += 1;
            else summary.refunds_failed += 1;
            rows.push({
              contract_id: contractId,
              reason: "refund_due",
              refund_ok: refund.ok,
            });
          } catch (refundError) {
            summary.refunds_failed += 1;
            rows.push({
              contract_id: contractId,
              reason: "refund_due",
              error: refundError instanceof Error
                ? refundError.message
                : String(refundError),
            });
          }
          continue;
        }
        const rail: GigRail = candidate.rail === "stripe"
          ? "stripe"
          : "paystack";
        try {
          const { outcome, effects } = await probe({
            kind,
            contractId,
            termsVersion: Number(candidate.terms_version),
            rail,
            reference: typeof candidate.reference === "string"
              ? candidate.reference
              : null,
          }, "gig-hire-reconcile");
          if (outcome.status === "captured") summary.captured += 1;
          else if (outcome.status === "replayed") summary.replayed += 1;
          else if (outcome.status === "late_capture_refund_due") {
            summary.late_capture_refund_due += 1;
            if (effects.refundOk === true) summary.refunds_requested += 1;
            else summary.refunds_failed += 1;
          } else if (outcome.status === "pending") summary.still_pending += 1;
          else if (outcome.status === "not_paid") summary.not_paid += 1;
          else summary.mismatched += 1;
          rows.push({
            contract_id: contractId,
            reason: candidate.reason,
            kind,
            outcome: outcome.status,
          });
        } catch (probeError) {
          summary.errors += 1;
          rows.push({
            contract_id: contractId,
            reason: candidate.reason,
            kind,
            error: probeError instanceof Error
              ? probeError.message
              : String(probeError),
          });
        }
      }
      console.log("[gig-hire] reconcile summary", JSON.stringify(summary));
      return json({ ok: true, ...summary, rows });
    }

    const userDb = deps.userClient(authorization);
    const { data: { user } } = await userDb.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    // Server-built return page; any client return_url is ignored (I-4402-B).
    const returnUrl = (
      brandId: string,
      contractId: string,
      kind: "hold" | "topup",
    ) =>
      gigPaymentReturnUrl({
        origin: deps.webOrigin,
        brandId,
        contractId,
        kind,
      });
    const storeProviderRef = async (
      contractId: string,
      termsVersion: number,
      kind: GigPaymentKind,
      providerRef: string,
    ): Promise<"stored" | "unsupported"> => {
      const { error } = await serviceDb.rpc("gig_hold_set_provider_ref", {
        p_contract_id: contractId,
        p_terms_version: termsVersion,
        p_kind: kind,
        p_provider_ref: providerRef,
      });
      if (!error) return "stored";
      if (isMissingFunction(error)) {
        // [TRANSITIONAL] old SQL before the #4402 migration applies: the
        // reference is still recoverable (deterministic Paystack reference,
        // Stripe idempotency key) — exit once the migration is applied.
        console.warn(
          "[gig-hire] gig_hold_set_provider_ref missing (migration pending)",
        );
        return "unsupported";
      }
      throw new Error(`provider_ref_store_failed:${error.message}`);
    };
    const brandOf = async (
      prepared: Record<string, unknown>,
      contractId: string,
    ) => {
      if (typeof prepared.brand_id === "string") return prepared.brand_id;
      const { data } = await serviceDb.from("gig_contracts").select("brand_id")
        .eq("id", contractId).maybeSingle();
      return String(data?.brand_id ?? "");
    };
    const providerStart = async (
      kind: GigPaymentKind,
      contractId: string,
      termsVersion: number,
      rail: string,
      quote: GigQuote,
      brandId: string,
    ): Promise<Response> => {
      if (rail === "paystack") {
        const reference = gigPaystackReference(kind, contractId, termsVersion);
        // Persist the reference before the provider call (#1793 rule).
        await storeProviderRef(contractId, termsVersion, kind, reference);
        const initInput = {
          contractId,
          termsVersion,
          quote,
          email: user.email ?? `gig+${user.id.slice(0, 8)}@usemingla.com`,
          callbackUrl: returnUrl(
            brandId,
            contractId,
            kind === "gig_topup" ? "topup" : "hold",
          ),
        };
        const initialized = await deps.paystackInitialize(
          kind === "gig_topup"
            ? gigTopupPaystackInitialize(initInput)
            : gigPaystackInitialize(initInput),
        );
        return json({
          ok: true,
          kind: "requires_checkout_redirect",
          contract_id: contractId,
          terms_version: termsVersion,
          rail,
          url: initialized.authorization_url,
          provider_ref: initialized.reference,
          quote,
        });
      }
      const stripe = deps.stripe();
      const intent = await stripe.paymentIntents.create(
        kind === "gig_topup"
          ? gigTopupStripeIntent({ contractId, termsVersion, quote })
          : gigStripeIntent({ contractId, termsVersion, quote }),
        {
          idempotencyKey: `${
            kind === "gig_topup" ? "gig_topup" : "gig_hold"
          }:${contractId}:${termsVersion}`,
        },
      );
      if (!intent.client_secret) {
        return json({ error: "client_secret_missing" }, 502);
      }
      try {
        // The PaymentIntent id is stored before the client can pay it, so
        // reconcile and the webhook can always find it.
        await storeProviderRef(contractId, termsVersion, kind, intent.id);
      } catch (storeError) {
        console.error(
          "[gig-hire] PaymentIntent id not stored; cancelling",
          storeError,
        );
        await stripe.paymentIntents.cancel(intent.id).catch((
          cancelError: unknown,
        ) =>
          console.error("[gig-hire] PaymentIntent cancel failed", cancelError)
        );
        return json({ error: "provider_start_failed" }, 502);
      }
      return json({
        ok: true,
        kind: "requires_payment_sheet",
        contract_id: contractId,
        terms_version: termsVersion,
        rail,
        client_secret: intent.client_secret,
        provider_ref: intent.id,
        quote,
      });
    };

    if (action === "start") {
      const interestId = String(body.interest_id ?? "");
      const clientKey = String(body.idempotency_key ?? "");
      if (!uuid.test(interestId) || clientKey.length < 8) {
        return json({ error: "validation_error" }, 400);
      }
      const feeMinor = Number(body.fee_minor);
      let quote: GigQuote;
      try {
        quote = quoteGig(feeMinor, "NGN");
      } catch (error) {
        return json({
          error: error instanceof Error ? error.message : "invalid_quote",
        }, 400);
      }
      // #4402: before a retry retires an unpaid offer, prove with the
      // provider that it really is unpaid (I-4402-C). A paid one is recorded
      // and the host is sent to it instead of being charged twice.
      try {
        const { data: interest } = await serviceDb.from("gig_interest")
          .select("gig_id,creator_account_id").eq("id", interestId)
          .maybeSingle();
        if (interest) {
          const { data: live } = await serviceDb.from("gig_contracts")
            .select("id,brand_id").eq("gig_id", interest.gig_id)
            .eq("creator_account_id", interest.creator_account_id)
            .eq("state", "offered");
          for (
            const contract of (live ?? []) as Array<
              { id: string; brand_id: string }
            >
          ) {
            const host = await hostOfContract(serviceDb, contract.id, user.id);
            if (!host.ok) continue;
            const target = await ledgerTarget(
              serviceDb,
              contract.id,
              "gig_hold",
            );
            if (!target || target.status !== "pending") continue;
            const { outcome } = await probe(target, "gig-hire-start");
            if (
              outcome.status === "captured" || outcome.status === "replayed"
            ) {
              return json({
                ok: false,
                error: "already_paid",
                contract_id: contract.id,
              }, 409);
            }
            if (outcome.status === "pending") {
              return json({
                ok: false,
                error: "payment_pending",
                contract_id: contract.id,
              }, 409);
            }
            if (outcome.status === "mismatch") {
              return json({
                ok: false,
                error: "payment_mismatch",
                contract_id: contract.id,
              }, 409);
            }
          }
        }
      } catch (probeError) {
        console.error("[gig-hire] start probe failed", probeError);
        return json({ error: "payment_check_failed" }, 503);
      }
      const idempotencyKey = `gig_hold:${interestId}:${clientKey}`.slice(
        0,
        240,
      );
      const { data: prepared, error: prepareError } = await userDb.rpc(
        "gig_offer_prepare",
        {
          p_interest_id: interestId,
          p_terms: {
            ...(typeof body.terms === "object" && body.terms ? body.terms : {}),
            fee_minor: feeMinor,
          },
          p_idempotency_key: idempotencyKey,
        },
      );
      if (prepareError || !prepared) {
        return json({
          error: "offer_prepare_failed",
          detail: prepareError?.message,
        }, prepareError?.code === "42501" ? 403 : 409);
      }
      // Validation failures (gig_full, interest_not_open, already_offered...)
      // come back as {ok:false}; never start a payment for them.
      if (prepared.ok === false) {
        return json({
          error: String(prepared.error),
          field: prepared.field ?? null,
        }, 409);
      }
      quote = quoteGig(Number(prepared.fee_minor), String(prepared.currency));
      const contractId = String(prepared.contract_id);
      const termsVersion = Number(prepared.terms_version);
      try {
        return await providerStart(
          "gig_hold",
          contractId,
          termsVersion,
          String(prepared.rail),
          quote,
          await brandOf(prepared, contractId),
        );
      } catch (error) {
        console.error("[gig-hire] provider start failed", error);
        return json({ error: "provider_start_failed" }, 502);
      }
    }

    if (action === "topup") {
      // A host accepted a higher counter-offer: charge only the difference on
      // the same rail. Same response shapes as "start".
      const contractId = String(body.contract_id ?? "");
      const termsVersion = Number(body.terms_version);
      if (!uuid.test(contractId) || !Number.isInteger(termsVersion)) {
        return json({ error: "validation_error" }, 400);
      }
      const { data: prepared, error: prepareError } = await userDb.rpc(
        "gig_topup_prepare",
        { p_contract_id: contractId, p_terms_version: termsVersion },
      );
      if (prepareError || !prepared) {
        return json(
          { error: "topup_prepare_failed" },
          prepareError?.code === "42501" ? 403 : 409,
        );
      }
      if (prepared.ok === false) {
        return json({ error: String(prepared.error) }, 409);
      }
      const quote: GigQuote = {
        feeMinor: Number(prepared.fee_minor),
        bookingFeeMinor: Number(prepared.booking_fee_minor),
        totalMinor: Number(prepared.total_minor),
        currency: String(prepared.currency),
      };
      if (!Number.isSafeInteger(quote.totalMinor) || quote.totalMinor <= 0) {
        return json({ error: "topup_amount_invalid" }, 409);
      }
      try {
        return await providerStart(
          "gig_topup",
          contractId,
          termsVersion,
          String(prepared.rail),
          quote,
          await brandOf(prepared, contractId),
        );
      } catch (error) {
        console.error("[gig-hire] topup start failed", error);
        return json({ error: "provider_start_failed" }, 502);
      }
    }

    if (action === "confirm" || action === "confirm_reference") {
      // Resolve which ledger row the caller is asking about.
      let target: GigProbeTarget | null = null;
      let settled = false;
      try {
        const reference = typeof body.reference === "string"
          ? body.reference
          : action === "confirm" && typeof body.provider_ref === "string"
          ? body.provider_ref
          : "";
        const parsed = reference ? parseGigReference(reference) : null;
        if (parsed) {
          target = { ...parsed, rail: "paystack", reference };
        } else if (reference.startsWith("pi_")) {
          const contractId = String(body.contract_id ?? "");
          if (!uuid.test(contractId)) {
            return json({ error: "validation_error" }, 400);
          }
          const row = await ledgerTarget(serviceDb, contractId);
          if (!row || row.rail !== "stripe") {
            return json({ error: "validation_error" }, 400);
          }
          target = { ...row, reference };
          settled = SETTLED.has(row.status);
        } else if (!reference && uuid.test(String(body.contract_id ?? ""))) {
          const kind = isGigPaymentKind(body.kind) ? body.kind : undefined;
          const row = await ledgerTarget(
            serviceDb,
            String(body.contract_id),
            kind,
          );
          if (!row) return json({ error: "validation_error" }, 400);
          target = row;
          settled = SETTLED.has(row.status);
        } else {
          return json({ error: "validation_error" }, 400);
        }
        if (
          action === "confirm" &&
          (String(body.contract_id ?? "") !== target.contractId ||
            Number(body.terms_version) !== target.termsVersion)
        ) return json({ error: "payment_not_proven" }, 409);
        const host = await hostOfContract(
          serviceDb,
          target.contractId,
          user.id,
        );
        if (!host.ok) return json({ error: "forbidden" }, 403);
      } catch (lookupError) {
        console.error("[gig-hire] confirm lookup failed", lookupError);
        return json({ error: "payment_confirm_failed" }, 502);
      }
      if (settled) {
        return json({ ok: true, status: "replayed", payment_check: "paid" });
      }
      try {
        const { outcome } = await probe(target, `gig-hire-${action}`);
        const answer = paymentCheckAnswer(outcome);
        // Old builds read a non-2xx as "not proven" and offer to check again.
        if (action === "confirm" && answer.ok !== true) {
          return json({
            ...answer,
            error: outcome.status === "pending"
              ? "payment_not_proven"
              : answer.error,
          }, 409);
        }
        return json(answer);
      } catch (probeError) {
        console.error("[gig-hire] payment check failed", probeError);
        return json({ error: "payment_check_failed" }, 502);
      }
    }
    return json({ error: "unknown_action" }, 400);
  };
}
