import { supabase } from "./supabase";

export async function acceptReferralInvite(
  token: string,
): Promise<{ brand_id: string; member_id: string }> {
  const { data, error } = await supabase.functions.invoke(
    "referral-invite-accept",
    { body: { token } },
  );
  if (error) {
    const context = (error as { context?: Response }).context;
    let detail = error.message;
    try {
      const parsed = context
        ? ((await context.clone().json()) as {
            detail?: string;
            error?: string;
          })
        : null;
      detail = parsed?.detail ?? parsed?.error ?? detail;
    } catch {
      /* keep provider message */
    }
    throw new Error(detail);
  }
  return (data as {
    membership: { brand_id: string; member_id: string };
  }).membership;
}
