/**
 * #4490 spec 08 O2 — the guest's side of Scan to pay (/pay/till/<code>).
 * Anonymous: venue-till `code_view`, `code_pay` and `confirm_return` need no
 * account and no auth hook. The server prices everything; the guest sends only
 * their contact.
 */
import { supabase } from "./supabase";
import { mapTillPayView, type TillPayView } from "../components/venue/till/tillGuestPayModel";

export class TillPayCodeError extends Error {
  readonly code: string;
  readonly status: number | null;
  constructor(code: string, status: number | null) {
    super(code);
    this.name = "TillPayCodeError";
    this.code = code;
    this.status = status;
  }
}

async function call(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  let response: { data: unknown; error: unknown };
  try {
    response = await supabase.functions.invoke("venue-till", { body });
  } catch {
    throw new TillPayCodeError("network", null);
  }
  if (response.error) {
    const context = (response.error as { context?: unknown }).context;
    let code = "till_failed";
    let status: number | null = null;
    if (context !== null && context !== undefined && typeof (context as Response).json === "function") {
      status = typeof (context as Response).status === "number" ? (context as Response).status : null;
      try {
        const payload = (await (context as Response).json()) as { code?: unknown };
        if (typeof payload.code === "string") code = payload.code;
      } catch {
        // An unreadable body stays till_failed.
      }
    } else {
      code = "network";
    }
    throw new TillPayCodeError(code, status);
  }
  const envelope = (response.data ?? {}) as Record<string, unknown>;
  if (envelope.kind !== "success") throw new TillPayCodeError(String(envelope.code ?? "till_failed"), null);
  return (envelope.data ?? {}) as Record<string, unknown>;
}

export async function viewTillPayCode(code: string): Promise<TillPayView> {
  const data = await call({ action: "code_view", code });
  return mapTillPayView(data.view);
}

export async function payTillPayCode(input: {
  code: string;
  buyer: { name: string; email: string; phone: string; phoneCountryIso: string | null };
}): Promise<{ redirectUrl: string }> {
  const data = await call({ action: "code_pay", ...input });
  if (typeof data.redirectUrl !== "string") throw new TillPayCodeError("till_failed", null);
  return { redirectUrl: data.redirectUrl };
}

/** Back from the provider: the server asks the provider and settles once. */
export async function confirmTillPayCode(code: string): Promise<{ result: string; view: TillPayView }> {
  const data = await call({ action: "confirm_return", code });
  return { result: String(data.result ?? "in_progress"), view: mapTillPayView(data.view) };
}
