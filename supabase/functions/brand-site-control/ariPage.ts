/**
 * #4453 milestone 11 (spec v2.1 §3) — "Add a page with Ari", Core's side.
 *
 * Ari's two actions reach Studio only while SITES_ARI_ADD_PAGE covers the
 * brand (`brand_site_flag_on`; never the caller's value). Core then signs
 * `add_page` and `review_drafts` in, so the page is written hidden as a Draft
 * by Ari and every block it adds is Draft.
 */
export const ARI_PAGE_ACTIONS: ReadonlySet<string> = new Set([
  "propose_site_page",
  "answer_site_page_question",
]);

/** The owner's own Draft-page actions on the content route (rank ≥ the content minimum). */
export const OWNER_ARI_PAGE_ACTIONS: ReadonlySet<string> = new Set([
  "ari_page_answer",
  "ari_page_accept",
  "ari_page_remove",
]);
