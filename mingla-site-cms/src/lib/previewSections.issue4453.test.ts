/*
 * #4453 website workspace (build contract D) — a private preview knows which
 * Studio section drew each block, and a publish is untouched by it.
 *
 *   - The builder reports, for every page, the section id of each block that
 *     SURVIVED the build, in the artifact's own block order. Sections the
 *     builder drops (an empty menu, a "Keep exploring" with too few pages)
 *     leave no gap, so the list always lines up with the artifact.
 *   - The ids are never in the artifact: the same draft with and without
 *     section ids builds the SAME bytes, and the public contract refuses a
 *     page that carries a section list under any name.
 *   - Only a `preview-` artifact gets the list stored beside it; failing to
 *     store it never fails the preview.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = new Map<string, Uint8Array>();
vi.mock("./config", () => ({ cmsConfig: () => ({ artifactBucket: "artifact-bucket" }) }));
vi.mock("./observability", async (original) => ({ ...(await original<typeof import("./observability")>()), emitCmsObservation: async () => {} }));
vi.mock("./gateway", async (original) => ({
  ...(await original<typeof import("./gateway")>()),
  readCoreProjection: async () => ({ offerings: [], menu: [], menu_venue_id: null }),
}));
vi.mock("./objectStore", () => ({
  writeObject: async (bucket: string, key: string, bytes: Uint8Array) => {
    stored.set(`${bucket}:${key}`, bytes);
  },
  readObject: async (bucket: string, key: string) => {
    const value = stored.get(`${bucket}:${key}`);
    if (!value) throw new Error("STORAGE_UNAVAILABLE");
    return value;
  },
}));

import { buildPublicationArtifact, publicationDraftDigest } from "./artifactBuilder";
import { assertArtifactV2 } from "../contracts/generated/artifactV2.ts";
import {
  buildPreviewSections,
  MAX_PREVIEW_SECTIONS_BYTES,
  previewSectionIdsFor,
  previewSectionsKey,
} from "../contracts/generated/previewSections.ts";

const SITE = "00000000-0000-4000-8000-000000000d02";
const BRAND = "00000000-0000-4000-8000-000000000d03";
const ID = (n: number) => `${String(n).padStart(2, "0")}a1b2c3d4e5f6a7b8c9d0e1f2`.slice(0, 24);

const faq = (id: string | undefined, heading: string) => ({ ...(id ? { id } : {}), blockType: "faq", heading, items: [{ question: `${heading}?`, answer: "Yes." }] });
/** Home: a kept section, a menu with no Mingla menu (dropped), "Keep exploring", a kept section. */
const pagesWith = (ids: boolean, menuPagesCount: 1 | 3) => {
  const id = (n: number) => (ids ? ID(n) : undefined);
  const withId = (n: number, block: Record<string, unknown>) => ({ ...(ids ? { id: ID(n) } : {}), ...block });
  const pages: Array<Record<string, unknown>> = [
    { id: "h", tenant: "t", slug: "", parent: null, title: "Home", enabled: true, blocks: [
      faq(id(1), "First"),
      withId(2, { blockType: "menu_board", heading: "Menu" }),
      withId(3, { blockType: "page_links", heading: "Keep exploring", mode: "teaser" }),
      faq(id(4), "Last"),
    ] },
    { id: "a", tenant: "t", slug: "about", parent: null, title: "About", enabled: true, blocks: [faq(id(5), "About us"), withId(6, { blockType: "menu_preview" })] },
  ];
  if (menuPagesCount === 3) {
    pages.push({ id: "b", tenant: "t", slug: "stay", parent: null, title: "Stay", enabled: true, blocks: [faq(id(7), "Stay")] });
  }
  return pages;
};
const navigationFor = (pages: Array<Record<string, unknown>>) => ({
  id: "n", tenant: "t",
  items: pages.filter((page) => page.slug !== "").map((page) => ({ label: String(page.title), target_type: "page", page: page.id })),
});

async function build(pages: Array<Record<string, unknown>>, publicationId: string) {
  const settings = { id: "s", tenant: "t", display_name: "Sections" };
  const navigation = navigationFor(pages);
  const footer = { id: "f", tenant: "t" };
  const collections: Record<string, unknown[]> = { pages, navigation: [navigation], footer: [footer], "site-settings": [settings], media: [] };
  const sourceDigest = await publicationDraftDigest({ pages, navigation, footer, settings, media: [] });
  return buildPublicationArtifact(
    { context: {}, payload: { find: async ({ collection }: { collection: string }) => ({ docs: collections[collection] ?? [] }) } } as never,
    {
      tenant: { id: "t", core_site_id: SITE, core_brand_id: BRAND, primary_hostname: "sections.sites.localhost" },
      operationId: "op", publicationId, sourceRevisionId: "r", sourceDigest, generatedAt: "2026-11-18T00:00:00Z",
    },
  );
}

const PREVIEW_ID = `preview-${"c".repeat(32)}`;
const PUBLICATION_ID = "00000000-0000-4000-8000-000000000d04";

beforeEach(() => stored.clear());

describe("#4453 D: the builder reports the section behind every surviving block", () => {
  it("lines up with the artifact's blocks when the builder drops sections", async () => {
    const built = await build(pagesWith(true, 1), PREVIEW_ID);
    const home = built.artifact.pages.find((page) => page.path === "")!;
    const about = built.artifact.pages.find((page) => page.path === "about")!;
    // The empty menu is dropped; with one other page "Keep exploring" has too few pages and is dropped too.
    expect(home.blocks.map((block) => block.type)).toEqual(["faq", "faq"]);
    expect(about.blocks.map((block) => block.type)).toEqual(["faq"]);
    expect(built.sectionIds).toEqual([
      { path: "", ids: [ID(1), ID(4)] },
      { path: "about", ids: [ID(5)] },
    ]);
  });

  it("keeps a surviving 'Keep exploring' in its place", async () => {
    const built = await build(pagesWith(true, 3), PREVIEW_ID);
    const home = built.artifact.pages.find((page) => page.path === "")!;
    expect(home.blocks.map((block) => block.type)).toEqual(["faq", "page_links", "faq"]);
    expect(built.sectionIds.find((page) => page.path === "")!.ids).toEqual([ID(1), ID(3), ID(4)]);
    for (const page of built.artifact.pages) {
      expect(built.sectionIds.find((entry) => entry.path === page.path)!.ids).toHaveLength(page.blocks.length);
    }
  });

  it("a section with no usable id is listed as '' (never guessed)", async () => {
    const pages = pagesWith(true, 1);
    (pages[0]!.blocks as Array<Record<string, unknown>>)[0]!.id = "not an id; <script>";
    delete (pages[1]!.blocks as Array<Record<string, unknown>>)[0]!.id;
    const built = await build(pages, PREVIEW_ID);
    expect(built.sectionIds).toEqual([{ path: "", ids: ["", ID(4)] }, { path: "about", ids: [""] }]);
  });
});

describe("#4453 D: a published artifact is byte-for-byte what it was", () => {
  it("section ids never reach the artifact: with and without them the bytes are the same", async () => {
    const withIds = await build(pagesWith(true, 3), PUBLICATION_ID);
    const key = withIds.artifactKey;
    const bytesWithIds = stored.get(`artifact-bucket:${key}`)!;
    stored.clear();
    const withoutIds = await build(pagesWith(false, 3), PUBLICATION_ID);
    // The draft digest differs (the draft has ids), so compare everything else: the artifact minus its source digest.
    const strip = (serialized: string) => serialized.replace(/"source_digest":"[0-9a-f]{64}"/, '"source_digest":"x"');
    expect(strip(withIds.serialized)).toBe(strip(withoutIds.serialized));
    expect(new TextDecoder().decode(bytesWithIds)).toBe(withIds.serialized);
    for (const n of [1, 2, 3, 4, 5, 6, 7]) expect(withIds.serialized).not.toContain(ID(n));
    expect(withIds.serialized).not.toMatch(/section_ids|sectionIds|preview_section/);
    // Exactly one object is written for a build: the artifact.
    expect([...stored.keys()]).toEqual([`artifact-bucket:${withoutIds.artifactKey}`]);
  });

  it("the artifact still passes the public contract, and the contract refuses a page that carries a section list", async () => {
    const built = await build(pagesWith(true, 3), PUBLICATION_ID);
    const artifact = JSON.parse(built.serialized) as { pages: Array<Record<string, unknown>> };
    expect(() => assertArtifactV2(structuredClone(artifact))).not.toThrow();
    for (const name of ["preview_section_ids", "previewSectionIds", "section_ids", "sections"]) {
      const tampered = structuredClone(artifact);
      tampered.pages[0]![name] = [ID(1), ID(3), ID(4)];
      expect(() => assertArtifactV2(tampered), name).toThrow("ARTIFACT_PAGE_PATH_MISMATCH");
    }
    // Nor may a block carry its section id.
    const tamperedBlock = structuredClone(artifact) as { pages: Array<{ blocks: Array<Record<string, unknown>> }> };
    tamperedBlock.pages[0]!.blocks[0]!.id = ID(1);
    expect(() => assertArtifactV2(tamperedBlock)).toThrow();
    // Nor the artifact itself.
    expect(() => assertArtifactV2({ ...structuredClone(artifact), preview_sections: {} })).toThrow("ARTIFACT_SCHEMA_MISMATCH");
  });

  it("a rollback reports no sections", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/lib/artifactBuilder.ts"), "utf8");
    const rollback = source.slice(source.indexOf("export async function buildRollbackPublicationArtifact"));
    expect(rollback).toContain("sectionIds: [],");
  });
});

describe("#4453 D: the section list is stored beside a PREVIEW artifact only", () => {
  it("names the object beside a preview artifact, and nothing for a real publication", () => {
    const digest = "d".repeat(64);
    expect(previewSectionsKey(`publications/${SITE}/${PREVIEW_ID}/${digest}.json`)).toBe(`publications/${SITE}/${PREVIEW_ID}/${digest}.sections`);
    // Not `.json`: nothing that lists a site's preview artifacts mistakes it for one.
    expect(previewSectionsKey(`publications/${SITE}/${PREVIEW_ID}/${digest}.json`)!.endsWith(".json")).toBe(false);
    for (const bad of [
      `publications/${SITE}/${PUBLICATION_ID}/${digest}.json`,
      `publications/${SITE}/${PREVIEW_ID}/${digest}.sections`,
      `publications/${SITE}/${PREVIEW_ID}/../${PREVIEW_ID}/${digest}.json`,
      `plan-previews/${SITE}/${PREVIEW_ID}/${digest}.json`,
      `publications/${SITE}/${PREVIEW_ID}/${digest}.json?x=1`,
      "",
    ]) expect(previewSectionsKey(bad), bad).toBeNull();
  });

  it("stores the list for a preview build, readable back page by page", async () => {
    const { storePreviewSections } = await import("../endpoints/sitesEndpoints");
    const built = await build(pagesWith(true, 3), PREVIEW_ID);
    const writes: Array<{ bucket: string; key: string; bytes: Uint8Array; type: string }> = [];
    const ok = await storePreviewSections(built, async (bucket, key, bytes, type) => { writes.push({ bucket, key, bytes, type }); });
    expect(ok).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.bucket).toBe("artifact-bucket");
    expect(writes[0]!.key).toBe(built.artifactKey.replace(/\.json$/, ".sections"));
    expect(writes[0]!.bytes.byteLength).toBeLessThan(MAX_PREVIEW_SECTIONS_BYTES);
    const list = JSON.parse(new TextDecoder().decode(writes[0]!.bytes));
    expect(list).toEqual(buildPreviewSections(built.artifactDigest, built.sectionIds));
    for (const page of built.artifact.pages) {
      expect(previewSectionIdsFor(list, { artifactDigest: built.artifactDigest, pagePath: page.path, blockCount: page.blocks.length }))
        .toEqual(built.sectionIds.find((entry) => entry.path === page.path)!.ids);
    }
  });

  it("stores nothing for a real publication, and a failed write never fails the preview", async () => {
    const { storePreviewSections } = await import("../endpoints/sitesEndpoints");
    const published = await build(pagesWith(true, 3), PUBLICATION_ID);
    const write = vi.fn(async () => {});
    expect(await storePreviewSections(published, write)).toBe(false);
    expect(write).not.toHaveBeenCalled();
    const preview = await build(pagesWith(true, 3), PREVIEW_ID);
    await expect(storePreviewSections(preview, async () => { throw new Error("STORAGE_UNAVAILABLE"); })).resolves.toBe(false);
  });

  it("only the private preview stores it: publish, export and the plan preview never do", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/endpoints/sitesEndpoints.ts"), "utf8");
    const calls = [...source.matchAll(/await storePreviewSections\(/g)];
    expect(calls).toHaveLength(1);
    const preview = source.slice(source.indexOf("async function previewDraft"), source.indexOf("await reportPreviewBuilt("));
    expect(preview).toContain("await storePreviewSections(built);");
    expect(preview.indexOf("buildPublicationArtifact(req, {")).toBeLessThan(preview.indexOf("await storePreviewSections(built);"));
  });
});

describe("#4453 D: reading the list is strict (anything odd means no section marks)", () => {
  const digest = "a".repeat(64);
  const list = buildPreviewSections(digest, [{ path: "", ids: [ID(1), "", ID(4)] }, { path: "about", ids: [ID(5)] }]);
  const read = (value: unknown, over: Partial<{ artifactDigest: string; pagePath: string; blockCount: number }> = {}) =>
    previewSectionIdsFor(value, { artifactDigest: digest, pagePath: "", blockCount: 3, ...over });

  it("answers the page's ids", () => {
    expect(read(list)).toEqual([ID(1), "", ID(4)]);
    expect(read(list, { pagePath: "about", blockCount: 1 })).toEqual([ID(5)]);
  });

  it("refuses another artifact's list, an unknown page, a wrong length, a wrong version", () => {
    expect(read(list, { artifactDigest: "b".repeat(64) })).toBeNull();
    expect(read(list, { pagePath: "nope" })).toBeNull();
    expect(read(list, { pagePath: "constructor" })).toBeNull();
    expect(read(list, { blockCount: 2 })).toBeNull();
    expect(read({ ...list, v: 2 })).toBeNull();
    expect(read(null)).toBeNull();
    expect(read([list])).toBeNull();
    expect(read(JSON.stringify(list))).toBeNull();
  });

  it("refuses a malformed or repeated id", () => {
    expect(read({ ...list, pages: { "": [ID(1), "<img>", ID(4)] } })).toBeNull();
    expect(read({ ...list, pages: { "": [ID(1), ID(1), ID(4)] } })).toBeNull();
    expect(read({ ...list, pages: { "": [ID(1), 7, ID(4)] } })).toBeNull();
    expect(read({ ...list, pages: [] })).toBeNull();
  });

  it("the writer turns anything that is not a plain id into ''", () => {
    expect(buildPreviewSections(digest, [{ path: "", ids: [ID(1), null, "x y", 4, "ok_id-1"] }]).pages[""]).toEqual([ID(1), "", "", "", "ok_id-1"]);
  });
});
