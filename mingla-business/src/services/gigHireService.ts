import { postHogService } from "./postHogService";
import { supabase } from "./supabase";

// #3872 — the Host pays a creator fee through edge `gig-hire`. `start` and
// `topup` answer the same shapes; `confirm` proves the provider took the money.
// #4402 — the server builds the Paystack return page (no client return_url),
// and `confirm_reference` checks one hold or top-up with the provider.

export type GigQuote = {
  fee_minor?: number;
  booking_fee_minor?: number;
  total_minor?: number;
  currency: string;
} & Record<string, unknown>;

export type GigHireStart =
  | {
      ok: true;
      kind: "requires_payment_sheet";
      contract_id: string;
      terms_version: number;
      rail: string;
      client_secret: string;
      provider_ref: string;
      quote: GigQuote;
    }
  | {
      ok: true;
      kind: "requires_checkout_redirect";
      contract_id: string;
      terms_version: number;
      rail: string;
      url: string;
      provider_ref: string;
      quote: GigQuote;
    };

/** What the server knows about a payment (#4402). Only `not_paid` means nothing was taken. */
export type GigPaymentCheck =
  | "paid"
  | "pending"
  | "not_paid"
  | "mismatch"
  | "refunded";

export type GigHireFailure = {
  ok: false;
  error: string;
  /** The offer a refused start points at (already_paid / payment_pending). */
  contract_id?: string;
  brand_id?: string;
  payment_check?: GigPaymentCheck;
};

const PAYMENT_CHECKS: readonly string[] = [
  "paid",
  "pending",
  "not_paid",
  "mismatch",
  "refunded",
];

function failureFrom(value: Record<string, unknown> | null): GigHireFailure {
  const failure: GigHireFailure = {
    ok: false,
    error:
      typeof value?.error === "string" ? value.error : "provider_start_failed",
  };
  if (typeof value?.contract_id === "string")
    failure.contract_id = value.contract_id;
  if (typeof value?.brand_id === "string") failure.brand_id = value.brand_id;
  if (
    typeof value?.payment_check === "string" &&
    PAYMENT_CHECKS.includes(value.payment_check)
  )
    failure.payment_check = value.payment_check as GigPaymentCheck;
  return failure;
}

/** Edge non-2xx answers arrive as a FunctionsHttpError whose body has `{error}`. */
async function invokeGigHire<T>(
  body: Record<string, unknown>,
): Promise<T | GigHireFailure> {
  const { data, error } = await supabase.functions.invoke("gig-hire", { body });
  if (error) {
    const context = (error as { context?: unknown }).context as
      Response | undefined;
    if (context && typeof context.json === "function") {
      try {
        const parsed = (await context.json()) as Record<string, unknown> | null;
        if (typeof parsed?.error === "string") return failureFrom(parsed);
      } catch {
        // fall through to the generic code
      }
    }
    return { ok: false, error: "provider_start_failed" };
  }
  const value = data as Record<string, unknown> | null;
  if (!value || value.ok === false || typeof value.error === "string") {
    return failureFrom(value);
  }
  return data as T;
}

export async function startGigHire(input: {
  interestId: string;
  feeMinor: number;
  terms?: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<GigHireStart | GigHireFailure> {
  const result = await invokeGigHire<GigHireStart>({
    action: "start",
    interest_id: input.interestId,
    fee_minor: input.feeMinor,
    terms: input.terms ?? {},
    idempotency_key: input.idempotencyKey,
  });
  if (result.ok)
    postHogService.capture("gig_hired", {
      rail: typeof result.rail === "string" ? result.rail : "unknown",
    });
  return result;
}

/** Counter-offer accepted at a higher fee: pay the difference on the same rail. */
export function startGigTopup(input: {
  contractId: string;
  termsVersion: number;
}): Promise<GigHireStart | GigHireFailure> {
  return invokeGigHire<GigHireStart>({
    action: "topup",
    contract_id: input.contractId,
    terms_version: input.termsVersion,
  });
}

/**
 * #4402 — ask the server what happened to one payment and record it if the
 * provider took it. Pass the provider reference (Paystack return, the hire
 * sheet) or just the contract (the contract page's own check).
 */
export function confirmGigReference(input: {
  contractId?: string;
  reference?: string | null;
}): Promise<
  | {
      ok: true;
      status: string;
      payment_check: GigPaymentCheck;
      brand_id?: string;
      contract_id?: string;
    }
  | GigHireFailure
> {
  return invokeGigHire({
    action: "confirm_reference",
    ...(input.reference ? { reference: input.reference } : {}),
    ...(input.contractId ? { contract_id: input.contractId } : {}),
  });
}
