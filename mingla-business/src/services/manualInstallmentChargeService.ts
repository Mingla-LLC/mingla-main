import { supabase } from "./supabase";

export type ManualChargeInstallmentResult =
  | { ok: true; chargeId?: string }
  | { ok: false; error: string };

export async function manualChargeInstallment(input: {
  installmentId: string;
  atRiskOverride?: boolean;
}): Promise<ManualChargeInstallmentResult> {
  const { data, error } =
    await supabase.functions.invoke<ManualChargeInstallmentResult>(
      "manual-charge-installment",
      {
        body: {
          installmentId: input.installmentId,
          atRiskOverride: input.atRiskOverride === true,
        },
      },
    );

  if (error !== null) {
    throw new Error(`manual-charge-installment failed: ${error.message}`);
  }
  if (data === null) {
    throw new Error("manual-charge-installment returned no data");
  }
  return data;
}
