/**
 * auditActionLabels — slug → human-readable label resolver for the brand
 * audit log (ORCH-0806, I-PROPOSED-BD AUDIT_LOG_HUMAN_READABLE).
 *
 * Every distinct `action` string emitted by `writeAudit()` across
 * supabase/functions/** MUST resolve to a non-`other` category here.
 *
 * Adding a new audit slug? Two-step:
 *   1. Add the slug literal to KNOWN_STATIC_SLUGS below.
 *   2. Add a branch in resolveAuditActionLabel (or a pattern matcher).
 *
 * The strict-grep gate `.github/scripts/strict-grep/orch-0806-audit-action-labels.mjs`
 * enforces step 1 by intersecting writeAudit call sites with KNOWN_STATIC_SLUGS.
 *
 * Per ORCH-0806 SPEC §6.1–§6.2.
 */

import type { IconName } from "../components/ui/Icon";

export type AuditCategory =
  | "stripe_connect"
  | "payouts_refunds"
  | "orders"
  | "legal"
  | "ops"
  | "other";

export interface AuditActionLabel {
  /** Short headline. e.g. "Disconnected payout account". */
  title: string;
  /** Optional plain-English detail line shown under the title. */
  detail?: string;
  /** Category for filter pills. */
  category: AuditCategory;
  /** Mingla icon name to render in the row gutter. */
  iconHint: IconName;
}

export const AUDIT_CATEGORIES: readonly { id: AuditCategory; label: string }[] = [
  { id: "stripe_connect", label: "Payout account" },
  { id: "payouts_refunds", label: "Payouts & refunds" },
  { id: "orders", label: "Orders" },
  { id: "legal", label: "Legal" },
  { id: "ops", label: "Ops" },
  { id: "other", label: "Other" },
];

/**
 * Every static slug emitted by writeAudit() as of ORCH-0806. The strict-grep
 * gate Check 3 grep-intersects this with writeAudit literal arguments and
 * fails if any emitted static slug is absent here.
 *
 * Dynamic slugs (`stripe_connect.deadline_warning_*_sent`, `stripe.*.{status}`,
 * `stripe.*.orphan`, `stripe.*.reconciled`, `stripe_connect.{event.type}`) are
 * pattern-matched in resolveAuditActionLabel and are NOT listed here.
 */
export const KNOWN_STATIC_SLUGS: readonly string[] = [
  "stripe_connect.onboard_initiated",
  "stripe_connect.reactivated",
  "stripe_connect.country_change_locked",
  "stripe_connect.country_change_replaced_before_completion",
  "stripe_connect.detach_completed",
  "stripe_connect.detach_local_success_stripe_rejected",
  "stripe_connect.balance_retrieved",
  "stripe_connect.status_refreshed",
  "stripe_connect.account_updated",
  "stripe_connect.account_deauthorized",
  "stripe_connect.detached_refund_updated",
  "stripe_connect.webhook_ip_soft_fail",
  "stripe_connect.webhook_unhandled",
  "stripe_connect.kyc_stall_reminder_sent",
  // ORCH-0954 [Embedded onboarding cutover + Stripe-managed risk] — audit
  // emitted by brand-stripe-account-session after a successful Account
  // Session mint for the embedded onboarding or account-management surface.
  "stripe_connect.account_session_created",
  // ORCH-1052 [Partner onboarding] — partner-side Stripe Connect audit slugs
  // emitted by partner-stripe-onboard (onboard_initiated) +
  // partner-stripe-account-session (account_session_created).
  "partner_stripe_connect.onboard_initiated",
  "partner_stripe_connect.account_session_created",
  "order_cancelled",
  "order_refund_issued",
  // issue #3827 — guest-list comps (guest-list edge function).
  "comp_issued",
  "comp_cancelled",
  "mingla_tos_accept",
  "ops.webhook_silence_check_fired",
  // ORCH-0804 — Stripe Tax enablement on ticket Checkout Sessions.
  "stripe_tax.checkout_enabled",
  "stripe_tax.registration_link_opened",
  // ORCH-0955 — embedded Tax AccountSession mint (replaces ORCH-0804
  // dashboard-link redirect for the new Mingla-hosted /connect-tax-registrations
  // page mounting <ConnectTaxRegistrations> + <ConnectTaxSettings>).
  "stripe_tax.account_session_minted",
  // ORCH-0869 [Tr3 Installment Payments] — installment lifecycle audit
  // actions emitted by process-scheduled-installments cron edge function
  // (tr3.installment_pi_created + tr3.installment_pi_failed) and by the
  // installmentWebhookHandlers webhook router (tr3.installment_collected +
  // tr3.installment_failed_webhook).
  "tr3.installment_pi_created",
  "tr3.installment_pi_failed",
  "tr3.installment_collected",
  "tr3.installment_failed_webhook",
  // ORCH-0914 [Trip Money tab redesign] — operator-initiated installment
  // actions emitted by biz_manual_charge_installment +
  // biz_send_installment_reminder RPCs.
  "INSTALLMENT_CHARGED_MANUALLY",
  "INSTALLMENT_REMINDER_SENT",
  // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — cancel + auto-close
  // lifecycle audit actions emitted by cancel-trip-booking (per-cancel audit
  // row) and process-booking-deadlines cron (per auto-close batch).
  "trip_booking_cancelled",
  "bookings_auto_closed_by_cron",
  // ORCH-0880 [Tr5 Traveler Intake Forms] — per-tier intake schema edit +
  // re-answer notification dispatch + 30d GDPR purge cron audit slugs.
  // Emitted by biz_update_live_trip extension (schema edits) + cron-purge-
  // canceled-intake-data (deferred to ORCH-0881 follow-up per Phase 1 scope)
  // + ticket-confirmation-dispatch (re-answer notification fan-out).
  "trip_intake_schema_edited",
  "intake_form_data_purged",
  "buyer_intake_form_re_answer_required",
  // META-ORCH-1076 — Paystack (NG) webhook anomaly audit actions.
  "paystack.charge_verify_not_success",
  "paystack.charge_orphan_reference",
  "paystack.charge_amount_mismatch",
  "paystack.charge_currency_mismatch",
  // ORCH-1291 [rsvp-chip-in] — Paystack (NG) RSVP contribution webhook amount/
  // currency guards emitted by _shared/paystackWebhookRouter (contribution path
  // mirrors the ticket charge guards; contribution marked failed, no order).
  "paystack.contribution_amount_mismatch",
  "paystack.contribution_currency_mismatch",
  // ISSUE-1326 [ng-reservation-finalize] — Paystack (NG) paid venue-reservation
  // finalize guards emitted by _shared/reservationPaystackFinalize (amount/
  // currency mismatch → session failed; slot-taken-after-charge → session failed
  // + MANUAL-refund marker while the #1175 venue-refund rail is dark).
  "paystack.reservation_amount_mismatch",
  "paystack.reservation_currency_mismatch",
  "paystack.reservation_slot_unavailable_refund_due",
  "paystack.webhook_unhandled_event",
  // META-ORCH-1076 Phase 2 — Paystack (NG) payout onboarding + management.
  "paystack.subaccount_created",
  "paystack.subaccount_updated",
  "paystack.subaccount_disconnected",
  "paystack.provider_selected",
  "paystack.provider_cleared",
  // #3645 — brand Nigerian bank recipient lifecycle and the sell-before-bank
  // hold switch; seen in production but previously unlabelled.
  "paystack.recipient_created",
  "paystack.recipient_deactivated",
  "payout_hold.paystack_provider_select_flipped",
  "payout_hold.paystack_provider_select_skipped_already_stamped",
  // ORCH-1331 [partner Paystack payout rail] — partner recipient lifecycle
  // (partner-paystack-onboard) + split reversal/refund-state audits
  // (_shared/paystackPartnerSplits + paystack-webhook routing).
  "partner_paystack.recipient_created",
  "partner_paystack.recipient_detached",
  "paystack.partner_split_reversal_owed",
  "paystack.webhook_unhandled_refund_state",
  // toward #3697 Wave 7c — Ads credit NGN top-up apply failed (retryable).
  "paystack.ad_credit_apply_failed",
  // #1173 [Stripe payout-hold schedule flip] — payout-schedule (daily → manual
  // hold) lifecycle audit slugs. onboard_* emitted by brand-stripe-onboard at
  // onboarding (flip succeeded / flip failed / stamp failed then rolled back);
  // migrate + rollback emitted by the admin-payout-hold-migrate batch fn via
  // the admin_write_audit RPC (dynamic p_action, so registered here for the
  // human-readable label path even though the gate does not harvest them).
  "payout_hold.onboard_flipped",
  "payout_hold.onboard_flip_failed",
  "payout_hold.stamp_failed_rolled_back",
  "payout_hold.migrate",
  "payout_hold.rollback",
];

// #3645 — host-facing titles never name the payment provider. The generic
// fallback turns an unrecognised action code into words, so provider words in
// the code are rewritten to plain terms first.
const PROVIDER_WORDS: readonly (readonly [RegExp, string])[] = [
  [/\bpartner stripe connect\b/gi, "partner payout account"],
  [/\bstripe connect\b/gi, "payout account"],
  [/\bstripe tax\b/gi, "tax tools"],
  [/\bpartner paystack\b/gi, "partner Nigerian payout"],
  [/\bpaystack\b/gi, "Nigerian payout"],
  [/\bstripe\b/gi, "card payment"],
];

const humanizeSlug = (slug: string): string => {
  let cleaned = slug.replace(/[._]+/g, " ").trim();
  for (const [pattern, plain] of PROVIDER_WORDS) {
    cleaned = cleaned.replace(pattern, plain);
  }
  if (cleaned.length === 0) return "Event";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
};

const capitalize = (s: string): string =>
  s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);

const formatRefundStatusTitle = (status: string): string => {
  // status candidates: pending | canceled | failed | succeeded | requires_action
  const human = status.replace(/_/g, " ");
  return `Refund ${capitalize(human)}`;
};

export const resolveAuditActionLabel = (action: string): AuditActionLabel => {
  // ----- Static exact-match slugs (cheaper + safer than regex) -----
  switch (action) {
    // META-ORCH-1076 — Paystack (NG) webhook anomaly events.
    case "paystack.charge_verify_not_success":
      return {
        title: "Nigerian payment not verified",
        detail: "A charge.success webhook arrived but the verify call did not return success; no order was created.",
        category: "orders",
        iconHint: "shield",
      };
    case "paystack.charge_orphan_reference":
      return {
        title: "Nigerian payment with no matching checkout",
        detail: "A verified Nigerian payment referenced no known checkout session.",
        category: "orders",
        iconHint: "flag",
      };
    case "paystack.charge_amount_mismatch":
      return {
        title: "Nigerian payment amount mismatch",
        detail: "The paid amount did not match the checkout total; no order was created.",
        category: "orders",
        iconHint: "shield",
      };
    case "paystack.charge_currency_mismatch":
      return {
        title: "Nigerian payment currency mismatch",
        detail: "The paid currency was not NGN; no order was created.",
        category: "orders",
        iconHint: "shield",
      };
    // ORCH-1291 [rsvp-chip-in] — Paystack (NG) RSVP contribution webhook guards.
    case "paystack.contribution_amount_mismatch":
      return {
        title: "Nigerian contribution amount mismatch",
        detail: "The paid amount did not match the contribution total; the contribution was marked failed.",
        category: "orders",
        iconHint: "shield",
      };
    case "paystack.contribution_currency_mismatch":
      return {
        title: "Nigerian contribution currency mismatch",
        detail: "The paid currency was not NGN; the contribution was marked failed.",
        category: "orders",
        iconHint: "shield",
      };
    // ISSUE-1326 [ng-reservation-finalize] — Paystack (NG) paid venue-reservation
    // finalize guards emitted by _shared/reservationPaystackFinalize.
    case "paystack.reservation_amount_mismatch":
      return {
        title: "Nigerian reservation amount mismatch",
        detail: "The paid amount did not match the reservation total; the reservation session was marked failed and NOT minted.",
        category: "orders",
        iconHint: "shield",
      };
    case "paystack.reservation_currency_mismatch":
      return {
        title: "Nigerian reservation currency mismatch",
        detail: "The paid currency was not NGN; the reservation session was marked failed and NOT minted.",
        category: "orders",
        iconHint: "shield",
      };
    case "paystack.reservation_slot_unavailable_refund_due":
      return {
        title: "Nigerian reservation needs manual refund",
        detail: "The slot was taken between charge and finalize. Funds were captured but no reservation was minted; a MANUAL refund is required (automatic refunds for Nigerian venue reservations are currently off).",
        category: "orders",
        iconHint: "flag",
      };
    case "paystack.webhook_unhandled_event":
      return {
        title: "Unhandled Nigerian payment webhook event",
        category: "ops",
        iconHint: "flag",
      };
    case "paystack.subaccount_created":
      return {
        title: "Nigerian payout account connected",
        detail: "A bank account was connected and a Nigerian payout account created; this brand can now receive payouts.",
        category: "ops",
        iconHint: "shield",
      };
    case "paystack.subaccount_updated":
      return {
        title: "Nigerian payout bank updated",
        detail: "The settlement bank account on this brand's Nigerian payout account was changed.",
        category: "ops",
        iconHint: "shield",
      };
    case "paystack.subaccount_disconnected":
      return {
        title: "Nigerian payout account disconnected",
        detail: "The brand's Nigerian payout bank was disconnected; it will not receive payouts until reconnected.",
        category: "ops",
        iconHint: "flag",
      };
    case "paystack.provider_selected":
      return {
        title: "Nigeria payouts selected",
        detail: "The brand chose to get paid in Nigeria; bank connection is the next step.",
        category: "ops",
        iconHint: "shield",
      };
    case "paystack.recipient_created":
      return {
        title: "Nigerian bank details saved",
        detail: "The brand's Nigerian bank account was verified and saved; the payout account is set up next.",
        category: "ops",
        iconHint: "shield",
      };
    case "paystack.recipient_deactivated":
      return {
        title: "Previous Nigerian bank details retired",
        detail: "An earlier Nigerian bank account was retired, usually because the brand saved a new one.",
        category: "ops",
        iconHint: "shield",
      };
    case "payout_hold.paystack_provider_select_flipped":
      return {
        title: "Selling before a bank switched on",
        detail: "Choosing Nigeria switched this brand to selling before a bank is connected; money waits until a bank is added.",
        category: "payouts_refunds",
        iconHint: "pound",
      };
    case "payout_hold.paystack_provider_select_skipped_already_stamped":
      return {
        title: "Selling before a bank already on",
        detail: "Nigeria was chosen again; this brand was already set to sell before a bank is connected, so nothing changed.",
        category: "payouts_refunds",
        iconHint: "pound",
      };
    case "paystack.provider_cleared":
      return {
        title: "Nigeria payouts cancelled",
        detail: "The brand backed out of Nigeria payouts before connecting a bank; reverted to the default payout rail.",
        category: "ops",
        iconHint: "flag",
      };
    // ORCH-1331 [partner Paystack payout rail] — partner recipient lifecycle
    // + split reversal/refund-state audits.
    case "partner_paystack.recipient_created":
      return {
        title: "Partner payout bank connected (Nigeria)",
        detail: "A partner connected their Nigerian bank account; partner splits can now be paid out to it.",
        category: "ops",
        iconHint: "shield",
      };
    case "partner_paystack.recipient_detached":
      return {
        title: "Partner payout bank disconnected (Nigeria)",
        detail: "A partner unlinked their Nigerian bank; their splits pause until a bank is reconnected.",
        category: "ops",
        iconHint: "flag",
      };
    case "paystack.partner_split_reversal_owed":
      return {
        title: "Partner split owed back after refund",
        detail: "An NGN refund landed after the partner share was already paid out; the amount is owed back to Mingla and is recovered manually.",
        category: "payouts_refunds",
        iconHint: "pound",
      };
    case "paystack.webhook_unhandled_refund_state":
      return {
        title: "Nigerian refund not final yet",
        detail: "A refund webhook arrived in a non-final state (pending, processing, or failed); only refund.processed moves the ledger.",
        category: "ops",
        iconHint: "flag",
      };
    case "paystack.ad_credit_apply_failed":
      return {
        title: "Ads credit top-up not applied",
        detail: "Our payment partner confirmed an NGN Ads credit charge, but crediting the wallet failed; the webhook will retry.",
        category: "ops",
        iconHint: "flag",
      };
    case "stripe_connect.onboard_initiated":
      return {
        title: "Started bank setup",
        category: "stripe_connect",
        iconHint: "bank",
      };
    case "stripe_connect.account_session_created":
      return {
        title: "Opened payout account management",
        detail: "An embedded Account Session was minted for onboarding or account management.",
        category: "stripe_connect",
        iconHint: "bank",
      };
    case "partner_stripe_connect.onboard_initiated":
      return {
        title: "Started partner bank setup",
        category: "stripe_connect",
        iconHint: "bank",
      };
    case "partner_stripe_connect.account_session_created":
      return {
        title: "Opened partner payout account management",
        detail: "An embedded Account Session was minted for partner onboarding or account management.",
        category: "stripe_connect",
        iconHint: "bank",
      };
    case "stripe_connect.reactivated":
      return {
        title: "Reconnected payout account",
        detail: "A previously detached account was re-enabled.",
        category: "stripe_connect",
        iconHint: "bank",
      };
    case "stripe_connect.country_change_locked":
      return {
        title: "Country change blocked",
        detail: "The payout account already has activity — country is now locked.",
        category: "stripe_connect",
        iconHint: "shield",
      };
    case "stripe_connect.country_change_replaced_before_completion":
      return {
        title: "Replaced payout account during bank setup",
        detail: "Old account discarded; a fresh account was created for the new country.",
        category: "stripe_connect",
        iconHint: "bank",
      };
    case "stripe_connect.detach_completed":
      return {
        title: "Disconnected payout account",
        category: "stripe_connect",
        iconHint: "bank",
      };
    case "stripe_connect.detach_local_success_stripe_rejected":
      return {
        title: "Disconnected locally — payment partner refused",
        detail: "Local state cleared; our payment partner still holds the account record.",
        category: "stripe_connect",
        iconHint: "shield",
      };
    case "stripe_connect.balance_retrieved":
      return {
        title: "Checked payout balance",
        category: "payouts_refunds",
        iconHint: "pound",
      };
    case "stripe_connect.status_refreshed":
      return {
        title: "Refreshed payout account status",
        category: "stripe_connect",
        iconHint: "bank",
      };
    case "stripe_connect.account_updated":
      return {
        title: "Payout account updated",
        detail: "Our payment partner sent an account.updated webhook.",
        category: "stripe_connect",
        iconHint: "bank",
      };
    case "stripe_connect.account_deauthorized":
      return {
        title: "Payment partner revoked access",
        detail: "Our payment partner deauthorized the Mingla platform on this account.",
        category: "stripe_connect",
        iconHint: "shield",
      };
    case "stripe_connect.detached_refund_updated":
      return {
        title: "Refund processed on disconnected account",
        category: "payouts_refunds",
        iconHint: "pound",
      };
    case "stripe_connect.webhook_ip_soft_fail":
      return {
        title: "Webhook IP check failed (non-blocking)",
        detail: "A card payment webhook arrived from an unexpected IP — processed but flagged.",
        category: "ops",
        iconHint: "settings",
      };
    case "stripe_connect.webhook_unhandled":
      return {
        title: "Unhandled card payment webhook",
        category: "ops",
        iconHint: "settings",
      };
    case "stripe_connect.kyc_stall_reminder_sent":
      return {
        title: "KYC reminder sent",
        detail: "Payout account verification is overdue — reminder email dispatched.",
        category: "stripe_connect",
        iconHint: "bank",
      };
    case "order_cancelled":
      return {
        title: "Order cancelled",
        category: "orders",
        iconHint: "ticket",
      };
    case "comp_issued":
      return {
        title: "Guests added to the guest list",
        category: "orders",
        iconHint: "ticket",
      };
    case "comp_cancelled":
      return {
        title: "Guest-list ticket cancelled",
        category: "orders",
        iconHint: "ticket",
      };
    case "order_refund_issued":
      return {
        title: "Refund issued",
        category: "payouts_refunds",
        iconHint: "pound",
      };
    case "mingla_tos_accept":
      return {
        title: "Accepted Mingla terms",
        category: "legal",
        iconHint: "shield",
      };
    case "ops.webhook_silence_check_fired":
      return {
        title: "Webhook health check fired",
        detail: "Liveness probe ran — no inbound webhooks in window.",
        category: "ops",
        iconHint: "settings",
      };
    // ORCH-0804 — Stripe Tax slugs.
    case "stripe_tax.checkout_enabled":
      return {
        title: "Automatic tax enabled on checkout",
        detail: "First tax-enabled Checkout Session created for this brand.",
        category: "stripe_connect",
        iconHint: "bank",
      };
    case "stripe_tax.registration_link_opened":
      return {
        title: "Opened payment partner tax dashboard",
        detail: "Brand admin opened our payment partner's dashboard to manage tax registrations.",
        category: "stripe_connect",
        iconHint: "bank",
      };
    case "stripe_tax.account_session_minted":
      return {
        title: "Opened Mingla tax tools",
        detail: "Brand admin opened the Mingla-hosted Tax registrations + settings page (ORCH-0955).",
        category: "stripe_connect",
        iconHint: "bank",
      };
    // ORCH-0869 [Tr3 Installment Payments] — installment lifecycle audit slugs.
    case "tr3.installment_pi_created":
      return {
        title: "Installment payment created",
        detail: "Scheduled installment PaymentIntent created on the connected account by the cron edge function.",
        category: "orders",
        iconHint: "pound",
      };
    case "tr3.installment_pi_failed":
      return {
        title: "Installment payment failed (cron)",
        detail: "Scheduled installment PaymentIntent failed during cron execution; retry queued or at-risk flagged after 3 attempts.",
        category: "orders",
        iconHint: "pound",
      };
    case "tr3.installment_collected":
      return {
        title: "Installment collected",
        detail: "Installment PaymentIntent succeeded — ledger flipped to collected; if last installment, paid-in-full email queued.",
        category: "orders",
        iconHint: "pound",
      };
    case "tr3.installment_failed_webhook":
      return {
        title: "Installment payment failed (webhook)",
        detail: "Our payment partner reported an installment PaymentIntent failure; retry cadence applied or at-risk flagged.",
        category: "orders",
        iconHint: "pound",
      };
    case "INSTALLMENT_CHARGED_MANUALLY":
      return {
        title: "Installment charged manually",
        detail: "An organiser triggered an immediate installment charge attempt.",
        category: "orders",
        iconHint: "pound",
      };
    case "INSTALLMENT_REMINDER_SENT":
      return {
        title: "Installment reminder sent",
        detail: "An organiser sent a manual reminder to the traveller.",
        category: "orders",
        iconHint: "ticket",
      };
    // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — cancel + auto-close.
    case "trip_booking_cancelled":
      return {
        title: "Trip booking cancelled",
        detail: "Buyer or operator cancelled a trip booking; refund executed per the active cascading policy.",
        category: "orders",
        iconHint: "ticket",
      };
    case "bookings_auto_closed_by_cron":
      return {
        title: "Bookings auto-closed",
        detail: "Trip's booking deadline passed; hourly cron flipped bookings_closed=true.",
        category: "ops",
        iconHint: "settings",
      };
    // ORCH-0880 [Tr5 Traveler Intake Forms] — schema edit + purge + re-answer.
    case "trip_intake_schema_edited":
      return {
        title: "Intake form edited",
        detail: "Planner edited a tier's traveler intake form schema on a published trip; affected travelers asked to re-answer.",
        category: "orders",
        iconHint: "ticket",
      };
    case "intake_form_data_purged":
      return {
        title: "Intake answers purged",
        detail: "30-day post-cancel GDPR-style retention window expired; canceled-order intake answers + uploaded files removed.",
        category: "ops",
        iconHint: "shield",
      };
    case "buyer_intake_form_re_answer_required":
      return {
        title: "Re-answer requested",
        detail: "Schema change on a tier with existing answers triggered re-answer notification to affected travelers.",
        category: "orders",
        iconHint: "ticket",
      };
    // #1173 [Stripe payout-hold schedule flip] — payout-schedule lifecycle.
    case "payout_hold.onboard_flipped":
      return {
        title: "Payout hold enabled at onboarding",
        detail: "The new payout account was switched from daily to manual payouts (funds held) and the cutover was recorded.",
        category: "payouts_refunds",
        iconHint: "pound",
      };
    case "payout_hold.onboard_flip_failed":
      return {
        title: "Payout hold not applied at onboarding",
        detail: "Switching the new payout account to manual payouts failed; it stays on daily payouts and will be migrated later.",
        category: "payouts_refunds",
        iconHint: "flag",
      };
    case "payout_hold.stamp_failed_rolled_back":
      return {
        title: "Payout hold rolled back",
        detail: "The account was switched to manual payouts but recording the cutover failed, so it was restored to daily payouts to avoid a manual-but-unstamped state.",
        category: "payouts_refunds",
        iconHint: "flag",
      };
    case "payout_hold.migrate":
      return {
        title: "Payout hold applied (admin migration)",
        detail: "An admin batch migration switched this brand's payout account to manual payouts (funds held).",
        category: "payouts_refunds",
        iconHint: "pound",
      };
    case "payout_hold.rollback":
      return {
        title: "Payout hold reverted (admin migration)",
        detail: "An admin batch migration reverted this brand's payout account back to daily payouts.",
        category: "payouts_refunds",
        iconHint: "flag",
      };
  }

  // ----- Dynamic pattern matchers -----

  // stripe_connect.deadline_warning_<N>d_sent (N = 7, 3, 1, or any future)
  const deadlineMatch = action.match(
    /^stripe_connect\.deadline_warning_(\d+)d_sent$/,
  );
  if (deadlineMatch !== null) {
    const days = Number.parseInt(deadlineMatch[1] ?? "0", 10);
    const unit = days === 1 ? "day" : "days";
    return {
      title: "KYC deadline reminder sent",
      detail: `Verification deadline is ${days} ${unit} away.`,
      category: "stripe_connect",
      iconHint: "bank",
    };
  }

  // stripe.<event.type>.reconciled
  if (/^stripe\..+\.reconciled$/.test(action)) {
    return {
      title: "Refund matched to order",
      category: "payouts_refunds",
      iconHint: "pound",
    };
  }

  // stripe.<event.type>.orphan
  if (/^stripe\..+\.orphan$/.test(action)) {
    return {
      title: "Orphan refund recorded",
      detail: "Refund arrived from our payment partner with no matching Mingla order.",
      category: "payouts_refunds",
      iconHint: "pound",
    };
  }

  // stripe.<event.type>.<status> — refund status path
  const refundStatusMatch = action.match(/^stripe\..+\.([a-z_]+)$/);
  if (refundStatusMatch !== null) {
    const status = refundStatusMatch[1] ?? "";
    // Avoid clobbering the .reconciled and .orphan branches above.
    if (status !== "reconciled" && status !== "orphan") {
      return {
        title: formatRefundStatusTitle(status),
        category: "payouts_refunds",
        iconHint: "pound",
      };
    }
  }

  // stripe_connect.<event.type> — generic Stripe Connect webhook tail
  if (action.startsWith("stripe_connect.")) {
    const tail = action.slice("stripe_connect.".length);
    return {
      title: `Payout account: ${humanizeSlug(tail)}`,
      category: "stripe_connect",
      iconHint: "bank",
    };
  }

  // ----- Unknown fallback. Raw slug in detail for debugging. -----
  return {
    title: humanizeSlug(action),
    detail: /stripe|paystack/i.test(action) ? undefined : action,
    category: "other",
    iconHint: "flag",
  };
};
