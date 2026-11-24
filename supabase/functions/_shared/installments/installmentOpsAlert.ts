/**
 * The instalment ops alert: the existing ops-alert email rail and recipients
 * (stripe_disputes / STRIPE_DISPUTE_ALERT_EMAILS). Shared by the Paystack
 * instalment webhook and the issue #4522 overpayment and flex-verify lanes.
 */
import { sendOpsAlertEmail } from "../stripeOpsAlertEmail.ts";
import { resolveAlertRecipientValue } from "../secretBundle.ts";

export async function installmentOpsAlert(subject: string, paragraphs: string[]): Promise<void> {
  const value = resolveAlertRecipientValue("stripe_disputes", "STRIPE_DISPUTE_ALERT_EMAILS");
  const recipients = Array.isArray(value)
    ? value.map((v) => String(v).trim()).filter(Boolean)
    : String(value ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  if (recipients.length === 0) {
    console.warn("[installment-paystack] ops alert recipients missing", { subject });
    return;
  }
  try {
    await sendOpsAlertEmail({ subject, paragraphs, recipients });
  } catch (err) {
    console.error("[installment-paystack] ops alert failed", {
      subject,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * issue #4522 (I-4522-NEVER-WRITE-OFF) — a v2 trip balance below the payment
 * provider's minimum is never charged and never written off: it stays owed
 * and ops are told once. The database decides "once" (alertOps on the claim,
 * attempt, pay-link checkpoint or flexible-payment answer); this sends it.
 */
export async function alertUnchargeableRemainder(
  answer: Record<string, unknown> | null | undefined,
  alert: (subject: string, paragraphs: string[]) => Promise<void> = installmentOpsAlert,
): Promise<void> {
  if (answer?.alertOps !== true) return;
  await alert("A trip balance is too small to charge", [
    "A traveler's remaining trip balance is below the payment provider's minimum, so it cannot be charged automatically. It stays owed and was not written off.",
    `Order: ${String(answer.order_id ?? "?")}; amount: ${String(answer.remainingMinor ?? "?")} ${String(answer.currency ?? "?")} (minor units)`,
    "Please contact the traveler to settle it.",
  ]);
}
