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

/**
 * #3583 — THE WORKSPACE NEVER FAILS SILENTLY.
 *
 * This used to be a bare string union whose only failure member was
 * `"offline"`, and the route mapped EVERY error that was not an auth or
 * expiry code onto it. Two things then collided:
 *
 *  1. `useNetInfoSafe` returns null forever on every currently shipped
 *     business binary (#1758's assume-online fallback), so the route's
 *     `offline` boolean is permanently false; and
 *  2. the route clears an `"offline"` notice on the next render whenever the
 *     device is not actually offline.
 *
 * So a refused publish, a refused rollback, a refused preview or a refused
 * editor handoff flashed "You're offline" for one frame and then showed
 * NOTHING. The owner watched a screen that looked fine while their change had
 * not published — the exact shape Constitution #3 forbids.
 *
 * A notice is now a VALUE, not a label: it carries what happened, what to do
 * next, and the support reference. `offline` means the device reported itself
 * offline; every other failure is `failed` and cannot be cleared by a network
 * check it has nothing to do with.
 */
export type WorkspaceNoticeKind =
  | "offline"
  | "expired"
  | "unauthorized"
  | "failed";

export interface WorkspaceNoticeDetail {
  kind: WorkspaceNoticeKind;
  /** Customer-safe heading. Never a code, never a stack. */
  title: string;
  /** What happened AND the next action. Never "Something went wrong". */
  body: string;
  /** What to quote to support. Null when the failure carried no code. */
  reference: string | null;
}

export type WorkspaceNotice = WorkspaceNoticeDetail | null;

export const OFFLINE_NOTICE: WorkspaceNoticeDetail = {
  kind: "offline",
  title: "You\u2019re offline",
  body:
    "Your live website is unaffected. Reconnect to check the durable operation receipt.",
  reference: null,
};

/**
 * The next action for each Core failure code.
 *
 * Core already sends a customer-safe sentence for every code it emits
 * (`sitesFailure` in `supabase/functions/_shared/sitesContracts.ts`); the
 * client was throwing it away. These add the missing half — what the owner
 * should DO — and every one of them is true whatever the website's real state
 * is. Nothing here claims a website is live, because a failed request is never
 * evidence of that (Constitution #9).
 */
const FAILURE_NEXT_STEP: Record<string, string> = {
  // No FORBIDDEN / UNAUTHORIZED entry: those two are answered above, by the
  // `unauthorized` notice, and never reach this map.
  NOT_FOUND: "Reload the Website workspace and try again.",
  INVALID_STATE:
    "Nothing was published. This website is not ready for that step yet \u2014 quote the reference below if it keeps refusing.",
  VALIDATION_FAILED:
    "Open the named page or setting in Studio, resolve it, then try again.",
  REVISION_CONFLICT:
    "The draft moved on. Check the draft again before publishing.",
  OPERATION_IN_PROGRESS:
    "Another website operation is still running. Wait for it to finish, then try again.",
  IDEMPOTENCY_CONFLICT: "Start this step again from the workspace.",
  PUBLISH_FAILED_LAST_GOOD_PRESERVED:
    "Review the draft, then publish again.",
  MEDIA_REJECTED: "Replace that image in Studio, then try again.",
  MEDIA_PROCESSING: "Wait for that image to finish preparing, then try again.",
  SERVICE_TEMPORARILY_UNAVAILABLE: "Try again in a moment.",
  SITE_UNAVAILABLE:
    "Reopen the Website workspace so Mingla can load this website again.",
};

const GENERIC_NEXT_STEP =
  "Try again. If it keeps failing, quote the reference below to Mingla support.";

/*
 * Deliberately says only what is provable. A failure with no code can be a
 * refusal Core rolled back OR a response lost in transit, and only the first
 * proves nothing changed, so this claims neither.
 */
const GENERIC_FAILURE_BODY = "Mingla could not complete that step.";

/**
 * #3583 — turn a refusal into something the owner can act on.
 *
 * `code` is the Core error code when the throw carried one and null otherwise
 * (a transport fault, a thrown plain Error). `message` is Core's own
 * customer-safe sentence; it is never a raw JavaScript message, because the
 * caller only forwards it for a typed Website failure.
 *
 * NOTE THE ABSENCE OF AN "offline" BRANCH. Nothing a server says proves the
 * device is offline, so this function cannot return one; only the route's real
 * network signal sets `OFFLINE_NOTICE`.
 */
export function websiteFailureNotice(input: {
  code: string | null;
  message: string | null;
}): WorkspaceNoticeDetail {
  const code = input.code;
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN") {
    return {
      kind: "unauthorized",
      title: "Website access changed",
      body: "Your role no longer has access to this brand website.",
      reference: code,
    };
  }
  if (code !== null && (code.includes("EXPIRED") || code.includes("REPLAY"))) {
    return {
      kind: "expired",
      title: "Your secure Studio session ended",
      body:
        "No draft or live website was changed. Open Studio again from this workspace to continue.",
      reference: code,
    };
  }
  const nextStep = (code !== null ? FAILURE_NEXT_STEP[code] : undefined) ??
    GENERIC_NEXT_STEP;
  const what = input.message ?? GENERIC_FAILURE_BODY;
  return {
    kind: "failed",
    title: "That didn\u2019t go through",
    body: `${what} ${nextStep}`,
    reference: code,
  };
}

/**
 * #3583 — the local pointer names an operation Core has no record of.
 *
 * Core writes the operation receipt in the SAME transaction that authorizes
 * the operation, so a refusal rolls the receipt back with everything else and
 * a receipt that 404s after retries is proof the operation never existed.
 */
export const ORPHANED_PUBLICATION_NOTICE: WorkspaceNoticeDetail = {
  kind: "failed",
  title: "That publish never started",
  body:
    "Mingla has no record of it, so nothing was published and your website is unchanged. Review the draft and publish again.",
  reference: null,
};

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
  /*
   * #3583 — NO SITE MEANS NO SECTIONS.
   *
   * The panel checks used to run BEFORE this one, so the desktop rail (which
   * renders at >=1024px whether or not a website exists) could put the
   * workspace into Publishing, Versions, Analytics or Address for a brand that
   * has no website at all. Analytics then stated "Analytics are unavailable.
   * Your website remains live" — a sentence about a website that did not
   * exist, which is fabricated data, not a copy bug (Constitution #9).
   * Versions showed an empty history, and Publishing offered a Check-draft
   * button whose only possible outcome was a refusal.
   *
   * `setup_review` stays ABOVE this line because it is the one panel that is
   * site-less by design: it is how a website gets created.
   */
  if (input.site === null) return 2;
  if (input.panel === "publish_review" || input.studioReturnResult === "preview_publish") return 13;
  if (input.panel === "versions") return 24;
  if (input.panel === "analytics") return 23;
  if (input.panel === "address") return 17;
  if (input.panel === "rollback_review") return 25;
  if (input.site.status === "provisioning") return 4;
  if (input.site.status === "publishing") return 14;
  if (input.site.status === "published" && input.site.active_publication_id)
    return 15;
  if (input.site.status === "error") return 28;
  return 5;
}
