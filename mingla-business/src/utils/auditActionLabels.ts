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
  /** Short headline. e.g. "Disconnected Stripe account". */
  title: string;
  /** Optional plain-English detail line shown under the title. */
  detail?: string;
  /** Category for filter pills. */
  category: AuditCategory;
  /** Mingla icon name to render in the row gutter. */
  iconHint: IconName;
}

export const AUDIT_CATEGORIES: readonly { id: AuditCategory; label: string }[] = [
  { id: "stripe_connect", label: "Stripe Connect" },
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
  "order_cancelled",
  "order_refund_issued",
  "mingla_tos_accept",
  "ops.webhook_silence_check_fired",
  // ORCH-0804 — Stripe Tax enablement on ticket Checkout Sessions.
  "stripe_tax.checkout_enabled",
  "stripe_tax.registration_link_opened",
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
];

const humanizeSlug = (slug: string): string => {
  const cleaned = slug.replace(/[._]+/g, " ").trim();
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
    case "stripe_connect.onboard_initiated":
      return {
        title: "Started Stripe onboarding",
        category: "stripe_connect",
        iconHint: "bank",
      };
    case "stripe_connect.account_session_created":
      return {
        title: "Opened Stripe account management",
        detail: "An embedded Account Session was minted for onboarding or account management.",
        category: "stripe_connect",
        iconHint: "bank",
      };
    case "stripe_connect.reactivated":
      return {
        title: "Reconnected Stripe account",
        detail: "A previously detached account was re-enabled.",
        category: "stripe_connect",
        iconHint: "bank",
      };
    case "stripe_connect.country_change_locked":
      return {
        title: "Country change blocked",
        detail: "Stripe account already has activity — country is now locked.",
        category: "stripe_connect",
        iconHint: "shield",
      };
    case "stripe_connect.country_change_replaced_before_completion":
      return {
        title: "Replaced Stripe account during onboarding",
        detail: "Old account discarded; a fresh account was created for the new country.",
        category: "stripe_connect",
        iconHint: "bank",
      };
    case "stripe_connect.detach_completed":
      return {
        title: "Disconnected Stripe account",
        category: "stripe_connect",
        iconHint: "bank",
      };
    case "stripe_connect.detach_local_success_stripe_rejected":
      return {
        title: "Disconnected locally — Stripe rejected",
        detail: "Local state cleared; Stripe still holds the account record.",
        category: "stripe_connect",
        iconHint: "shield",
      };
    case "stripe_connect.balance_retrieved":
      return {
        title: "Checked Stripe balance",
        category: "payouts_refunds",
        iconHint: "pound",
      };
    case "stripe_connect.status_refreshed":
      return {
        title: "Refreshed Stripe status",
        category: "stripe_connect",
        iconHint: "bank",
      };
    case "stripe_connect.account_updated":
      return {
        title: "Stripe account updated",
        detail: "Stripe sent an account.updated webhook.",
        category: "stripe_connect",
        iconHint: "bank",
      };
    case "stripe_connect.account_deauthorized":
      return {
        title: "Stripe revoked access",
        detail: "Stripe deauthorized the Mingla platform on this account.",
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
        detail: "Stripe webhook arrived from an unexpected IP — processed but flagged.",
        category: "ops",
        iconHint: "settings",
      };
    case "stripe_connect.webhook_unhandled":
      return {
        title: "Unhandled Stripe webhook",
        category: "ops",
        iconHint: "settings",
      };
    case "stripe_connect.kyc_stall_reminder_sent":
      return {
        title: "KYC reminder sent",
        detail: "Stripe verification is overdue — reminder email dispatched.",
        category: "stripe_connect",
        iconHint: "bank",
      };
    case "order_cancelled":
      return {
        title: "Order cancelled",
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
        title: "Stripe Tax enabled on checkout",
        detail: "First tax-enabled Checkout Session created for this brand.",
        category: "stripe_connect",
        iconHint: "bank",
      };
    case "stripe_tax.registration_link_opened":
      return {
        title: "Opened Stripe Tax dashboard",
        detail: "Brand admin opened Stripe Express Dashboard to manage tax registrations.",
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
        detail: "Stripe webhook reported installment PaymentIntent failure; retry cadence applied or at-risk flagged.",
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
      detail: "Refund arrived from Stripe with no matching Mingla order.",
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
      title: `Stripe Connect: ${humanizeSlug(tail)}`,
      category: "stripe_connect",
      iconHint: "bank",
    };
  }

  // ----- Unknown fallback. Raw slug in detail for debugging. -----
  return {
    title: humanizeSlug(action),
    detail: action,
    category: "other",
    iconHint: "flag",
  };
};
