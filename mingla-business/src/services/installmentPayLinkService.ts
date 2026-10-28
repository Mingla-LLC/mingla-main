/**
 * Issue #3645 — anonymous buyer pay/approve-link client.
 * The URL token is the credential and is sent only to the dedicated edge
 * function. It is never written to analytics, storage, or application logs.
 */

import { supabase } from "./supabase";

export type InstallmentPayLinkState =
  | "payable"
  | "paid"
  | "no_longer_due"
  | "invalid";

export interface InstallmentPayLinkView {
  state: InstallmentPayLinkState;
  purpose?: "pay" | "approve";
  tripTitle?: string;
  brandName?: string;
  amountCents?: number;
  currency?: string;
  dueAt?: string;
  ordinal?: number;
  totalPayments?: number;
  cardLast4?: string;
}

export class InstallmentPayLinkError extends Error {
  readonly code: string;
  readonly status: number | null;

  constructor(code: string, status: number | null = null) {
    super(code);
    this.name = "InstallmentPayLinkError";
    this.code = code;
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readInvokeError(error: unknown): Promise<InstallmentPayLinkError> {
  const context = isRecord(error) ? error.context : null;
  const status = isRecord(context) && typeof context.status === "number"
    ? context.status
    : null;
  if (isRecord(context) && typeof context.json === "function") {
    try {
      const body = await (context.json as () => Promise<unknown>)();
      if (isRecord(body) && typeof body.error === "string") {
        return new InstallmentPayLinkError(body.error, status);
      }
    } catch {
      // A response body may already be consumed; retain its HTTP status.
    }
  }
  return new InstallmentPayLinkError("request_failed", status);
}

async function invoke<T>(token: string, action: "view" | "start" | "status"): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(
    "installment-pay-link",
    { body: { token, action } },
  );
  if (error !== null) throw await readInvokeError(error);
  if (data === null) throw new InstallmentPayLinkError("empty_response");
  return data;
}

export function viewInstallmentPayLink(
  token: string,
): Promise<InstallmentPayLinkView> {
  return invoke(token, "view");
}

export async function startInstallmentPayLink(
  token: string,
): Promise<{ url: string }> {
  const data = await invoke<{ kind?: unknown; url?: unknown }>(token, "start");
  if (
    data.kind !== "redirect" ||
    typeof data.url !== "string" ||
    !data.url.startsWith("https://checkout.paystack.com/")
  ) {
    throw new InstallmentPayLinkError("invalid_redirect");
  }
  return { url: data.url };
}

export function statusInstallmentPayLink(
  token: string,
): Promise<InstallmentPayLinkView> {
  return invoke(token, "status");
}
