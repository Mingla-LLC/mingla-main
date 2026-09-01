import type {
  BrandSiteOperation,
  BrandSiteOverview,
  WebsiteJourneyState,
} from "./contracts";

export type WebsiteWorkspacePanel =
  | "overview"
  | "setup_review"
  | "publish_review"
  | "versions"
  | "analytics"
  | "address"
  | "rollback_review";

export type StudioReturnResult =
  | "exchange_expired"
  | "session_expired"
  | "preview_expired"
  | "preview_publish";

export type WorkspaceNotice = "offline" | "expired" | "unauthorized" | null;

export interface WebsiteJourneyDefinition {
  title: string;
  surface: "business" | "studio" | "ari" | "buyer" | "admin";
  primary: string | null;
  recovery: string;
}

/**
 * One explicit owner for every executable Slice-A journey state. These labels
 * are customer-safe contract text; state numbers never render in the product.
 */
export const WEBSITE_JOURNEY: Record<
  WebsiteJourneyState,
  WebsiteJourneyDefinition
> = {
  1: { title: "Website", surface: "business", primary: "Open Website", recovery: "Reload the authoritative Website status." },
  2: { title: "Your own website, edited in Mingla", surface: "business", primary: "Set up website", recovery: "Try the Website status check again." },
  3: { title: "Review your website setup", surface: "business", primary: "Create website draft", recovery: "Fix the named Brand Profile field, then validate again." },
  4: { title: "Creating your website draft", surface: "business", primary: null, recovery: "Resume or reconcile the same setup operation." },
  5: { title: "Your website draft is ready", surface: "business", primary: "Open Mingla Studio", recovery: "Refresh authoritative draft status." },
  6: { title: "Opening Mingla Studio…", surface: "business", primary: null, recovery: "Mint a new secure handoff from Mingla." },
  7: { title: "Pages", surface: "studio", primary: "Open page", recovery: "Return to Mingla if the session is unavailable." },
  8: { title: "Edit page", surface: "studio", primary: "Save draft", recovery: "Review the latest revision before resubmitting." },
  9: { title: "Media", surface: "studio", primary: "Choose images", recovery: "Replace, retry, or dismiss the affected image." },
  10: { title: "Website request", surface: "ari", primary: "Send request", recovery: "Clarify the page or block, then try again." },
  11: { title: "Update website draft", surface: "ari", primary: "Confirm draft update", recovery: "Refresh a stale proposal without publishing." },
  12: { title: "Preview — not live", surface: "studio", primary: "Publish this revision", recovery: "Return to Mingla and mint a fresh preview." },
  13: { title: "Ready to publish?", surface: "business", primary: "Publish website", recovery: "Open the exact validation issue and review again." },
  14: { title: "Publishing your website", surface: "business", primary: null, recovery: "Resume and reconcile the same durable operation." },
  15: { title: "Your website is live", surface: "business", primary: "View website", recovery: "Refresh verification without guessing health." },
  16: { title: "Restaurant website", surface: "buyer", primary: "Continue with Mingla", recovery: "Serve only the verified last-good artifact." },
  17: { title: "Permanent website address", surface: "business", primary: "View website", recovery: "Retry the authoritative host lookup." },
  23: { title: "Website analytics", surface: "business", primary: "Change time range", recovery: "Keep the Website live and retry aggregates." },
  24: { title: "Version history", surface: "business", primary: "Preview", recovery: "Retry the immutable version list." },
  25: { title: "Publish this earlier version?", surface: "business", primary: "Publish this earlier version", recovery: "Refresh the active pointer and review again." },
  26: { title: "Brand Sites", surface: "admin", primary: "Open site", recovery: "Retry safe control-plane summaries." },
  27: { title: "Site operations", surface: "admin", primary: "Governed operation", recovery: "Use the same durable receipt." },
  28: { title: "That publish didn’t make it live", surface: "business", primary: "Review fixes", recovery: "Keep last-good live; retry only after review." },
  29: { title: "This image can’t be used", surface: "studio", primary: "Replace image", recovery: "Retry only a safe retryable processing failure." },
  30: { title: "Your Studio session ended", surface: "studio", primary: "Return to Mingla", recovery: "Open Studio again from the Website workspace." },
};

export function deriveBusinessWebsiteState(input: {
  site: BrandSiteOverview | null;
  panel: WebsiteWorkspacePanel;
  operation: BrandSiteOperation | null;
  operationPending: boolean;
  isOpeningStudio: boolean;
  isPreviewing: boolean;
  studioReturnResult: StudioReturnResult | null;
}): WebsiteJourneyState {
  if (
    input.studioReturnResult === "exchange_expired" ||
    input.studioReturnResult === "session_expired" ||
    input.studioReturnResult === "preview_expired"
  ) return 30;
  if (input.isOpeningStudio) return 6;
  if (input.isPreviewing) return 12;
  if (input.operationPending || input.operation?.status === "ambiguous") return 14;
  if (input.operation?.status === "failed") return 28;
  if (input.panel === "setup_review") return 3;
  if (input.panel === "publish_review" || input.studioReturnResult === "preview_publish") return 13;
  if (input.panel === "versions") return 24;
  if (input.panel === "analytics") return 23;
  if (input.panel === "address") return 17;
  if (input.panel === "rollback_review") return 25;
  if (input.site === null) return 2;
  if (input.site.status === "provisioning") return 4;
  if (input.site.status === "publishing") return 14;
  if (input.site.status === "published" && input.site.active_publication_id)
    return 15;
  if (input.site.status === "error") return 28;
  return 5;
}
