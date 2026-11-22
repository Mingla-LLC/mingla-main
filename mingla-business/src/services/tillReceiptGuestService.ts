/**
 * #4490 spec 08 O1 (T20) — the guest's Till receipt (edge function
 * `venue-till`, action `receipt_view`). Anonymous: the receipt's own token is
 * the key. Never imports auth.
 */
import { supabase } from "./supabase";

export class TillReceiptError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "TillReceiptError";
    this.code = code;
  }
}

export async function fetchTillReceipt(input: { paymentId: string; token: string }): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("venue-till", {
    body: { action: "receipt_view", paymentId: input.paymentId, token: input.token },
  });
  if (error) {
    const context = (error as { context?: unknown }).context;
    if (context !== null && context !== undefined && typeof (context as Response).json === "function") {
      try {
        const body = (await (context as Response).json()) as { code?: unknown };
        if (typeof body.code === "string") throw new TillReceiptError(body.code);
      } catch (caught) {
        if (caught instanceof TillReceiptError) throw caught;
      }
    }
    const raw = (error as { message?: string }).message ?? "";
    throw new TillReceiptError(/failed to fetch|network|load failed/i.test(raw) ? "network" : "till_failed");
  }
  const envelope = (data ?? {}) as { kind?: unknown; data?: { receipt?: unknown }; code?: unknown };
  if (envelope.kind !== "success") {
    throw new TillReceiptError(typeof envelope.code === "string" ? envelope.code : "till_failed");
  }
  return envelope.data?.receipt ?? null;
}
