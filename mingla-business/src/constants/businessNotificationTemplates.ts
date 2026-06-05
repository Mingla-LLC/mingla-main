/**
 * Business notification templates + the 4-family visual taxonomy
 * (META-ORCH-1074 Sub-C/Sub-D).
 *
 * Mirrors `stripeNotificationTemplates.ts` `NotificationTemplate` shape for the
 * 11 `business.*` v1 types (per SPEC_META-ORCH-1074_SUB-D_COPY_AND_PREFS.md §3).
 * `business.new_follower` is DROPPED from v1 (operator 2026-06-04 — no follower
 * data source); not present here.
 *
 * This module is the SINGLE source of truth the inbox uses to map a row's
 * `type` → its visual family (icon + accent), severity, default opt-in, and
 * master category. `notify-dispatch` renders the actual push/in-app copy
 * server-side from its own template store; the title/body on a `notifications`
 * row are authored there. The inbox reads the row's stored `title`/`body` and
 * uses THIS module only for the family/icon/severity/category decoration
 * (SUB-C_DESIGN §2) — so there is no copy drift between push and inbox.
 *
 * The push/in-app copy strings ARE included here (mirroring the Sub-D matrix)
 * for: (a) the client-side regression test (SC-D1 — char limits + no `{var}`
 * leakage), (b) any future client-side fallback render. They are NOT the
 * delivery path (that is server-side notify-dispatch). Currency-aware
 * `{amount}` formatting (Sub-D §2) is the server's job; the templates only
 * carry the `{amount}` slot.
 *
 * No magic numbers / no copy invention beyond the SPEC matrix.
 */

import type { IconName } from "../components/ui/Icon";

/** The 11 v1 business notification types (LOCKED — SUB-D §0). */
export type BusinessNotificationType =
  | "business.order_paid"
  | "business.event_sold_out"
  | "business.low_inventory"
  | "business.refund_processed"
  | "business.dispute_opened"
  | "business.dispute_action_needed"
  | "business.payout_paid"
  | "business.account_status_changed"
  | "business.new_review"
  | "business.claim_decision"
  | "business.team_member_joined";

/** Severity union — mirrors `NotificationTemplate.severity`. */
export type NotificationSeverity = "blocking" | "warning" | "info";

/**
 * The four visual families the 11 types collapse into (SUB-C_DESIGN §2).
 * The family drives the leading-icon accent + tint + emphasis — the triage
 * layer a brand reads before the words.
 */
export type NotificationFamily = "money" | "risk" | "audience" | "team";

export interface BusinessNotificationTemplate {
  readonly type: BusinessNotificationType;
  readonly pushTitle: string;
  readonly pushBody: string;
  readonly inAppTitle: string;
  readonly inAppBody: string;
  readonly severity: NotificationSeverity;
  readonly family: NotificationFamily;
  /** Leading icon (from Icon.tsx; SUB-C_DESIGN §2.2/§3.5). */
  readonly icon: IconName;
  /** Master settings category (SUB-D §5). */
  readonly masterCategory:
    | "orderActivity"
    | "paymentsTrust"
    | "audienceContent"
    | "brandTeam";
  /** Default push opt-in (SUB-D §4). */
  readonly defaultPush: boolean;
  /** Default in-app opt-in (SUB-D §4 — all 11 default ON). */
  readonly defaultInApp: boolean;
}

/**
 * BUSINESS_NOTIFICATION_TEMPLATES — the 11 v1 types.
 *
 * Copy mirrors SUB-D §3 / §8. Branch types (`account_status_changed`,
 * `claim_decision`) carry the DEFAULT branch copy here; the branch-specific
 * strings live in `BUSINESS_NOTIFICATION_BRANCH_COPY` below and are what
 * notify-dispatch + any client fallback select on `data.status`/`data.decision`.
 */
export const BUSINESS_NOTIFICATION_TEMPLATES: Record<
  BusinessNotificationType,
  BusinessNotificationTemplate
> = {
  "business.order_paid": {
    type: "business.order_paid",
    pushTitle: "New sale 🎉",
    pushBody: "{eventTitle}: {amount} just came in.",
    inAppTitle: "You made a sale",
    inAppBody: "{qty} × {eventTitle} — {amount}. Tap to see the order.",
    severity: "info",
    family: "money",
    icon: "cash",
    masterCategory: "orderActivity",
    defaultPush: true,
    defaultInApp: true,
  },
  "business.event_sold_out": {
    type: "business.event_sold_out",
    pushTitle: "Sold out 🎉",
    pushBody: "{eventTitle} is sold out — nice work.",
    inAppTitle: "{eventTitle} sold out",
    inAppBody: "All {capacity} spots are gone. Nice work.",
    severity: "info",
    family: "money",
    icon: "ticket",
    masterCategory: "orderActivity",
    defaultPush: true,
    defaultInApp: true,
  },
  "business.low_inventory": {
    type: "business.low_inventory",
    pushTitle: "Almost gone",
    pushBody: "{eventTitle}: only {remaining} left.",
    inAppTitle: "{eventTitle} is almost gone",
    inAppBody:
      "Only {remaining} of {capacity} left. Promote it while there's still demand.",
    severity: "warning",
    family: "money",
    icon: "flash",
    masterCategory: "orderActivity",
    defaultPush: true,
    defaultInApp: true,
  },
  "business.refund_processed": {
    type: "business.refund_processed",
    pushTitle: "Refund processed",
    pushBody: "{amount} refunded for {eventTitle}.",
    inAppTitle: "Refund processed",
    inAppBody:
      "{amount} was refunded for {eventTitle}. The buyer sees it in 5–10 business days.",
    severity: "info",
    family: "money",
    icon: "refund",
    masterCategory: "paymentsTrust",
    defaultPush: true,
    defaultInApp: true,
  },
  "business.dispute_opened": {
    type: "business.dispute_opened",
    pushTitle: "Dispute opened",
    pushBody: "A {amount} charge is disputed. Tap to review.",
    inAppTitle: "A charge was disputed",
    inAppBody:
      "A buyer disputed a {amount} charge. Review it in Payments — you can respond before {evidenceDueBy}.",
    severity: "warning",
    family: "risk",
    icon: "shield",
    masterCategory: "paymentsTrust",
    defaultPush: true,
    defaultInApp: true,
  },
  "business.dispute_action_needed": {
    type: "business.dispute_action_needed",
    pushTitle: "Evidence due soon",
    pushBody: "Submit evidence by {evidenceDueBy} to contest a {amount} dispute.",
    inAppTitle: "Evidence needed to contest a dispute",
    inAppBody:
      "Submit your evidence by {evidenceDueBy} or the {amount} dispute is lost by default. Tap to respond.",
    severity: "blocking",
    family: "risk",
    icon: "flag",
    masterCategory: "paymentsTrust",
    defaultPush: true,
    defaultInApp: true,
  },
  "business.payout_paid": {
    type: "business.payout_paid",
    pushTitle: "You got paid",
    pushBody: "{amount} is on its way to your bank.",
    inAppTitle: "You got paid",
    inAppBody: "{amount} is on its way to your bank — expected {arrivalDate}.",
    severity: "info",
    family: "money",
    icon: "bank",
    masterCategory: "paymentsTrust",
    defaultPush: true,
    defaultInApp: true,
  },
  "business.account_status_changed": {
    type: "business.account_status_changed",
    // Default branch = restricted (the loud, action-bearing one).
    pushTitle: "Payments paused",
    pushBody: "{brandName}: Stripe paused payments. Tap to resolve.",
    inAppTitle: "Payments paused on {brandName}",
    inAppBody:
      "Stripe paused payments while it verifies a few details. Resolve it to start accepting payments again.",
    severity: "blocking",
    family: "risk",
    icon: "shield",
    masterCategory: "paymentsTrust",
    defaultPush: true,
    defaultInApp: true,
  },
  "business.new_review": {
    type: "business.new_review",
    pushTitle: "New review",
    pushBody: "{rating}★ — see what they said.",
    inAppTitle: "New {rating}★ review",
    inAppBody: "Someone left {brandName} a {rating}★ review. Tap to read it.",
    severity: "info",
    family: "audience",
    icon: "star",
    masterCategory: "audienceContent",
    defaultPush: true,
    defaultInApp: true,
  },
  "business.claim_decision": {
    type: "business.claim_decision",
    // Default branch = approved.
    pushTitle: "Claim approved",
    pushBody: "{brandName} is yours. Tap to finish setup.",
    inAppTitle: "{brandName} claim approved",
    inAppBody:
      "You now manage {brandName}. Tap to finish your listing and start reaching people nearby.",
    severity: "info",
    family: "team",
    icon: "check",
    masterCategory: "brandTeam",
    defaultPush: true,
    defaultInApp: true,
  },
  "business.team_member_joined": {
    type: "business.team_member_joined",
    pushTitle: "Teammate joined",
    pushBody: "{memberName} joined {brandName} as {role}.",
    inAppTitle: "{memberName} joined your team",
    inAppBody: "{memberName} accepted your invite to {brandName} as {role}.",
    severity: "info",
    family: "team",
    icon: "users",
    masterCategory: "brandTeam",
    // SUB-D §4: the one push=OFF default (alert-fatigue rule).
    defaultPush: false,
    defaultInApp: true,
  },
};

/**
 * Branch copy for the two types that branch on a `data` discriminator
 * (SUB-D §3.8 + §3.10). Used by the client-side regression test and any
 * fallback render; notify-dispatch owns the delivered copy.
 */
export const BUSINESS_NOTIFICATION_BRANCH_COPY: {
  readonly "business.account_status_changed": {
    readonly restricted: Pick<
      BusinessNotificationTemplate,
      "pushTitle" | "pushBody" | "inAppTitle" | "inAppBody"
    >;
    readonly reactivated: Pick<
      BusinessNotificationTemplate,
      "pushTitle" | "pushBody" | "inAppTitle" | "inAppBody"
    >;
  };
  readonly "business.claim_decision": {
    readonly approved: Pick<
      BusinessNotificationTemplate,
      "pushTitle" | "pushBody" | "inAppTitle" | "inAppBody"
    >;
    readonly rejected: Pick<
      BusinessNotificationTemplate,
      "pushTitle" | "pushBody" | "inAppTitle" | "inAppBody"
    >;
  };
} = {
  "business.account_status_changed": {
    restricted: {
      pushTitle: "Payments paused",
      pushBody: "{brandName}: Stripe paused payments. Tap to resolve.",
      inAppTitle: "Payments paused on {brandName}",
      inAppBody:
        "Stripe paused payments while it verifies a few details. Resolve it to start accepting payments again.",
    },
    reactivated: {
      pushTitle: "Payments back on",
      pushBody: "{brandName} can accept payments again.",
      inAppTitle: "{brandName} is back online",
      inAppBody:
        "Stripe finished verifying — payments and payouts are working again. Nothing more for you to do.",
    },
  },
  "business.claim_decision": {
    approved: {
      pushTitle: "Claim approved",
      pushBody: "{brandName} is yours. Tap to finish setup.",
      inAppTitle: "{brandName} claim approved",
      inAppBody:
        "You now manage {brandName}. Tap to finish your listing and start reaching people nearby.",
    },
    rejected: {
      pushTitle: "Claim update",
      pushBody: "We couldn't approve your {brandName} claim. Tap for next steps.",
      inAppTitle: "About your {brandName} claim",
      inAppBody:
        "We couldn't approve your claim for {brandName}. {rejectionReason} Tap to see how to resolve it.",
    },
  },
};

/** Type guard — is this row a known v1 business type? */
export function isBusinessNotificationType(
  type: string,
): type is BusinessNotificationType {
  return Object.prototype.hasOwnProperty.call(
    BUSINESS_NOTIFICATION_TEMPLATES,
    type,
  );
}

/**
 * Resolve the visual family + icon + severity for ANY inbox row `type`
 * (SUB-C_DESIGN §2). Known `business.*` types map via the template table.
 * `stripe.*` types map onto Money/Risk by their severity (SUB-C_DESIGN §2:
 * "blocking/warning → Risk amber; info → Money/neutral"). Unknown types
 * fall back to a neutral Money treatment so a row never renders un-iconed.
 */
export interface NotificationVisual {
  readonly family: NotificationFamily;
  readonly icon: IconName;
  readonly severity: NotificationSeverity;
}

const STRIPE_RISK_TYPES = new Set<string>([
  "stripe.kyc_deadline_warning_7d",
  "stripe.kyc_deadline_warning_3d",
  "stripe.kyc_deadline_warning_1d",
  "stripe.payout_failed",
  "stripe.account_deauthorized",
  "stripe.bank_verification_required",
  "stripe.account_restricted",
]);

export function resolveNotificationVisual(type: string): NotificationVisual {
  if (isBusinessNotificationType(type)) {
    const t = BUSINESS_NOTIFICATION_TEMPLATES[type];
    return { family: t.family, icon: t.icon, severity: t.severity };
  }
  // stripe.reactivation_complete = positive Money-ish info.
  if (type === "stripe.reactivation_complete") {
    return { family: "team", icon: "check", severity: "info" };
  }
  if (type === "stripe.refund_processed") {
    return { family: "money", icon: "refund", severity: "info" };
  }
  if (STRIPE_RISK_TYPES.has(type) || type.startsWith("stripe.")) {
    return { family: "risk", icon: "shield", severity: "warning" };
  }
  // Defensive fallback for any unknown row that slips the prefix filter.
  return { family: "money", icon: "bell", severity: "info" };
}

/**
 * Interpolate `{var}` slots with a sensible literal fallback so a raw `{var}`
 * is NEVER shown (SC-D1). Mirrors the notify-dispatch convention. Used by the
 * client-side fallback render + the regression test.
 */
export function interpolateTemplate(
  template: string,
  vars: Readonly<Record<string, string | undefined>>,
): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const v = vars[key];
    return typeof v === "string" && v.length > 0 ? v : FALLBACK_LITERALS[key] ?? "";
  });
}

/** Per-slot fallback literals (SUB-D §3 "Fallback:" notes). */
const FALLBACK_LITERALS: Readonly<Record<string, string>> = {
  eventTitle: "your listing",
  amount: "a new amount",
  qty: "1",
  capacity: "every",
  remaining: "a few",
  evidenceDueBy: "the deadline",
  arrivalDate: "soon",
  brandName: "your brand",
  rating: "a new",
  decision: "updated",
  rejectionReason: "",
  memberName: "A new teammate",
  role: "a teammate",
  status: "updated",
};
