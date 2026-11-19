/**
 * #2829 W9b (AD-11) — what brand-site-control adds for Ari as the website
 * designer:
 *   - the closed list of Ari actions Studio answers (`ARI_CMS_ACTIONS`);
 *   - the Mingla facts Core signs into every designer write and design-check
 *     run (`siteEvidence`: the brand's live offerings from Core's own feed and
 *     the brand's own words), so Studio checks copy against Mingla's truth and
 *     never against anything the caller sent;
 *   - Studio's named refusals mapped to a closed customer-safe set, with only
 *     the detail Ari needs to re-propose (which claims, which fields, the
 *     latest revision, the layouts this design draws).
 */
import { sitesJson } from "../_shared/sitesContracts.ts";
import { BOOKING_IDENTITY_CAPABILITY, BOOKING_LOCK_REASONS } from "./bookingLock.ts";
import { socialHandlesFrom } from "../_shared/siteContracts/safety.ts";
import { ARI_PAGE_MESSAGES, type AriPageCode } from "../_shared/siteContracts/ariPage.ts";
import { WORKSPACE_ARI_ACTIONS, WORKSPACE_MESSAGES, workspaceDetail, type WorkspaceCode } from "./siteWorkspace.ts";

type JsonObject = Record<string, unknown>;
type RpcResult = { data: unknown; error: { message: string } | null };

/** Actions Studio's /api/internal/ari answers (reads, the look save, Ari's designer tools). */
export const ARI_CMS_ACTIONS: ReadonlySet<string> = new Set([
  "get_brand_site",
  "list_site_pages",
  "get_site_page",
  "propose_site_settings_update",
  "validate_site_draft",
  // #2829 W3 — catalogue search for the "Website design" screen (read-only).
  "search_fonts",
  // #2829 W9b — Ari as the website designer.
  "get_site_tokens",
  "run_site_design_checks",
  "propose_site_composition",
  "propose_block_variant",
  "propose_site_tokens",
  "propose_site_copy",
  "propose_site_imagery",
  "propose_site_collection_entry",
  "log_work",
  // #4453 milestone 7 — Ari's design pass (Core checks SITES_ARI_DESIGN_PASS, designPass.ts).
  "get_site_design_brief",
  "propose_site_design_pass",
  "propose_site_chrome",
  // #4453 milestone 11 — "Add a page with Ari" (Core checks SITES_ARI_ADD_PAGE).
  "propose_site_page",
  "answer_site_page_question",
  // #4453 website workspace — the planning snapshot, one typed step, rolling a change set back.
  ...WORKSPACE_ARI_ACTIONS,
]);

/** Designer actions: Studio answers them unmapped (named refusals with detail); Core attaches evidence. */
export const ARI_DESIGNER_ACTIONS: ReadonlySet<string> = new Set([
  "get_site_tokens",
  "run_site_design_checks",
  "propose_site_composition",
  "propose_block_variant",
  "propose_site_tokens",
  "propose_site_copy",
  "propose_site_imagery",
  "propose_site_collection_entry",
  "log_work",
  "get_site_design_brief",
  "propose_site_design_pass",
  "propose_site_chrome",
  // #4453 milestone 11 — "Add a page with Ari" (Core checks SITES_ARI_ADD_PAGE).
  "propose_site_page",
  "answer_site_page_question",
  // #4453 website workspace — Core signs the same evidence for these as for every designer write.
  ...WORKSPACE_ARI_ACTIONS,
]);

export type AriFailureCode =
  | "VALIDATION_FAILED"
  | "REVISION_CONFLICT"
  | "CLAIM_NOT_BACKED"
  | "CITATION_REQUIRED"
  | "CITATION_INVALID"
  | "VARIANT_NOT_IN_DESIGN"
  | "MEDIA_PROCESSING"
  | "MEDIA_NOT_FOUND"
  | "MEDIA_WRONG_KIND"
  | "VIDEO_TOO_LONG"
  | "OWNER_SOURCE_REQUIRED"
  | "REVIEW_SOURCE_MISMATCH"
  | "PAGE_NOT_FOUND"
  | "PATH_COLLISION"
  | "OFFERING_NOT_FOUND"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "QUOTE_REQUIRED"
  | "TITLE_REQUIRED"
  | "SLUG_TAKEN"
  | "CONTENT_LIMIT_EXCEEDED"
  // #4453 PR 2 — a question form may not take bookings.
  | "BOOKING_THROUGH_ENQUIRY"
  // #4453 milestone 7 — the design pass.
  | "STYLE_DOES_NOT_FIT"
  | "DESIGN_PASS_OFF"
  | "DESIGN_PASS_ALREADY_RUN"
  // #4453 milestone 7c — the pass could not start (not "already run"); nothing was written, so it can run again.
  | "DESIGN_PASS_TRY_AGAIN"
  // #4453 milestone 11 — "Add a page with Ari" (one plain sentence each, site-contracts ARI_PAGE_MESSAGES).
  | AriPageCode
  // #4453 website workspace — one typed step, and undoing a change set.
  | WorkspaceCode
  | "SERVICE_TEMPORARILY_UNAVAILABLE";

export const ARI_FAILURE_MESSAGES: Readonly<Record<AriFailureCode, string>> = {
  VALIDATION_FAILED: "That proposal doesn't fit the website's rules.",
  REVISION_CONFLICT: "The draft changed since Ari read it. Ari needs to read it again and propose the change again.",
  CLAIM_NOT_BACKED: "That copy says something Mingla can't back.",
  CITATION_REQUIRED: "Every website change needs to say what it is based on.",
  CITATION_INVALID: "That change cites something that isn't this brand's.",
  VARIANT_NOT_IN_DESIGN: "This design doesn't draw that layout.",
  MEDIA_PROCESSING: "That photo or video is still being prepared.",
  MEDIA_NOT_FOUND: "That photo or video isn't in this website's library.",
  MEDIA_WRONG_KIND: "That spot needs a different kind of media.",
  VIDEO_TOO_LONG: "Cover videos can be up to 15 seconds.",
  OWNER_SOURCE_REQUIRED: "A review can only come from text the owner pasted.",
  REVIEW_SOURCE_MISMATCH: "A review must be word for word as the owner pasted it.",
  PAGE_NOT_FOUND: "That page isn't on this website.",
  PATH_COLLISION: "Another page already uses that address.",
  OFFERING_NOT_FOUND: "That isn't one of this brand's public Mingla offerings.",
  NOT_FOUND: "Website information is not available.",
  FORBIDDEN: "This Website action is not available for your role.",
  QUOTE_REQUIRED: "Paste the review text first.",
  TITLE_REQUIRED: "Add a name first.",
  SLUG_TAKEN: "Another entry already uses that address.",
  CONTENT_LIMIT_EXCEEDED: "This collection is full.",
  BOOKING_THROUGH_ENQUIRY: BOOKING_LOCK_REASONS.BOOKING_THROUGH_ENQUIRY,
  STYLE_DOES_NOT_FIT: "That style is built for other kinds of places. Ari picks from the styles that fit; the owner can still choose it in Your look.",
  DESIGN_PASS_OFF: "Ari's design pass isn't switched on for this brand yet.",
  DESIGN_PASS_ALREADY_RUN: "Ari has already designed this draft once. Change sections one at a time, or ask the owner before starting again.",
  DESIGN_PASS_TRY_AGAIN: "Ari couldn't start the design pass just now and nothing was changed. Try again in a moment.",
  ...ARI_PAGE_MESSAGES,
  ...WORKSPACE_MESSAGES,
  SERVICE_TEMPORARILY_UNAVAILABLE: "Website tools are temporarily unavailable. Please try again.",
};

const STATUS: Partial<Record<AriFailureCode, number>> = {
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  PAGE_NOT_FOUND: 404,
  SERVICE_TEMPORARILY_UNAVAILABLE: 503,
  DESIGN_PASS_TRY_AGAIN: 503,
};

function isAriCode(value: unknown): value is AriFailureCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ARI_FAILURE_MESSAGES, value);
}

const textList = (value: unknown, max: number): string[] | undefined =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, max).map((item) => item.slice(0, 300)) : undefined;

/** Studio's answer → the customer-safe refusal (only known codes and bounded detail pass). */
export function ariFailureFrom(body: JsonObject | null, status: number): Response {
  const error = (body?.error ?? {}) as JsonObject;
  const code: AriFailureCode = isAriCode(error.code) ? error.code : "SERVICE_TEMPORARILY_UNAVAILABLE";
  const detail: JsonObject = {};
  const claims = textList(error.claims, 12);
  const problems = textList(error.problems, 20);
  const variants = textList(error.variants, 20);
  if (claims) detail.claims = claims;
  if (problems) detail.problems = problems;
  if (variants) detail.variants = variants;
  if (typeof error.problem === "string") detail.problem = error.problem.slice(0, 300);
  if (typeof error.latest_revision === "string") detail.latest_revision = error.latest_revision.slice(0, 200);
  if (typeof error.page_path === "string") detail.page_path = error.page_path.slice(0, 200);
  // #4453 website workspace — which field, its limit, the layouts this style has, the nearest readable colour.
  const { problems: _problems, ...workspace } = workspaceDetail(error);
  Object.assign(detail, workspace);
  return sitesJson({
    ok: false,
    error: {
      code,
      message: ARI_FAILURE_MESSAGES[code],
      retryable: code === "SERVICE_TEMPORARILY_UNAVAILABLE" || code === "DESIGN_PASS_TRY_AGAIN",
      ...detail,
    },
  }, STATUS[code] ?? (status >= 500 && code === "SERVICE_TEMPORARILY_UNAVAILABLE" ? 503 : 409));
}

export type SiteEvidence = {
  /** Deploy-order handshake: this evidence carries the brand's identity. */
  booking_identity: typeof BOOKING_IDENTITY_CAPABILITY;
  /*
   * #4453 PR 2 (booking lock) — `slug`, `contact_email` and `contact_phone`:
   * Ari's buttons may only go to this brand's own Mingla pages and its own
   * mailto/tel, so Studio checks them against these (Core's values).
   */
  brand: {
    id: string;
    name: string | null;
    description: string | null;
    city: string | null;
    slug: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    social_handles: string[];
  };
  offerings: JsonObject[];
};

/**
 * The Mingla facts copy is checked against: the brand's live offerings from
 * Core's own feed (what the site will show) and the brand's own words. Null
 * when either can't be read — Ari's writes then fail closed (unavailable),
 * never checked against nothing.
 */
export async function siteEvidence(
  serviceRpc: (fn: string, args: JsonObject) => Promise<RpcResult>,
  readBrand: (brandId: string) => Promise<JsonObject | null>,
  siteId: string,
  brandId: string,
): Promise<SiteEvidence | null> {
  const [feed, brand] = await Promise.all([
    serviceRpc("brand_site_offerings_feed", { p_site_id: siteId }),
    readBrand(brandId),
  ]);
  if (feed.error || !feed.data || typeof feed.data !== "object" || !brand) return null;
  const offerings = (feed.data as { offerings?: unknown }).offerings;
  if (!Array.isArray(offerings)) return null;
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  return {
    booking_identity: BOOKING_IDENTITY_CAPABILITY,
    brand: {
      id: brandId,
      name: text(brand.name),
      description: text(brand.description),
      city: text(brand.city),
      slug: text(brand.slug),
      contact_email: text(brand.contact_email),
      contact_phone: text(brand.contact_phone),
      social_handles: socialHandlesFrom(brand.social_links),
    },
    offerings: (offerings as JsonObject[]).slice(0, 500).map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      summary: row.summary ?? null,
      destination_text: row.destination_text ?? null,
      start_at: row.start_at ?? null,
      end_at: row.end_at ?? null,
      timezone: row.timezone ?? null,
      min_price_minor: row.min_price_minor ?? null,
      currency: row.currency ?? null,
      capacity: row.capacity ?? null,
      spots_left: row.spots_left ?? null,
      group_minimum: row.group_minimum ?? null,
    })),
  };
}
