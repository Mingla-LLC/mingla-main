import type { CollectionConfig, CollectionSlug, PayloadRequest } from "payload";
import { Footer } from "../collections/Footer";
import { Navigation } from "../collections/Navigation";
import { Pages } from "../collections/Pages";
import { SiteSettings } from "../collections/SiteSettings";
import { Categories, Destinations, Stories, Testimonials } from "../collections/SiteContent";
import { collectMediaIds } from "./mediaFields";
import { findAllTenantPages } from "./tenantPages";
import { contentMediaIds, findTenantContent } from "./siteContent";

/*
 * #2829 — every tenant collection that can hold site media. A drift test
 * checks this against the tenant-scoped collections in payload.config, so a
 * new tenant collection cannot be left out of the in-use scan; the media
 * FIELDS inside each are derived from its schema (mediaFields.ts).
 */
export const TENANT_MEDIA_HOLDERS: readonly CollectionConfig[] = [
  Pages,
  SiteSettings,
  Navigation,
  Footer,
  Destinations,
  Stories,
  Categories,
  Testimonials,
];

/** Tenant collections that are not site content (they never hold site media). */
// #2829 W9b — the work log and the design-check runs hold no media and are
// written only by Studio's signed endpoints (no Studio or REST write access).
export const NON_CONTENT_TENANT_COLLECTIONS: readonly string[] = ["media", "publication-jobs", "work-log", "design-check-runs"];

/**
 * Every media id the tenant's draft content uses anywhere — every page (never
 * a capped read), every content entry, the settings, navigation and footer.
 */
export async function tenantMediaInUse(req: PayloadRequest, tenantId: string): Promise<Set<string>> {
  const used = new Set<string>();
  const pages = await findAllTenantPages(req, tenantId);
  for (const page of pages) collectMediaIds(Pages.fields, page, used);
  for (const id of contentMediaIds(await findTenantContent(req, tenantId))) used.add(id);
  for (const holder of [SiteSettings, Navigation, Footer]) {
    const result = await req.payload.find({
      collection: holder.slug as CollectionSlug,
      overrideAccess: false,
      req,
      draft: true,
      depth: 0,
      pagination: false,
      where: { tenant: { equals: tenantId } },
    });
    for (const doc of result.docs) collectMediaIds(holder.fields, doc, used);
  }
  return used;
}
