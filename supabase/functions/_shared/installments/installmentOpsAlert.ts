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
