/*
 * #2829 — the Website query key factory (moved out of useBrandSite.ts so the
 * boot path can use a key without the Website service). One factory.
 */
// #2829 — every Website query key comes from this factory (Constitution 4);
// all of them live under `all`, which logout clears with the query cache.
export const brandSiteKeys = {
  all: ["brand-sites"] as const,
  detail: (brandId: string) => ["brand-sites", brandId] as const,
  label: (brandId: string) => ["brand-sites", brandId, "label"] as const,
  availability: (brandId: string) =>
    ["brand-sites", brandId, "availability"] as const,
  operation: (siteId: string | null, operationId: string | null) =>
    ["brand-sites", siteId, "operation", operationId] as const,
  versions: (siteId: string | null) =>
    ["brand-sites", siteId, "versions"] as const,
  analytics: (siteId: string | null) =>
    ["brand-sites", siteId, "analytics"] as const,
  exports: (siteId: string | null, operationId: string | null) =>
    ["brand-sites", siteId, "exports", operationId] as const,
  enquiries: (siteId: string | null) =>
    ["brand-sites", siteId, "enquiries"] as const,
  plan: (brandId: string) => ["brand-sites", brandId, "plan"] as const,
  /** #2829 W9a — the Home to-do row derived from the plan (refreshed with it). */
  planTodo: (brandId: string) => ["brand-sites", brandId, "plan", "todo"] as const,
  domains: (siteId: string | null) =>
    ["brand-sites", siteId, "domains"] as const,
  look: (siteId: string | null) => ["brand-sites", siteId, "look"] as const,
  fontSearch: (siteId: string | null, query: string) =>
    ["brand-sites", siteId, "font-search", query] as const,
  // #2829 W9r — Website content, past trips, changes, counts, preview size.
  content: (siteId: string | null, collection: string) => ["brand-sites", siteId, "content", collection] as const,
  contentEntry: (siteId: string | null, collection: string, id: string) =>
    ["brand-sites", siteId, "content", collection, id] as const,
  siteData: (siteId: string | null, what: string) => ["brand-sites", siteId, "data", what] as const,
  previewDevice: (userId: string | null) => ["brand-sites", "preview-device", userId] as const,
  /** #2829 W10 — the site's private share-preview links. */
  shareLinks: (siteId: string | null) => ["brand-sites", siteId, "share-links"] as const,
};
