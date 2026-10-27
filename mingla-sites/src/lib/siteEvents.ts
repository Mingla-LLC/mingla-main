import { signedCorePost, type SiteBinding } from "./coreGateway";

/*
 * #2829 W10 — the visitor events a site may record (consent-gated, opt-in,
 * #2830). One list for the events route and the server-side recorders.
 * No third-party script ever runs on a site; events go to Mingla only.
 */
export const SITE_EVENT_NAMES = new Set([
  "site_view",
  "page_view",
  "cta_click",
  "offering_view",
  "reservation_start",
  "checkout_start",
  "checkout_complete",
  "contact_click",
  "consent_granted",
  "consent_denied",
  // #2829 W10
  "book_click",
  "form_submit_contact",
  "form_submit_newsletter",
  "outbound_click",
]);

export const SITE_EVENT_KEYS = new Set([
  "event_name",
  "occurred_at",
  "site_id",
  "brand_id",
  "publication_id",
  "page_role",
  "cta_kind",
  "offering_id",
  "referrer_class",
  "consent_policy_version",
  "event_id",
  "page_path",
]);

/** A page address as the browser shows it (no query, no fragment), ≤ 300 characters. */
export const PAGE_PATH = /^\/[A-Za-z0-9._~/-]{0,299}$/;

export type SiteEventRecorder = (
  site: SiteBinding,
  event: Record<string, unknown>,
) => Promise<void>;

/** Sends one already-consented event for the site Core resolved for this host. */
export const recordSiteEvent: SiteEventRecorder = async (site, event) => {
  await signedCorePost({
    edgeFunction: "brand-site-attribution",
    path: `/internal/v1/sites/${site.site_id}/analytics-events`,
    site,
    body: {
      ...event,
      site_id: site.site_id,
      action: "event",
      consent_granted: true,
      occurred_at: typeof event.occurred_at === "string" && event.occurred_at ? event.occurred_at : new Date().toISOString(),
    },
  });
};
