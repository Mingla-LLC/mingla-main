/**
 * paystackOrganiserRelease — Issue #1177 (sub-issue H of #1013).
 *
 * The organiser twin of paystackPartnerSplits.handlePaystackTransferEvent. That
 * handler is E-owned and keyed on `psplit_` references (DO-NOT-TOUCH); this NEW
 * sibling routes ONLY organiser payout transfer references
 * `bprel_<release_id>_c<chunk_index>_a<attempt>` and no-ops on everything else,
 * so the two handlers can both be dispatched on every `transfer.*` event.
 *
 * transfer.success  → record the leg succeeded + reconcile the actual fee (fee
 *                     variance nets forward append-only; missing fee ⇒
 *                     fee_unreconciled, never a silent Mingla charge). When the
 *                     last organiser leg reconciles, the release finalizes
 *                     'released' with organiser_cash_delivered_cents = Σ chunk
 *                     principals.
 * transfer.failed   → definitive-for-THIS-code guard identical to E's stale-code
 *                     defense: only fail when the event's transfer_code matches
 *                     the leg's CURRENT code AND the event attempt matches the
 *                     leg's attempt. Bump/clear so the reconcile-first sweep
 *                     re-initiates with the bumped reference; cap → failed + alert.
 * transfer.reversed → credit ONLY the returned principal; reduce
 *                     organiser_cash_delivered_cents accordingly.
 *
 * All RPCs are leg-id keyed and idempotent, so a replayed webhook is safe.
 *
 * Paystack docs: https://paystack.com/docs/api/transfer/ (transfer object,
 * status/transfer_code/amount/fee fields).
 */

// @ts-ignore — Deno ESM
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parsePaystackTransferCost } from "../payout-release-sweep/engine.ts";
import {
  paystackFetchTransfer,
  paystackGetBalance,
  paystackInitiateTransfer,
  paystackVerifyTransferByReference,
} from "./paystack.ts";

/**
 * The organiser payout rail's Paystack transfer client. Kept in _shared (like
 * _shared/stripe.ts's createStripeReleasePayout) so the raw provider calls never
 * live in the sweep source — the DARK-sweep source guard (#1171) forbids a
 * `paystackInitiateTransfer(` call inside payout-release-sweep/**. The sweep
 * injects this factory via deps and gates it behind PAYOUT_RELEASE_EXECUTE.
 */
export type PaystackReleaseClient = {
  getBalance: () => Promise<Array<{ currency: string; balance: number }>>;
  fetchTransfer: (transferCode: string) => Promise<Record<string, unknown>>;
  verifyTransferByReference: (
    reference: string,
  ) => Promise<Record<string, unknown>>;
  initiateTransfer: (input: {
    amountSubunits: number;
    recipientCode: string;
    reference: string;
    reason: string;
  }) => Promise<Record<string, unknown>>;
};

export function defaultPaystackReleaseClient(): PaystackReleaseClient {
  return {
    getBalance: () => paystackGetBalance(),
    fetchTransfer: (code) => paystackFetchTransfer(code),
    verifyTransferByReference: (ref) => paystackVerifyTransferByReference(ref),
    initiateTransfer: async (input) => {
      const result = await paystackInitiateTransfer(input);
      return {
        transfer_code: result.transfer_code,
        status: result.status,
        reference: result.reference,
      };
    },
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORGANISER_REF_RE = /^bprel_(.+)_c(\d+)_a(\d+)$/;
const MAX_ATTEMPTS = 10;

type OrganiserLegRow = {
  id: string;
  status: string;
  attempt_count: number;
  provider_transfer_code: string | null;
};

/**
 * Route a `transfer.*` webhook to the organiser payout rail. Non-`bprel_`
 * references (partner `psplit_` transfers or any future transfer) are a no-op.
 */
export async function handlePaystackOrganiserTransferEvent(
  supabase: SupabaseClient,
  eventName: string,
  data: Record<string, unknown>,
): Promise<void> {
  const reference = typeof data?.reference === "string" ? data.reference : "";
  const match = reference.match(ORGANISER_REF_RE);
  if (!match) return;
  const releaseId = match[1];
  const chunkIndex = Number(match[2]);
  const eventAttempt = Number(match[3]);
  if (!UUID_RE.test(releaseId) || !Number.isInteger(chunkIndex)) return;

  const { data: legRow, error } = await supabase
    .from("payout_transfer_legs")
    .select("id, status, attempt_count, provider_transfer_code")
    .eq("release_id", releaseId)
    .eq("kind", "organiser")
    .eq("chunk_index", chunkIndex)
    .maybeSingle();
  if (error) {
    throw new Error(
      `organiser transfer-leg lookup failed: ${error.message}`,
    );
  }
  if (!legRow) return;
  const leg = legRow as OrganiserLegRow;

  const eventTransferCode = typeof data?.transfer_code === "string"
    ? data.transfer_code
    : null;

  if (eventName === "transfer.success") {
    // Idempotent — record_ only flips a non-terminal leg; reconcile_ only posts
    // its adjustment once (idempotency_key UNIQUE) and finalizes the release
    // once every leg is succeeded + reconciled.
    const { error: recErr } = await supabase.rpc(
      "record_paystack_transfer_leg_outcome",
      {
        p_leg_id: leg.id,
        p_release_id: releaseId,
        p_outcome: "succeeded",
        p_transfer_code: eventTransferCode,
        p_reference: reference,
        p_error: null,
      },
    );
    if (recErr) {
      throw new Error(`organiser transfer.success record failed: ${recErr.message}`);
    }
    const cost = parsePaystackTransferCost(data);
    const { error: feeErr } = await supabase.rpc(
      "reconcile_paystack_transfer_leg_fee",
      {
        p_leg_id: leg.id,
        p_actual_fee_cents: cost?.actualFeeCents ?? null,
        p_actual_stamp_cents: cost?.actualStampCents ?? null,
      },
    );
    if (feeErr) {
      throw new Error(`organiser transfer.success reconcile failed: ${feeErr.message}`);
    }
    return;
  }

  if (eventName === "transfer.failed") {
    // Only a DEFINITIVE failure of the leg's CURRENT in-flight transfer burns
    // the attempt (P1-1331-STALE-TRANSFER-CODE, mirrored for the organiser rail).
    if (leg.status !== "in_flight") return; // late/duplicate on a settled leg
    if (
      eventTransferCode !== null && leg.provider_transfer_code !== null &&
      eventTransferCode !== leg.provider_transfer_code
    ) {
      return; // stale event for an older attempt
    }
    if (Number.isInteger(eventAttempt) && eventAttempt !== leg.attempt_count) {
      return; // stale event by reference attempt
    }
    const reason = typeof data?.reason === "string"
      ? data.reason
      : (typeof data?.message === "string" ? data.message : "transfer.failed");
    const { error: failErr } = await supabase.rpc(
      "record_paystack_transfer_leg_outcome",
      {
        p_leg_id: leg.id,
        p_release_id: releaseId,
        p_outcome: "definitive_error",
        p_transfer_code: eventTransferCode,
        p_reference: reference,
        p_error: reason.slice(0, 1000),
      },
    );
    if (failErr) {
      throw new Error(`organiser transfer.failed record failed: ${failErr.message}`);
    }
    return;
  }

  if (eventName === "transfer.reversed") {
    const amount = Number(data?.amount);
    const returned = Number.isInteger(amount) && amount > 0 ? amount : 0;
    const { error: revErr } = await supabase.rpc(
      "reverse_paystack_transfer_leg",
      {
        p_leg_id: leg.id,
        p_returned_principal_cents: returned,
      },
    );
    if (revErr) {
      throw new Error(`organiser transfer.reversed record failed: ${revErr.message}`);
    }
    return;
  }
}

export const ORGANISER_TRANSFER_MAX_ATTEMPTS = MAX_ATTEMPTS;
