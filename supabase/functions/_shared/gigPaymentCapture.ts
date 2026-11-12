/**
 * #4402 — the one capture core for creator-hire payments (gig holds and
 * counter-offer top-ups), on both rails.
 *
 * Every recorder goes through here: gig-hire `confirm` / `confirm_reference`,
 * the hire `start` probe, `reconcile`, gig-timers, and the Paystack and Stripe
 * webhooks. Before #4402 the only recorder was the Host sheet's in-memory
 * button, so a closed tab left a real charge unrecorded.
 *
 * MINGLA-INVARIANT: I-4402-D | issue #4402 | a gig capture verifies amount, currency, contract and terms version against the ledger row before marking captured
 *
 * The store is injected so the decision logic is tested without a database.
 * Provider calls are never made here: callers pass the verified provider
 * object (Paystack verify `data`, a retrieved Stripe PaymentIntent).
 */

// @ts-ignore — Deno ESM import; types resolved at runtime
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { writeAudit } from "./audit.ts";
import { resolveAlertRecipientValue } from "./secretBundle.ts";
import {
  type OpsAlertEmailInput,
  type OpsAlertEmailResult,
  sendOpsAlertEmail,
} from "./stripeOpsAlertEmail.ts";

export type GigPaymentKind = "gig_hold" | "gig_topup";
export type GigRail = "stripe" | "paystack";

export interface ParsedGigReference {
  kind: GigPaymentKind;
  contractId: string;
  termsVersion: number;
}

const GIG_REFERENCE = /^(ghold|gtop)_([0-9a-f]{32})_v([1-9][0-9]{0,5})$/;

/** Parse a deterministic Paystack gig reference; anything else is null. */
export function parseGigReference(
  reference: string,
): ParsedGigReference | null {
  if (typeof reference !== "string") return null;
  const match = GIG_REFERENCE.exec(reference);
  if (!match) return null;
  const hex = match[2];
  const contractId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${
    hex.slice(12, 16)
  }-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return {
    kind: match[1] === "ghold" ? "gig_hold" : "gig_topup",
    contractId,
    termsVersion: Number(match[3]),
  };
}

/** The deterministic Paystack reference (the same one gigMoney initializes). */
export function gigPaystackReference(
  kind: GigPaymentKind,
  contractId: string,
  termsVersion: number,
): string {
  return `${kind === "gig_topup" ? "gtop" : "ghold"}_${
    contractId.replaceAll("-", "").toLowerCase()
  }_v${termsVersion}`;
}

export function isGigPaymentKind(value: unknown): value is GigPaymentKind {
  return value === "gig_hold" || value === "gig_topup";
}

export interface GigLedgerRow {
  amountMinor: number;
  currency: string;
  rail: GigRail;
  status: string;
  providerRef: string | null;
}

export interface GigMarkResult {
  replayed: boolean;
  lateCapture: boolean;
}

export interface GigCaptureStore {
  loadLedger(
    kind: GigPaymentKind,
    contractId: string,
    termsVersion: number,
  ): Promise<GigLedgerRow | null>;
  markCaptured(
    kind: GigPaymentKind,
    contractId: string,
    termsVersion: number,
    providerRef: string,
  ): Promise<GigMarkResult>;
}

export type GigMismatchReason =
  | "reference_invalid"
  | "metadata_mismatch"
  | "ledger_row_missing"
  | "rail_mismatch"
  | "amount_mismatch"
  | "currency_mismatch"
  | "provider_ref_mismatch"
  | "hold_not_pending";

export interface GigTarget {
  kind: GigPaymentKind;
  contractId: string;
  termsVersion: number;
}

export type GigCaptureOutcome =
  | ({ status: "captured" } & GigTarget)
  | ({ status: "replayed" } & GigTarget)
  | ({ status: "late_capture_refund_due" } & GigTarget)
  | ({ status: "mismatch"; reason: GigMismatchReason } & Partial<GigTarget>)
  | ({ status: "pending"; providerStatus: string } & Partial<GigTarget>)
  | ({ status: "not_paid"; providerStatus: string } & Partial<GigTarget>);

/** Map a capture RPC error to a mismatch reason, or null when it is transient. */
export function gigCaptureErrorReason(
  message: string,
): GigMismatchReason | null {
  if (/hold_provider_mismatch/.test(message)) return "provider_ref_mismatch";
  if (/hold_not_pending|topup_not_pending/.test(message)) {
    return "hold_not_pending";
  }
  if (/hold_not_found|topup_not_found|contract_not_found/.test(message)) {
    return "ledger_row_missing";
  }
  return null;
}

async function verifyAndMark(
  store: GigCaptureStore,
  target: GigTarget,
  rail: GigRail,
  amount: number,
  currency: string,
  providerRef: string,
): Promise<GigCaptureOutcome> {
  const ledger = await store.loadLedger(
    target.kind,
    target.contractId,
    target.termsVersion,
  );
  if (!ledger) {
    return { status: "mismatch", reason: "ledger_row_missing", ...target };
  }
  if (ledger.rail !== rail) {
    return { status: "mismatch", reason: "rail_mismatch", ...target };
  }
  if (!Number.isSafeInteger(amount) || amount !== Number(ledger.amountMinor)) {
    return { status: "mismatch", reason: "amount_mismatch", ...target };
  }
  if (
    currency.toUpperCase() !== String(ledger.currency).toUpperCase() ||
    (rail === "paystack" && currency.toUpperCase() !== "NGN")
  ) {
    return { status: "mismatch", reason: "currency_mismatch", ...target };
  }
  let marked: GigMarkResult;
  try {
    marked = await store.markCaptured(
      target.kind,
      target.contractId,
      target.termsVersion,
      providerRef,
    );
  } catch (error) {
    const reason = gigCaptureErrorReason(
      error instanceof Error ? error.message : String(error),
    );
    if (reason) return { status: "mismatch", reason, ...target };
    throw error;
  }
  if (marked.lateCapture) {
    return { status: "late_capture_refund_due", ...target };
  }
  return marked.replayed
    ? { status: "replayed", ...target }
    : { status: "captured", ...target };
}

function metadataOf(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** A verified Paystack transaction (verify `data`) for a gig reference. */
export async function captureGigPaystackCharge(
  store: GigCaptureStore,
  reference: string,
  txn: Record<string, unknown>,
): Promise<GigCaptureOutcome> {
  const parsed = parseGigReference(reference);
  if (!parsed) return { status: "mismatch", reason: "reference_invalid" };
  const providerStatus = String(txn?.status ?? "").toLowerCase();
  if (providerStatus !== "success") {
    return ["failed", "abandoned", "reversed"].includes(providerStatus)
      ? { status: "not_paid", providerStatus, ...parsed }
      : { status: "pending", providerStatus, ...parsed };
  }
  const metadata = metadataOf(txn?.metadata);
  if (
    String(metadata.mingla_kind ?? "") !== parsed.kind ||
    String(metadata.contract_id ?? "") !== parsed.contractId ||
    String(metadata.terms_version ?? "") !== String(parsed.termsVersion)
  ) return { status: "mismatch", reason: "metadata_mismatch", ...parsed };
  return await verifyAndMark(
    store,
    parsed,
    "paystack",
    Number(txn?.amount ?? NaN),
    String(txn?.currency ?? ""),
    reference,
  );
}

export interface GigStripeIntentLike {
  id?: string;
  status?: string;
  amount?: number;
  currency?: string;
  metadata?: Record<string, string> | null;
}

/** A retrieved (or webhook) Stripe PaymentIntent for a gig. */
export async function captureGigStripeIntent(
  store: GigCaptureStore,
  pi: GigStripeIntentLike,
  expected?: Partial<GigTarget>,
): Promise<GigCaptureOutcome> {
  const metadata = pi?.metadata ?? {};
  const kind = metadata.mingla_kind;
  const termsVersion = Number(metadata.terms_version);
  const contractId = String(metadata.contract_id ?? "");
  if (
    !isGigPaymentKind(kind) || !/^[0-9a-f-]{36}$/i.test(contractId) ||
    !Number.isInteger(termsVersion) || termsVersion < 1 || !pi?.id
  ) return { status: "mismatch", reason: "metadata_mismatch", ...expected };
  const target: GigTarget = { kind, contractId, termsVersion };
  if (
    expected &&
    ((expected.contractId !== undefined &&
      expected.contractId !== contractId) ||
      (expected.termsVersion !== undefined &&
        expected.termsVersion !== termsVersion) ||
      (expected.kind !== undefined && expected.kind !== kind))
  ) return { status: "mismatch", reason: "metadata_mismatch", ...expected };
  const providerStatus = String(pi.status ?? "");
  if (providerStatus !== "succeeded") {
    return providerStatus === "processing"
      ? { status: "pending", providerStatus, ...target }
      : { status: "not_paid", providerStatus, ...target };
  }
  return await verifyAndMark(
    store,
    target,
    "stripe",
    Number(pi.amount ?? NaN),
    String(pi.currency ?? ""),
    pi.id,
  );
}

/** The Supabase-backed store (service role). */
export function supabaseGigCaptureStore(db: SupabaseClient): GigCaptureStore {
  return {
    async loadLedger(kind, contractId, termsVersion) {
      const base = kind === "gig_topup"
        ? db.from("gig_hold_adjustments")
          .select("amount_minor,currency,rail,status,provider_ref")
          .eq("contract_id", contractId).eq("terms_version", termsVersion)
          .eq("kind", "topup").order("created_at", { ascending: false })
          .limit(1)
        : db.from("gig_holds")
          .select("amount_minor,currency,rail,status,provider_ref")
          .eq("contract_id", contractId).eq("terms_version", termsVersion)
          .limit(1);
      const { data, error } = await base.maybeSingle();
      if (error) throw new Error(`gig_ledger_read_failed:${error.message}`);
      if (!data) return null;
      return {
        amountMinor: Number(data.amount_minor),
        currency: String(data.currency),
        rail: data.rail === "stripe" ? "stripe" : "paystack",
        status: String(data.status),
        providerRef: typeof data.provider_ref === "string"
          ? data.provider_ref
          : null,
      };
    },
    async markCaptured(kind, contractId, termsVersion, providerRef) {
      const { data, error } = await db.rpc(
        kind === "gig_topup"
          ? "gig_topup_mark_captured"
          : "gig_hold_mark_captured",
        {
          p_contract_id: contractId,
          p_terms_version: termsVersion,
          p_provider_ref: providerRef,
        },
      );
      if (error) throw new Error(String(error.message ?? "gig_capture_failed"));
      const row = (data ?? {}) as Record<string, unknown>;
      return {
        replayed: row.replayed === true,
        lateCapture: row.late_capture === true,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Probe: ask the provider about one ledger row, then capture through the core.
// ---------------------------------------------------------------------------
export type PaystackProbeOutcome =
  | { state: "success"; txn: Record<string, unknown> }
  | { state: "failed"; txn: Record<string, unknown> }
  | { state: "pending"; txn: Record<string, unknown> | null }
  | { state: "not_found" };

export interface GigProbeDeps {
  store: GigCaptureStore;
  paystackVerifyOutcome: (reference: string) => Promise<PaystackProbeOutcome>;
  stripeRetrieve: (paymentIntentId: string) => Promise<GigStripeIntentLike>;
}

export interface GigProbeTarget extends GigTarget {
  rail: GigRail;
  /** Paystack: the deterministic reference (derived when null). Stripe: the stored PaymentIntent id. */
  reference: string | null;
}

/**
 * Provider truth for one hold or top-up. `not_paid` is the only answer that
 * proves nothing was taken; provider errors throw (the caller must then leave
 * the row alone, never retire it).
 */
export async function probeGigPayment(
  deps: GigProbeDeps,
  target: GigProbeTarget,
): Promise<GigCaptureOutcome> {
  const base: GigTarget = {
    kind: target.kind,
    contractId: target.contractId,
    termsVersion: target.termsVersion,
  };
  if (target.rail === "paystack") {
    const reference = target.reference ??
      gigPaystackReference(target.kind, target.contractId, target.termsVersion);
    const verified = await deps.paystackVerifyOutcome(reference);
    if (verified.state === "not_found") {
      return { status: "not_paid", providerStatus: "not_found", ...base };
    }
    if (verified.state === "failed") {
      return {
        status: "not_paid",
        providerStatus: String(verified.txn?.status ?? "failed"),
        ...base,
      };
    }
    if (verified.state === "pending") {
      return {
        status: "pending",
        providerStatus: String(verified.txn?.status ?? "pending"),
        ...base,
      };
    }
    const outcome = await captureGigPaystackCharge(
      deps.store,
      reference,
      verified.txn,
    );
    return outcome;
  }
  if (!target.reference) {
    // No PaymentIntent was ever stored for this row: gig-hire stores the id
    // before it hands out the client secret, so none could have been paid.
    return { status: "not_paid", providerStatus: "no_intent", ...base };
  }
  const pi = await deps.stripeRetrieve(target.reference);
  return await captureGigStripeIntent(deps.store, pi, base);
}

/** Audit, alert and refund side effects of a capture outcome (never throws on alert). */
export async function applyGigOutcomeEffects(
  db: SupabaseClient,
  outcome: GigCaptureOutcome,
  ctx: {
    source: string;
    rail: GigRail;
    reference: string;
    notifyMismatch?: (input: GigMismatchAlertInput) => Promise<number>;
    requestLateRefund?: (contractId: string) => Promise<{ ok: boolean }>;
  },
): Promise<{ refundRequested: boolean; refundOk: boolean | null }> {
  // Audit rows are evidence, not control flow: a failed write is logged and
  // never undoes a recorded capture.
  const safely = async (write: () => Promise<void>) => {
    try {
      await write();
    } catch (error) {
      console.error(
        "[gig-payment] audit write failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  };
  if (outcome.status === "captured") {
    const contractId = outcome.contractId;
    await safely(() =>
      writeAudit(db, {
        user_id: null,
        brand_id: null,
        action: "gig.payment_captured",
        target_type: "gig_contract",
        target_id: contractId,
        after: {
          reference: ctx.reference,
          kind: outcome.kind,
          source: ctx.source,
        },
      })
    );
  } else if (outcome.status === "late_capture_refund_due") {
    const contractId = outcome.contractId;
    await safely(() =>
      writeAudit(db, {
        user_id: null,
        brand_id: null,
        action: "gig.payment_late_refund_due",
        target_type: "gig_contract",
        target_id: contractId,
        after: {
          reference: ctx.reference,
          kind: outcome.kind,
          source: ctx.source,
        },
      })
    );
    if (ctx.requestLateRefund) {
      try {
        const refund = await ctx.requestLateRefund(outcome.contractId);
        return { refundRequested: true, refundOk: refund.ok };
      } catch (error) {
        console.error(
          "[gig-payment] late refund request failed",
          error instanceof Error ? error.message : String(error),
        );
        return { refundRequested: true, refundOk: false };
      }
    }
  } else if (outcome.status === "mismatch") {
    const reason = outcome.reason;
    const targetId = outcome.contractId ?? ctx.reference;
    await safely(() =>
      writeAudit(db, {
        user_id: null,
        brand_id: null,
        action: "gig.payment_capture_mismatch",
        target_type: "gig_contract",
        target_id: targetId,
        after: { reason, reference: ctx.reference, source: ctx.source },
      })
    );
    await (ctx.notifyMismatch ??
      ((input: GigMismatchAlertInput) => notifyGigPaymentMismatch(input)))({
        rail: ctx.rail,
        source: ctx.source,
        reference: ctx.reference,
        reason: outcome.reason,
        contractId: outcome.contractId ?? null,
      });
  }
  return { refundRequested: false, refundOk: null };
}

// ---------------------------------------------------------------------------
// Alerts: a gig payment that cannot be matched is never silent. Recipients
// come from the existing Stripe webhook failure list (Seth, 12 Nov): no new
// secret or bundle field.
// ---------------------------------------------------------------------------
export interface GigMismatchAlertInput {
  rail: GigRail;
  source: string;
  reference: string;
  reason: GigMismatchReason;
  contractId?: string | null;
}

/** The existing Stripe webhook failure list (MINGLA_ALERT_RECIPIENTS_JSON first). */
export function gigAlertRecipients(): string[] {
  const value = resolveAlertRecipientValue(
    "stripe_webhook_failures",
    "STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS",
  );
  const list = Array.isArray(value) ? value : String(value ?? "").split(",");
  return list.map((entry) => String(entry).trim()).filter(Boolean);
}

/** Email the ops list. Never throws; returns how many sends succeeded. */
export async function notifyGigPaymentMismatch(
  input: GigMismatchAlertInput,
  send: (input: OpsAlertEmailInput) => Promise<OpsAlertEmailResult> =
    sendOpsAlertEmail,
  recipients: () => string[] = gigAlertRecipients,
): Promise<number> {
  try {
    const to = recipients();
    if (to.length === 0) {
      console.error("[gig-payment] mismatch alert has no recipients", input);
      return 0;
    }
    const result = await send({
      subject: "Creator hire payment could not be matched",
      paragraphs: [
        "A creator-hire payment was taken by the payment provider but did not match what Mingla charged, so it was not recorded automatically.",
        `Rail: ${input.rail}`,
        `Seen by: ${input.source}`,
        `Reason: ${input.reason}`,
        `Reference: ${input.reference}`,
        `Contract: ${input.contractId ?? "(unknown)"}`,
        "Action: check the payment in the provider dashboard and the contract's hold, then record or refund it.",
      ],
      recipients: to,
      idempotencyKey: `gig_mismatch:${input.reference}:${input.reason}`,
    });
    return result.succeeded;
  } catch (error) {
    console.error(
      "[gig-payment] mismatch alert failed",
      error instanceof Error ? error.message : String(error),
    );
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Late payments: ask gig-refund for the automatic full refund. Callers pass
// the project URL and the service-role key (no env reads here).
// ---------------------------------------------------------------------------
export async function requestGigLateRefund(
  contractId: string,
  deps: { supabaseUrl: string; serviceKey: string; fetchImpl?: typeof fetch },
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await (deps.fetchImpl ?? fetch)(
    `${deps.supabaseUrl}/functions/v1/gig-refund`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${deps.serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ contract_id: contractId, branch: "payment_late" }),
    },
  );
  return {
    ok: response.ok,
    status: response.status,
    body: await response.json().catch(() => null),
  };
}
