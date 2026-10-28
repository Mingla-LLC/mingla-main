/*
 * #2829 W9f (A18 item 3) — "Download everything" failed with a 503 because the
 * export copied every media original into one zip (~520 MB for Young &
 * Stamped) and the artifact bucket refuses objects over 20 MiB. Media now
 * travels as signed 24-hour links, so the zip stays small whatever the media
 * weighs, and every collection entry is included (SC-7).
 */
import { describe, expect, it } from "vitest";
import { buildExportEntries, buildZip, zipEntryNames } from "./siteExport";

const SITE = "6adbcf2d-609d-402c-97e0-88ade24b0c4b";
const ARTIFACT_OBJECT_LIMIT = 20 * 1024 * 1024; // bootstrap-sites-cms.sql, sites-publication-artifacts

function mediaRows(count: number, bytesEach: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    state: "READY",
    alt: `photo ${index + 1}`,
    detected_mime: index % 10 === 0 ? "video/mp4" : "image/webp",
    original_filename_safe: `file-${index + 1}`,
    bytes: bytesEach,
    approved_master_key: `approved/${SITE}/${index + 1}/${"a".repeat(64)}/master.${index % 10 === 0 ? "mp4" : "webp"}`,
  }));
}

async function exportOf(media: Record<string, unknown>[], signed: string[] = []) {
  return buildExportEntries({
    siteId: SITE,
    brandId: "4cb672ab-6e9c-441e-ade4-3a10d2619432",
    tenantName: "Young & Stamped",
    address: "youngandstamped.sites.localhost",
    exportedAt: "2026-10-26T00:00:00.000Z",
    pages: [{ id: 1, title: "Home" }],
    navigation: [{ id: 1 }],
    footer: [{ id: 1 }],
    settings: [{ id: 1 }],
    collections: { destinations: [{ id: 7 }], stories: [], categories: [], testimonials: [{ id: 9 }] },
    media,
    activeArtifact: new TextEncoder().encode("{\"pages\":[]}"),
    signMediaLink: async (key) => {
      signed.push(key);
      return `https://storage.example/${key}?X-Amz-Expires=86400`;
    },
  });
}

describe("#2829 W9f export", () => {
  it("stays under the artifact bucket's 20 MiB object limit for a site with ~520 MB of media", async () => {
    const entries = await exportOf(mediaRows(156, 3_400_000));
    const zip = buildZip(entries);
    expect(zip.byteLength).toBeLessThan(ARTIFACT_OBJECT_LIMIT);
    expect(zip.byteLength).toBeLessThan(1024 * 1024);
  });

  it("gives every ready media original a signed link instead of copying its bytes", async () => {
    const signed: string[] = [];
    const rows = [...mediaRows(3, 1000), { id: 99, state: "PROCESSING", approved_master_key: null }];
    const entries = await exportOf(rows, signed);
    const names = zipEntryNames(buildZip(entries));
    expect(names.some((name) => name.startsWith("media/"))).toBe(false);
    expect(signed).toEqual(rows.slice(0, 3).map((row) => row.approved_master_key));
    const manifest = JSON.parse(new TextDecoder().decode(entries.find((e) => e.name === "media.json")!.bytes));
    expect(manifest).toHaveLength(4);
    expect(manifest[0]).toMatchObject({ id: 1, file: "1.mp4", download_url: expect.stringContaining(`approved/${SITE}/1/`) });
    expect(manifest[3]).toMatchObject({ id: 99, file: null, download_url: null });
    const links = new TextDecoder().decode(entries.find((e) => e.name === "media-download-links.txt")!.bytes);
    expect(links.trim().split("\n")).toHaveLength(3);
  });

  it("includes every page, setting, collection entry and the active artifact", async () => {
    const names = zipEntryNames(buildZip(await exportOf([])));
    expect(names).toEqual(expect.arrayContaining([
      "site.json", "pages.json", "navigation.json", "footer.json", "settings.json",
      "collections/destinations.json", "collections/stories.json", "collections/categories.json",
      "collections/testimonials.json", "media.json", "media-download-links.txt", "README.txt",
      "active-artifact.json",
    ]));
  });

  it("refuses a media key from another site", async () => {
    await expect(exportOf([{ id: 1, state: "READY", approved_master_key: "approved/other-site/1/x/master.webp" }]))
      .rejects.toThrow("TENANT_MISMATCH");
  });
});
