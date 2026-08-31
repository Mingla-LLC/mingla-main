import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  fs.readFileSync(path.resolve(process.cwd(), relative), "utf8");

describe("#2830 stripped Studio and preview contract", () => {
  it("uses only approved navigation and routes Media to the safe manager", () => {
    const nav = read("src/components/StudioNav.tsx");
    for (const label of [
      "Pages",
      "Media",
      "Navigation",
      "Footer",
      "Site settings & SEO",
      "Preview",
      "View live site",
      "Return to Mingla",
    ]) expect(nav).toContain(`"${label}"`);
    expect(nav).toContain('["Media", "/studio/media"]');
    expect(nav).not.toContain('["Media", "/admin/collections/media"]');
  });

  it("includes complete preview chrome with fixed responsive widths", () => {
    const preview = read("src/components/PreviewChrome.tsx");
    expect(preview).toContain('mobile: "320px"');
    expect(preview).toContain('tablet: "768px"');
    expect(preview).toContain('desktop: "min(100%, 1440px)"');
    for (const control of [
      "Close",
      "Refresh",
      "Revision",
      "Expires",
      "Private preview — not live",
      "Publish this revision",
    ]) expect(preview).toContain(control);
  });

  it("owns the executable grant, exact PUT, completion, poll and READY path", () => {
    const client = read("src/lib/studioMediaClient.ts");
    const manager = read("src/components/StudioMediaManager.tsx");
    const endpoints = read("src/endpoints/sitesEndpoints.ts");
    const styles = read("src/app/(payload)/studio.css");
    expect(client).toContain('"/api/mingla/media/upload-grants"');
    expect(client).toContain("grant.upload_url");
    expect(client).toContain("grant.required_headers");
    expect(client).toContain("/complete");
    expect(client).toContain("for (let attempt = 0; attempt < 10; attempt += 1)");
    expect(manager).toContain("JPEG, PNG or WebP");
    expect(manager).toContain("20 MB and 40 megapixels");
    expect(manager).toContain("This image is decorative");
    expect(manager).toContain("Retry");
    expect(manager).toContain("Replace");
    expect(manager).toContain("Dismiss");
    expect(manager).toContain("Remove unused");
    expect(manager).toContain("Use in draft");
    expect(manager).toContain("window.location.assign(result.return_url)");
    expect(manager).not.toContain("mingla:media-selected");
    expect(client).toContain('"/api/mingla/media-library"');
    expect(client).toContain("/attach");
    expect(endpoints).toContain("applyStudioMediaSelection");
    expect(endpoints).toContain("draft: true");
    expect(endpoints).toContain("assertMutationRequest(req.headers)");
    expect(endpoints).toContain("state: 8");
    expect(styles).toContain("repeat(4, minmax(0, 1fr))");
    expect(styles).toContain("repeat(3, minmax(0, 1fr))");
    expect(styles).toContain("repeat(2, minmax(0, 1fr))");
  });

  it("keeps generic Payload upload paths unavailable", () => {
    const media = read("src/collections/Media.ts");
    const styles = read("src/app/(payload)/studio.css");
    expect(media).toContain("tenantMediaCreate");
    expect(media).toContain("rejectDirectPayloadUpload");
    expect(styles).toContain('[data-collection-slug="media"] .upload');
  });
});
