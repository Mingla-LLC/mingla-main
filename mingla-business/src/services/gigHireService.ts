import { postHogService } from "./postHogService";
import { supabase } from "./supabase";

// #3872 — the Host pays a creator fee through edge `gig-hire`. `start` and
// `topup` answer the same shapes; `confirm` proves the provider took the money.

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

export type GigHireFailure = { ok: false; error: string };

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
        const parsed = (await context.json()) as { error?: unknown };
        if (typeof parsed?.error === "string")
          return { ok: false, error: parsed.error };
      } catch {
        // fall through to the generic code
      }
    }
    return { ok: false, error: "provider_start_failed" };
  }
  const value = data as { ok?: boolean; error?: unknown } | null;
  if (!value || value.ok === false || typeof value.error === "string") {
    return {
      ok: false,
      error:
        typeof value?.error === "string"
          ? value.error
          : "provider_start_failed",
    };
  }
  return data as T;
}

export async function startGigHire(input: {
  interestId: string;
  feeMinor: number;
  returnUrl?: string;
  terms?: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<GigHireStart | GigHireFailure> {
  const result = await invokeGigHire<GigHireStart>({
    action: "start",
    interest_id: input.interestId,
    fee_minor: input.feeMinor,
    return_url: input.returnUrl ?? null,
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
  returnUrl?: string;
}): Promise<GigHireStart | GigHireFailure> {
  return invokeGigHire<GigHireStart>({
    action: "topup",
    contract_id: input.contractId,
    terms_version: input.termsVersion,
    return_url: input.returnUrl ?? null,
  });
}

export function confirmGigHire(input: {
  contractId: string;
  termsVersion: number;
  rail: string;
  providerRef: string;
}): Promise<{ ok: true } | GigHireFailure> {
  return invokeGigHire<{ ok: true }>({
    action: "confirm",
    contract_id: input.contractId,
    terms_version: input.termsVersion,
    rail: input.rail,
    provider_ref: input.providerRef,
  });
}
