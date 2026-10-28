/*
 * #2829 W2 — a draft preview actually LOADS, for any page.
 *
 * Found by the W2 local exit run: every runtime preview answered 404. A
 * preview artifact's publication id is `preview-<32 hex>` (that marker is
 * what stops the preview route serving a real publication), but the public
 * contract demands a UUID publication id, so `loadPreviewArtifact` refused
 * every preview it was handed. Here a real preview artifact goes through the
 * real loader (only storage is stubbed) and then through the route resolver.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "./crypto";

const objects = new Map<string, Uint8Array>();
vi.mock("./config", () => ({ runtimeConfig: () => ({ artifactBucket: "artifacts" }) }));
vi.mock("./storageReader", () => ({
  readPrivateObject: async (_bucket: string, key: string) => {
    const bytes = objects.get(key);
    return bytes
      ? new Response(bytes.slice().buffer as ArrayBuffer, { status: 200 })
      : new Response(null, { status: 404 });
  },
}));

import { loadPreviewArtifact, parsePreviewArtifactKey } from "./previewArtifact";
import { resolveSitePath } from "./pageRouting";

const SITE = "00000000-0000-4000-8000-000000000d01";
const BRAND = "00000000-0000-4000-8000-000000000d02";
const PREVIEW = `preview-${"a1".repeat(16)}`;
const block = (heading: string) => ({ type: "rich_text", heading, paragraphs: [{ text: `${heading} text` }] });

function artifact(publicationId = PREVIEW) {
  return {
    schema_version: 1,
    site_id: SITE,
    brand_id: BRAND,
    renderer_key: "restaurant-website-v1",
    renderer_version: 1,
    publication_id: publicationId,
    source_revision_id: "4",
    source_digest: "d".repeat(64),
    generated_at: "2026-10-26T00:00:00Z",
    pages: [
      { path: "", title: "Home", enabled: true, kind: "standard", blocks: [block("Home")] },
      { path: "resources", title: "Resources", enabled: true, kind: "standard", blocks: [block("Resources")] },
      { path: "resources/faqs", title: "FAQs", enabled: true, kind: "standard", blocks: [block("FAQs")] },
    ],
    navigation: { items: [{ label: "Resources", href: "/resources", children: [{ label: "FAQs", href: "/resources/faqs" }] }] },
    site_routes: {
      routes: { trips: "trips", events: "events", experiences: "experiences", destinations: "destinations", stories: "stories" },
      redirects: [],
      language: "en",
    },
    footer: {},
    site_settings: { display_name: "Preview", seo: { canonical_url: "https://preview.sites.localhost" } },
    media: [],
    commercial_references: [],
  };
}

async function store(value: unknown, publicationId = PREVIEW) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await sha256(bytes);
  const key = `publications/${SITE}/${publicationId}/${digest}.json`;
  objects.set(key, bytes);
  return parsePreviewArtifactKey(key)!;
}

beforeEach(() => objects.clear());

describe("#2829 a draft preview loads and resolves any page", () => {
  it("loads a preview artifact and serves its nested page", async () => {
    const parsed = await store(artifact());
    const loaded = await loadPreviewArtifact(parsed, { site_id: SITE, brand_id: BRAND, hostname: "preview.sites.localhost" } as never);
    expect(loaded.publication_id).toBe(PREVIEW);
    const resolved = resolveSitePath(loaded, "resources/faqs");
    expect(resolved.kind === "page" && resolved.page.title).toBe("FAQs");
  });

  it("still refuses a preview for another site's host, a tampered body, or an id that does not match the key", async () => {
    const parsed = await store(artifact());
    await expect(loadPreviewArtifact(parsed, { site_id: BRAND } as never)).rejects.toThrow("NOT_FOUND");
    const mismatched = await store(artifact(`preview-${"b2".repeat(16)}`));
    const wrongKey = parsePreviewArtifactKey(mismatched.key.replace(`preview-${"b2".repeat(16)}`, PREVIEW))!;
    await expect(loadPreviewArtifact(wrongKey, { site_id: SITE } as never)).rejects.toThrow("NOT_FOUND");
    const broken = await store({ ...artifact(), pages: [] });
    await expect(loadPreviewArtifact(broken, { site_id: SITE } as never)).rejects.toThrow();
  });
});
