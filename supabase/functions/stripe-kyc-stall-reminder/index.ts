import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { writeAudit } from "../_shared/audit.ts";
import {
  dispatchNotification,
  getBrandPaymentManagerUserIds,
  jsonResponse,
  serviceRoleClient,
} from "../_shared/stripeEdgeAuth.ts";
import { getKycRemediationForRequirements } from "../_shared/stripeKycRemediation.ts";
import {
  calculateCronJitterMs,
  deadlineWarningTiers,
  requirementsHasDue,
} from "../_shared/stripeKycReminderSchedule.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

async function notifyBrand(
  input: {
    brandId: string;
    type: string;
    title: string;
    body: string;
    idempotencyKey: string;
    data?: Record<string, unknown>;
    emailTo?: string | null;
  },
): Promise<number> {
  const supabase = serviceRoleClient();
  const userIds = await getBrandPaymentManagerUserIds(supabase, input.brandId);
  let count = 0;
  for (let i = 0; i < userIds.length; i += 1) {
    await dispatchNotification({
      userId: userIds[i],
      emailTo: i === 0 ? input.emailTo : null,
      brandId: input.brandId,
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data,
      relatedId: input.brandId,
      relatedType: "brand",
      idempotencyKey: `${input.idempotencyKey}:${userIds[i]}`,
      deepLink: `mingla-business://brand/${input.brandId}/payments/onboard`,
    });
    count += 1;
  }
  if (userIds.length === 0 && input.emailTo) {
    await dispatchNotification({
      emailTo: input.emailTo,
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data,
      relatedId: input.brandId,
      relatedType: "brand",
      idempotencyKey: input.idempotencyKey,
      skipPush: true,
    });
    count += 1;
  }
  return count;
}

serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const cronSecret = Deno.env.get("CRON_SECRET");
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!cronSecret || auth !== cronSecret) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const jitterMs = calculateCronJitterMs();
  if (jitterMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, jitterMs));
  }

  const supabase = serviceRoleClient();
  const cutoff = new Date(Date.now() - DAY_MS).toISOString();
  const { data: accounts, error } = await supabase
    .from("stripe_connect_accounts")
    .select("brand_id, stripe_account_id, requirements, updated_at, charges_enabled, kyc_stall_reminder_sent_at")
    .eq("charges_enabled", false);
  if (error) {
    console.error("[stripe-kyc-stall-reminder] account query failed:", error);
    return jsonResponse({ error: "query_failed" }, 500);
  }

  let sent = 0;
  let reminders = 0;
  let deadlineWarnings = 0;
  const errors: string[] = [];
  let dispatchErrorStreak = 0;

  for (const account of accounts ?? []) {
    if (dispatchErrorStreak >= 5) {
      errors.push("dispatch circuit breaker opened after 5 consecutive failures");
      break;
    }

    const brandId = String(account.brand_id);
    const { data: brand } = await supabase
      .from("brands")
      .select("name, contact_email")
      .eq("id", brandId)
      .is("deleted_at", null)
      .maybeSingle();
    const brandName = String(brand?.name ?? "your brand");
    const emailTo = typeof brand?.contact_email === "string"
      ? brand.contact_email.trim()
      : "";
    const remediation = getKycRemediationForRequirements(account.requirements);

    try {
      if (
        account.kyc_stall_reminder_sent_at === null &&
        account.updated_at < cutoff &&
        requirementsHasDue(account.requirements)
      ) {
        const body = remediation.messages.length > 0
          ? `Stripe still needs you to ${remediation.messages.slice(0, 3).join(", ")}.`
          : "Stripe still needs information before payouts can be enabled.";
        sent += await notifyBrand({
          brandId,
          type: "stripe.kyc_stall_reminder",
          title: "Finish Stripe verification",
          body,
          emailTo: emailTo || null,
          idempotencyKey: `stripe.kyc_stall_reminder:${brandId}`,
          data: { stripe_account_id: account.stripe_account_id, remediation },
        });
        reminders += 1;
        await supabase
          .from("stripe_connect_accounts")
          .update({ kyc_stall_reminder_sent_at: new Date().toISOString() })
          .eq("brand_id", brandId);
        await writeAudit(supabase, {
          user_id: null,
          brand_id: brandId,
          action: "stripe_connect.kyc_stall_reminder_sent",
          target_type: "stripe_connect_account",
          target_id: String(account.stripe_account_id),
          after: { remediation },
        });
      }

      for (const tier of deadlineWarningTiers(remediation.currentDeadline)) {
        const deadlineDate = new Date((remediation.currentDeadline ?? 0) * 1000)
          .toISOString()
          .slice(0, 10);
        sent += await notifyBrand({
          brandId,
          type: `stripe.deadline_warning_${tier}d`,
          title: `Stripe deadline approaching for ${brandName}`,
          body: `Stripe needs information within ${tier} day${tier === 1 ? "" : "s"} to avoid payout restrictions.`,
          emailTo: emailTo || null,
          idempotencyKey: `stripe.deadline_warning:${brandId}:${tier}:${deadlineDate}`,
          data: {
            stripe_account_id: account.stripe_account_id,
            tier,
            current_deadline: remediation.currentDeadline,
            remediation,
          },
        });
        deadlineWarnings += 1;
        await writeAudit(supabase, {
          user_id: null,
          brand_id: brandId,
          action: `stripe_connect.deadline_warning_${tier}d_sent`,
          target_type: "stripe_connect_account",
          target_id: String(account.stripe_account_id),
          after: { current_deadline: remediation.currentDeadline, tier },
        });
      }
      dispatchErrorStreak = 0;
    } catch (err) {
      dispatchErrorStreak += 1;
      errors.push(`${brandId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return jsonResponse({
    ok: true,
    candidates: accounts?.length ?? 0,
    sent,
    reminders,
    deadlineWarnings,
    jitterMs,
    errors,
  });
});
