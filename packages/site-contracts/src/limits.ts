/**
 * #2829 — the hard limits of a Mingla Site, named once.
 *
 * Every reader and writer (Studio, the publication builder, the public
 * runtime, Ari's tools) counts against these same numbers, so a site that
 * Studio accepts is a site the runtime will serve. A limit is a refusal with a
 * named reason, never a silent truncation: the six-page bug (#2829 W2) was a
 * read capped below what the editor allowed, which dropped a page from
 * publish, preview and the media reference scan without anyone noticing.
 */
export const MAX_PAGES_PER_SITE = 100;
/** Home is depth 0; a page under a page under a top-level page is depth 3. */
export const MAX_PAGE_DEPTH = 3;
export const MAX_BLOCKS_PER_PAGE = 60;
export const MAX_NAV_ITEMS = 8;
export const MAX_NAV_CHILDREN = 8;
export const MAX_REDIRECTS = 200;
export const MAX_PAGE_TITLE_LENGTH = 80;
export const MAX_SLUG_LENGTH = 60;
export const MAX_NAV_LABEL_LENGTH = 40;
