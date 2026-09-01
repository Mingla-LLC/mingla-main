import { describe, expect, it } from "vitest";
import { assertRestaurantArtifact, isSafeHref } from "./artifact";

const artifact = {
  schema_version: 1, site_id: "00000000-0000-4000-8000-000000000001",
  brand_id: "00000000-0000-4000-8000-000000000002", renderer_key: "restaurant-website-v1",
  renderer_version: 1, publication_id: "00000000-0000-4000-8000-000000000003",
  source_revision_id: "revision-1", source_digest: "a".repeat(64), generated_at: new Date(0).toISOString(),
  pages: [{ role: "home", slug: "/", title: "Home", enabled: true, nav_label: "Home", nav_order: 0, blocks: [{ type: "hero", heading: "Gogi", media_url: "https://gogi.sites.usemingla.com/media/00000000-0000-4000-8000-000000000004/1440.webp", ctas: [] }] }],
  navigation: { page_roles: ["home"] }, footer: {}, site_settings: { display_name: "Gogi", seo: { canonical_url: "https://gogi.sites.usemingla.com" } }, media: [{ id: "00000000-0000-4000-8000-000000000004", url: "https://gogi.sites.usemingla.com/media/00000000-0000-4000-8000-000000000004/1440.webp", alt: "", width: 1440, height: 900, integrity: "b".repeat(64), object_key: "approved/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000004/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/1440.webp" }], commercial_references: [],
};

describe("Restaurant Website v1 artifact boundary", () => {
  it("accepts the fixed pilot contract", () => { expect(() => assertRestaurantArtifact(artifact)).not.toThrow(); });
  it("fails closed for another renderer, extra root keys, or unsafe links", () => {
    expect(() => assertRestaurantArtifact({ ...artifact, renderer_key: "template-picker" })).toThrow();
    expect(() => assertRestaurantArtifact({ ...artifact, provider: "hidden" })).toThrow();
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref("https://usemingla.com/b/gogi")).toBe(true);
  });
  it("rejects additional block properties and unsafe nested CTA links", () => {
    const extra = structuredClone(artifact);
    Object.assign(extra.pages[0].blocks[0], { provider_metadata: "hidden" });
    expect(() => assertRestaurantArtifact(extra)).toThrow();
    const nested = structuredClone(artifact);
    Object.assign(nested.pages[0].blocks[0], {
      ctas: [{ label: "Book", href: "javascript:alert(1)" }],
    });
    expect(() => assertRestaurantArtifact(nested)).toThrow();
  });
});
