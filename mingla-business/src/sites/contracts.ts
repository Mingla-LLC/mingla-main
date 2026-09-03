export type BrandSiteStatus =
  "provisioning" | "draft" | "publishing" | "published" | "suspended" | "error";

export interface BrandSiteHost {
  hostname: string;
  status: "pending" | "active" | "suspended" | "retired";
  is_primary: boolean;
}

export interface BrandSiteOverview {
  id: string;
  brand_id: string;
  renderer_key: "restaurant-website-v1";
  renderer_version: number;
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
}

export interface BrandSiteOperation {
  operation_id: string;
  site_id: string;
  kind: "provision" | "editor_session" | "preview" | "publish" | "rollback" | "reconcile";
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

export function primarySiteHost(site: BrandSiteOverview): BrandSiteHost | null {
  return site.brand_site_hosts.find((host) => host.is_primary) ?? null;
}
