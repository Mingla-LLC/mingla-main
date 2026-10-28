export type BrandSiteStatus =
  "provisioning" | "draft" | "publishing" | "published" | "suspended" | "error";

export interface BrandSiteHost {
  hostname: string;
  status: "pending" | "verifying" | "active" | "detaching" | "suspended" | "retired";
  is_primary: boolean;
  /** #2829 — `mingla_subdomain` (`<label>.sites.usemingla.com`) or a custom domain. */
  kind?: "mingla_subdomain" | "custom_domain";
  label?: string | null;
}

export interface BrandSiteOverview {
  id: string;
  brand_id: string;
  renderer_key: "restaurant-website-v1" | "sites-v2";
  renderer_version: number;
  /** #2829 — set while the owner/admin has taken the site offline. */
  owner_offline_at?: string | null;
  status: BrandSiteStatus;
  active_publication_id: string | null;
  last_successful_publication_id: string | null;
  provisioning_error_code: string | null;
  created_at: string;
  updated_at: string;
  brand_site_hosts: BrandSiteHost[];
  /**
   * #2830 — Mingla's menu has changed since this website was published.
   *
   * The site carries a baked copy of the menu, so a price or availability
   * change in the app does not reach it until someone republishes. Core
   * compares the menu now against the menu as published and reports it here.
   * Absent on older payloads, so treat undefined as "no signal", never as true.
   */
  menu_changed_since_publish?: boolean;
  latest_provision_operation?: Pick<
    BrandSiteOperation,
    | "operation_id"
    | "status"
    | "error_code"
    | "authorized_at"
    | "updated_at"
    | "result_summary"
  > | null;
}

/** #2829 — the address a site will get, shown before setup is confirmed. */
export interface BrandSiteLabelProposal {
  label: string;
  hostname: string;
  existing: boolean;
}

/** #2829 — what this member may do with the brand's website. */
export interface BrandSiteAvailability {
  available: boolean;
  can_create: boolean;
  can_publish: boolean;
  can_edit: boolean;
}

/** #2829 — a "Download everything" export and its 24-hour link. */
export interface BrandSiteExport {
  operation_id: string;
  status: "authorized" | "executing" | "succeeded" | "failed" | "ambiguous";
  download_url: string | null;
  expires_at: string | null;
  bytes: number | null;
}

export interface StudioExchange {
  site_id: string;
  code: string;
  destination: "studio";
  expires_at: string;
}

export interface BrandSitePreview {
  site_id: string;
  source_revision: string;
  expires_at: string;
  preview_url: string;
  /** #2829 W2 — every page of the draft; "" is the home page. */
  pages?: BrandSitePreviewPage[];
}

export interface BrandSitePreviewPage {
  path: string;
  title: string;
}

/** #2829 W2 — the preview link opened at one page of the draft. */
export function previewUrlForPage(previewUrl: string, path: string): string {
  const clean = path.replace(/^\/+|\/+$/g, "");
  if (!clean) return previewUrl;
  return `${previewUrl}${previewUrl.includes("?") ? "&" : "?"}path=${encodeURIComponent(clean)}`;
}

export interface BrandSiteOperation {
  operation_id: string;
  site_id: string;
  kind: "provision" | "editor_session" | "preview" | "publish" | "rollback" | "reconcile" | "offline" | "online" | "export";
  status: "authorized" | "executing" | "succeeded" | "failed" | "ambiguous";
  error_code: string | null;
  authorized_at: string;
  updated_at: string;
  result_summary: Record<string, unknown> | null;
}

export interface BrandSiteVersion {
  id: string;
  site_id: string;
  source_revision_id: string;
  source_digest: string;
  artifact_digest: string | null;
  renderer_version: number;
  status: "queued" | "validating" | "materializing" | "probing" | "published" | "failed" | "ambiguous" | "rolled_back";
  previous_publication_id: string | null;
  rollback_source_publication_id: string | null;
  requested_at: string;
  completed_at: string | null;
  failure_code: string | null;
}

export interface BrandSiteAnalytics {
  site_id: string;
  issued_handoffs: number;
  consumed_handoffs: number;
  events_30d: number;
  generated_at: string;
}

export interface BrandSiteDraftValidation {
  site_id: string;
  valid: true;
  renderer: "Restaurant Website v1";
  home_revision: string;
  draft_digest: string;
  checked_pages: number;
}

export type WebsiteJourneyState =
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 23
  | 24
  | 25
  | 26
  | 27
  | 28
  | 29
  | 30;

export const DEFERRED_WEBSITE_STATES = [
  18, 19, 20, 21, 22, 31, 32, 33,
] as const;

export function deriveWebsiteJourneyState(
  site: BrandSiteOverview | null,
): WebsiteJourneyState {
  if (site === null) return 2;
  if (site.status === "provisioning") return 4;
  if (site.status === "publishing") return 14;
  if (site.status === "published" && site.active_publication_id !== null)
    return 15;
  if (site.status === "error") return 28;
  return 5;
}

/**
 * #2829 (A5) — what the signed-in member may do with this brand's website,
 * exactly as Core answered (`site-availability`: entitlement + role, checked
 * server-side; every route re-checks). One owner per truth: the workspace
 * never derives these from a client-side copy of the role.
 */
export interface WebsiteCapabilities {
  canCreate: boolean;
  canPublish: boolean;
  canEdit: boolean;
}

export const NO_WEBSITE_CAPABILITIES: WebsiteCapabilities = Object.freeze({
  canCreate: false,
  canPublish: false,
  canEdit: false,
});

export function capabilitiesFrom(
  availability: BrandSiteAvailability | null | undefined,
): WebsiteCapabilities {
  if (!availability || availability.available !== true) return NO_WEBSITE_CAPABILITIES;
  return {
    canCreate: availability.can_create === true,
    canPublish: availability.can_publish === true,
    canEdit: availability.can_edit === true,
  };
}

export function primarySiteHost(site: BrandSiteOverview): BrandSiteHost | null {
  return site.brand_site_hosts.find((host) => host.is_primary) ?? null;
}

/** #2829 W8 — one record the owner adds at their registrar. */
export interface BrandSiteDnsRecord {
  type: "A" | "AAAA" | "CNAME" | "TXT";
  name: string;
  value: string;
}

/** #2829 W8 — one of the site's addresses (its Mingla subdomain or a domain the brand owns). */
export interface BrandSiteDomainHost {
  id: string;
  hostname: string;
  kind: "mingla_subdomain" | "custom_domain";
  status: "pending" | "verifying" | "active" | "detaching" | "suspended";
  is_primary: boolean;
  is_apex: boolean;
  /** The domain bought from the registrar (`www.brand.com` -> `brand.com`). */
  apex: string | null;
  dns_state: "unknown" | "pending" | "ok" | "misconfigured";
  tls_state: "unknown" | "pending" | "issued" | "expiring" | "failed";
  records: BrandSiteDnsRecord[];
  registrar: string | null;
  mx_missing: boolean;
  misconfigured_since: string | null;
  redirect_until: string | null;
  last_checked_at: string | null;
  activated_at: string | null;
  created_at: string;
}

/** #2829 W8 — the brand's addresses; rank 20 reads, rank 50 manages. */
export interface BrandSiteDomains {
  site_id: string;
  can_manage: boolean;
  max_custom_domains: number;
  hosts: BrandSiteDomainHost[];
}
