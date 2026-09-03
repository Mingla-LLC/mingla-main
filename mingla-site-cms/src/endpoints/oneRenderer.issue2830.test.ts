import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #2830 -- THE CMS MUST NOT RENDER.
 *
 * Mingla shipped two renderers: `RestaurantV1` in the public runtime, and an
 * inline HTML string in this endpoints file that served every preview. They had
 * diverged badly. The CMS one special-cased hero and hours_location and then
 * emitted a heading plus one paragraph for EVERY other block type, so it
 * dropped images, galleries, CTAs, offering grids, menu links, FAQs and
 * testimonials outright, and set a different typeface. A brand owner reviewed
 * one website and published a different one.
 *
 * This suite is the guard against that returning. It is deliberately blunt: any
 * document markup in this file is a second renderer being born.
 */
const source = fs.readFileSync(
  path.resolve(process.cwd(), "src/endpoints/sitesEndpoints.ts"),
  "utf8",
);

describe("#2830 one renderer", () => {
  it("the CMS emits no HTML document of its own", () => {
    expect(source).not.toContain("<!doctype html>");
    expect(source).not.toContain("<!DOCTYPE html>");
    for (const tag of ["<body", "<main", "<h1>", "<header>", "fact-rail"]) {
      expect(source).not.toContain(tag);
    }
  });

  it("no response is served as an HTML document", () => {
    expect(source).not.toContain('"content-type": "text/html');
  });

  it("preview builds the artifact with the PUBLICATION builder", () => {
    const preview = source.slice(source.indexOf("async function previewDraft"));
    expect(preview).toContain("buildPublicationArtifact(req, {");
    expect(preview).toContain("PREVIEW_PUBLICATION_PREFIX");
  });

  it("preview hands off to the public runtime rather than answering itself", () => {
    const preview = source.slice(source.indexOf("async function previewDraft"));
    expect(preview).toContain("cmsConfig().publicRuntimeOrigin");
    expect(preview).toContain("status: 302");
    expect(preview).toContain('"referrer-policy": "no-referrer"');
  });

  it("the preview marker is distinguishable from a real publication", () => {
    expect(source).toContain('PREVIEW_PUBLICATION_PREFIX = "preview-"');
  });

  it("still refuses a preview whose draft moved under it", () => {
    const preview = source.slice(source.indexOf("async function previewDraft"));
    expect(preview).toContain("REVISION_CONFLICT");
  });

  it("still binds the tenant to the grant before building anything", () => {
    const preview = source.slice(source.indexOf("async function previewDraft"));
    const tenantCheck = preview.indexOf("core_site_id");
    const build = preview.indexOf("buildPublicationArtifact");
    expect(tenantCheck).toBeGreaterThan(-1);
    expect(tenantCheck).toBeLessThan(build);
  });
});
