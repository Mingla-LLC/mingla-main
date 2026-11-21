/** Issue #4522 — anonymous balance-link client. The URL token is the credential. */
import {
  decodeTripBalance,
  type TripBalanceProvider,
  type TripBalanceView,
} from "@mingla/offering-rendering/tripBalance";

import { supabase } from "./supabase";

export type TripBalanceStart =
  | {
    kind: "stripe";
    amountMinor: number;
    clientSecret: string;
    paymentIntentId: string;
    stripeAccountId: string;
    publishableKey: string;
  }
  | { kind: "redirect"; url: string }
  | { kind: "paystack_saved_card"; outcome: string; amountMinor: number };

export class TripBalancePayError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly detail: string | null;

  constructor(
    code: string,
    status: number | null = null,
    detail: string | null = null,
  ) {
    super(code);
    this.name = "TripBalancePayError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

async function invokeError(error: unknown): Promise<TripBalancePayError> {
  const context = isRecord(error) ? error.context : null;
  const status = isRecord(context) && typeof context.status === "number"
    ? context.status
    : null;
  if (isRecord(context) && typeof context.json === "function") {
    try {
      const body = await (context.json as () => Promise<unknown>)();
      if (isRecord(body) && typeof body.error === "string") {
        return new TripBalancePayError(
          body.error,
          status,
          typeof body.detail === "string" ? body.detail : null,
        );
      }
    } catch {
      // Keep the transport status when the body was already consumed.
    }
  }
  return new TripBalancePayError("request_failed", status);
}

function decodeView(value: unknown): TripBalanceView {
  if (!isRecord(value)) throw new TripBalancePayError("invalid_response");
  const state = value.state;
  if (state !== "payable" && state !== "paid" && state !== "no_longer_due") {
    throw new TripBalancePayError("invalid_response");
  }
  const balance = value.balance === null
    ? null
    : decodeTripBalance(value.balance);
  if (value.balance !== null && balance === null) {
    throw new TripBalancePayError("invalid_response");
  }
  const provider: TripBalanceProvider | undefined =
    value.provider === "stripe" || value.provider === "paystack"
      ? value.provider
      : undefined;
  return {
    state,
    balance,
    ...(typeof value.tripTitle === "string"
      ? { tripTitle: value.tripTitle }
      : {}),
    ...(typeof value.brandName === "string"
      ? { brandName: value.brandName }
      : {}),
    ...(provider ? { provider } : {}),
    ...(typeof value.savedCardLast4 === "string" &&
        /^[0-9]{4}$/.test(value.savedCardLast4)
      ? { savedCardLast4: value.savedCardLast4 }
      : {}),
  };
}

async function invoke(
  token: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("trip-balance-pay", {
    body: { ...body, token },
  });
  if (error !== null) throw await invokeError(error);
  if (data === null) throw new TripBalancePayError("empty_response");
  return data;
}

export async function viewTripBalanceLink(
  token: string,
): Promise<TripBalanceView> {
  return decodeView(await invoke(token, { action: "view" }));
}

export async function statusTripBalanceLink(
  token: string,
): Promise<TripBalanceView> {
  return decodeView(await invoke(token, { action: "status" }));
}

export async function startTripBalanceLink(input: {
  token: string;
  amountMinor: number;
  expectedRemainingMinor: number;
  clientKey: string;
  method: "saved_card" | "new_card";
}): Promise<TripBalanceStart> {
  const data = await invoke(input.token, {
    action: "start",
    amountMinor: input.amountMinor,
    expectedRemainingMinor: input.expectedRemainingMinor,
    clientKey: input.clientKey,
    method: input.method,
  });
  if (!isRecord(data) || typeof data.kind !== "string") {
    throw new TripBalancePayError("invalid_response");
  }
  if (
    data.kind === "stripe" && typeof data.clientSecret === "string" &&
    typeof data.paymentIntentId === "string" &&
    typeof data.stripeAccountId === "string" &&
    typeof data.publishableKey === "string" &&
    Number.isSafeInteger(data.amountMinor)
  ) {
    return {
      kind: "stripe",
      amountMinor: data.amountMinor as number,
      clientSecret: data.clientSecret,
      paymentIntentId: data.paymentIntentId,
      stripeAccountId: data.stripeAccountId,
      publishableKey: data.publishableKey,
    };
  }
  if (
    data.kind === "redirect" && typeof data.url === "string" &&
    data.url.startsWith("https://checkout.paystack.com/")
  ) return { kind: "redirect", url: data.url };
  if (
    data.kind === "paystack_saved_card" && typeof data.outcome === "string" &&
    Number.isSafeInteger(data.amountMinor)
  ) {
    return {
      kind: "paystack_saved_card",
      outcome: data.outcome,
      amountMinor: data.amountMinor as number,
    };
  }
  throw new TripBalancePayError("invalid_response");
}
