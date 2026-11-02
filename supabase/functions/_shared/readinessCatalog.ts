/**
 * Issue #3355 P2 — the brand readiness item keys and their owner labels.
 *
 * The catalogue's single home is `public.brand_readiness_catalog`
 * (migration 20280307003355_issue_3355_brand_readiness.sql). This module only
 * mirrors the keys and labels the edge needs before a read exists: the tool
 * schema enum for "not now" and the plain words on its confirmation card. The
 * parity test (`__tests__/issue_3355_brand_readiness.implementor.test.ts`)
 * reads the migration and fails when the two drift.
 */

/** Brand-scoped items: the only keys a brand-wide "not now" may name. */
export const BRAND_READINESS_ITEM_LABELS: Readonly<Record<string, string>> =
  Object.freeze({
    name: "Brand name",
    description: "Brand description",
    tagline: "Tagline",
    profile_photo: "Brand logo",
    cover_media: "Cover photo or video",
    contact_email: "Contact email",
    contact_phone: "Contact phone",
    social_links: "Website or social link",
    address: "Address",
    city_country: "City and country",
    timezone: "Time zone",
    theme: "Page colours and font",
    offerings_selected: "What you offer",
    design_key: "Website design",
    "story.who": "Who comes with you",
    "story.why": "Why they choose you",
    "story.main_action": "Main visitor action",
    venue_descriptor: "Venue description",
    approved_plan: "Approved Website plan",
    "money.market": "Payout country and provider",
    "money.currency": "Payout currency",
    "money.currency_reconciliation": "Currency change review",
    "money.can_sell": "Ready to sell paid tickets",
    "money.can_be_paid_out": "Payouts to your bank",
    "money.provider_review": "Payment provider review",
    "money.terms_member": "Your Organiser Terms",
    "money.tax_registration": "Tax registration",
  });

/** Action-scoped items (appear only for the action they gate). */
export const ACTION_READINESS_ITEM_LABELS: Readonly<Record<string, string>> =
  Object.freeze({
    "team.role": "Your role on this brand",
    "venue.approved_exists": "An approved venue",
    "stay.settings_complete": "Stay settings",
  });

/** The closed action vocabulary `brand_readiness(p_brand_id, p_action)` accepts. */
export const READINESS_ACTIONS = Object.freeze(
  [
    "draft_save",
    "publish_free",
    "publish_paid",
    "trip_installments",
    "venue_submit",
    "stay_publish",
    "website_build",
    "website_publish",
    "refund",
    "bank_setup",
  ] as const,
);

export type ReadinessAction = (typeof READINESS_ACTIONS)[number];

export function readinessItemLabel(key: unknown): string | null {
  if (typeof key !== "string") return null;
  return Object.prototype.hasOwnProperty.call(BRAND_READINESS_ITEM_LABELS, key)
    ? BRAND_READINESS_ITEM_LABELS[key]
    : Object.prototype.hasOwnProperty.call(ACTION_READINESS_ITEM_LABELS, key)
    ? ACTION_READINESS_ITEM_LABELS[key]
    : null;
}
