import { postHogService } from "./postHogService";
import { supabase } from "./supabase";

export async function startGigHire(input: {
  interestId: string;
  feeMinor: number;
  returnUrl?: string;
  terms?: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("gig-hire", {
    body: {
      action: "start",
      interest_id: input.interestId,
      fee_minor: input.feeMinor,
      return_url: input.returnUrl ?? null,
      terms: input.terms ?? {},
      idempotency_key: input.idempotencyKey,
    },
  });
  if (error) throw error;
  const result = data as { rail?: unknown } | null;
  postHogService.capture("gig_hired", {
    rail: typeof result?.rail === "string" ? result.rail : "unknown",
  });
  return data;
}
