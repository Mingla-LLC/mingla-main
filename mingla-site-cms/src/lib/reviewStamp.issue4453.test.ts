/*
 * #4453 PR 3 (content foundation, spec v1 §4.3) — the Draft stamp.
 *
 * invariant: I-SITES-DRAFT-NEVER-PUBLISHED (declared in
 * packages/site-contracts/src/publishChecks.ts). This suite pins: the
 * composer's and Ari's writes stamp new or changed sections Draft and a
 * caller can never set the stamp; "Looks right" and a person's own save
 * review a section; a publish with one Draft section on an enabled page is
 * refused with UNREVIEWED_SECTIONS (SC-4.2) and succeeds once reviewed; the
 * stamp never reaches the artifact (SC-4.1); every Studio block carries the
 * hidden field and Studio's migration adds its column for every block type.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({ cmsConfig: () => ({ artifactBucket: "artifact-bucket" }) }));
vi.mock("./observability", () => ({ emitCmsObservation: async () => {}, observeCmsEndpoint: (_r: string, _d: string, handler: unknown) => handler }));
vi.mock("./gateway", () => ({
  readCoreProjection: async () => ({ offerings: [], menu: [], menu_venue_id: null }),
  callCore: vi.fn(),
  verifyCoreRequest: vi.fn(),
}));
const stored = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock("./objectStore", () => ({
  writeObject: async (bucket: string, key: string, bytes: Uint8Array) => { stored.set(`${bucket}:${key}`, bytes); },
  readObject: async (bucket: string, key: string) => {
    const value = stored.get(`${bucket}:${key}`);
    if (!value) throw new Error("STORAGE_UNAVAILABLE");
    return value;
  },
}));

import { siteBlocks } from "../blocks/siteBlocks";
import { buildPublicationArtifact, publicationDraftDigest } from "./artifactBuilder";
import { assertNoUnreviewedSections, pageReviewSummary, stampBlockReview, stampBlocks, UnreviewedSectionsError } from "./reviewStamp";
import { UNREVIEWED_SECTIONS, draftChipLabel, unreviewedPages } from "../contracts/generated/publishChecks.ts";

const NOW = "2026-11-16T10:00:00.000Z";
const block = (id: string, heading: string, extra: Record<string, unknown> = {}) => ({ id, blockType: "page_header", heading, ...extra });

describe("#4453 stampBlocks", () => {
  it("the composer's write stamps every new section Draft and drops a caller's stamp", () => {
    const out = stampBlocks([block("a", "Hi", { review: { state: "reviewed", source: "person", at: NOW, by: "x" } })], [], {
      source: "composer", markReviewed: null, editor: null, now: NOW,
    });
    expect(out[0]!.review).toEqual({ state: "draft", source: "composer", at: NOW, by: null });
  });

  it("a person cannot set or forge the stamp: their new block carries none", () => {
    const out = stampBlocks([block("a", "Hi", { review: { state: "draft", source: "ari", at: NOW, by: null } })], [], {
      source: null, markReviewed: null, editor: "u1", now: NOW,
    });
    expect(out[0]!.review).toBeNull();
  });

  it("Ari changing a reviewed section sends it back to Draft; an unchanged one keeps its stamp", () => {
    const reviewed = { state: "reviewed", source: "ari", at: NOW, by: "u1" };
    const previous = [block("a", "One", { review: reviewed }), block("b", "Two", { review: reviewed })];
    const out = stampBlocks([block("a", "One changed"), block("b", "Two")], previous, { source: "ari", markReviewed: null, editor: null, now: NOW });
    expect(out[0]!.review).toMatchObject({ state: "draft", source: "ari" });
    expect(out[1]!.review).toEqual(reviewed);
  });

  it("a person saving a Draft section in Studio reviews it; an untouched Draft stays Draft", () => {
    const draft = { state: "draft", source: "composer", at: NOW, by: null };
    const previous = [block("a", "One", { review: draft }), block("b", "Two", { review: draft })];
    const out = stampBlocks([block("a", "One, edited"), block("b", "Two")], previous, { source: null, markReviewed: null, editor: "u1", now: NOW });
    expect(out[0]!.review).toEqual({ state: "reviewed", source: "composer", at: NOW, by: "u1" });
    expect(out[1]!.review).toEqual(draft);
  });

  it("Looks right marks the named section; Mark all marks every Draft", () => {
    const draft = { state: "draft", source: "ari", at: NOW, by: null };
    const previous = [block("a", "One", { review: draft }), block("b", "Two", { review: draft })];
    const one = stampBlocks(previous, previous, { source: null, markReviewed: new Set(["b"]), editor: "u2", now: NOW });
    expect(one.map((b) => (b.review as { state: string }).state)).toEqual(["draft", "reviewed"]);
    const all = stampBlocks(previous, previous, { source: null, markReviewed: "all", editor: "u2", now: NOW });
    expect(all.every((b) => (b.review as { state: string; by: string }).state === "reviewed" && (b.review as { by: string }).by === "u2")).toBe(true);
  });

  it("the hook honours the source and the mark only on a signed Core write", async () => {
    const run = (context: Record<string, unknown>) => stampBlockReview({
      data: { blocks: [block("a", "Hi")] }, originalDoc: { blocks: [] }, req: { context, user: null }, operation: "update",
    } as never) as { blocks: { review: unknown }[] };
    expect(run({ minglaReviewSource: "composer" }).blocks[0]!.review).toBeNull();
    expect(run({ minglaSignedCore: true, minglaReviewSource: "composer" }).blocks[0]!.review).toMatchObject({ state: "draft" });
    expect(run({ minglaSignedCore: true, minglaReviewSource: "someone" }).blocks[0]!.review).toBeNull();
  });

  it("P3-2 a signed write with no source (Ari with the flag off) keeps a Draft as Draft", () => {
    const draft = { state: "draft", source: "ari", at: NOW, by: null };
    const out = stampBlocks([block("a", "Changed by Ari")], [block("a", "One", { review: draft })], { source: null, markReviewed: null, editor: "u9", now: NOW, signed: true });
    expect(out[0]!.review).toEqual(draft);
  });

  it("P2-2 flag off after Drafts exist: Mark all (a signed write with no source) clears them, and publish passes", () => {
    const draft = { state: "draft", source: "composer", at: NOW, by: null };
    const out = stampBlockReview({
      data: { blocks: [block("a", "One"), block("b", "Two")] },
      originalDoc: { blocks: [block("a", "One", { review: draft }), block("b", "Two", { review: draft })] },
      req: { context: { minglaSignedCore: true, minglaMarkReviewed: "all" }, user: { core_user_id: "00000000-0000-4000-8000-0000000000f1" } },
      operation: "update",
    } as never) as { blocks: Record<string, unknown>[] };
    expect(out.blocks.every((b) => (b.review as { state: string }).state === "reviewed")).toBe(true);
    expect(() => assertNoUnreviewedSections([{ path: "", title: "Home", enabled: true, blocks: out.blocks }])).not.toThrow();
  });

  it("summaries and chips name the source", () => {
    const draft = { state: "draft", source: "ari", at: NOW, by: null };
    expect(pageReviewSummary([block("a", "One", { review: draft }), block("b", "Two")])).toEqual({ count: 1, blocks: [{ id: "a", type: "page_header", source: "ari" }] });
    expect(draftChipLabel("ari")).toBe("Draft · by Ari");
    expect(draftChipLabel("composer")).toBe("Draft · from your answers");
  });
});

describe("#4453 publish gate (SC-4.2) and strip (SC-4.1)", () => {
  const draft = { state: "draft", source: "composer", at: NOW, by: null };

  it("only enabled pages with Draft sections block", () => {
    const pages = [
      { path: "", title: "Home", enabled: true, blocks: [block("a", "x", { review: draft })] },
      { path: "faq", title: "FAQ", enabled: false, blocks: [block("b", "y", { review: draft })] },
    ];
    expect(unreviewedPages(pages)).toEqual([{ path: "", title: "Home", count: 1 }]);
    expect(() => assertNoUnreviewedSections(pages)).toThrow(UNREVIEWED_SECTIONS);
    try {
      assertNoUnreviewedSections(pages);
    } catch (error) {
      expect(error).toBeInstanceOf(UnreviewedSectionsError);
    }
  });

  const TENANT = "00000000-0000-4000-8000-000000004453";
  async function build(blocks: Record<string, unknown>[], enforceReview: boolean) {
    const settings = { id: "s1", tenant: TENANT, display_name: "Proof", short_description: "x", canonical_url: "https://proof.sites.usemingla.com", seo_title: "Proof", seo_description: "x" };
    const page = { id: "p1", tenant: TENANT, slug: "", title: "Home", enabled: true, blocks, seo: { title: "Proof", description: "x" } };
    const collections: Record<string, unknown[]> = {
      pages: [page], navigation: [{ id: "n1", tenant: TENANT, items: [] }], footer: [{ id: "f1", tenant: TENANT }], "site-settings": [settings], media: [],
    };
    const sourceDigest = await publicationDraftDigest({ pages: collections.pages!, navigation: collections.navigation![0] ?? null, footer: collections.footer![0] ?? null, settings, media: [] });
    const req = { context: {}, payload: { find: async ({ collection }: { collection: string }) => ({ docs: collections[collection] ?? [] }) } } as never;
    return buildPublicationArtifact(req, {
      tenant: { id: TENANT, core_site_id: "00000000-0000-4000-8000-000000004454", core_brand_id: "00000000-0000-4000-8000-000000004455", primary_hostname: "proof.sites.usemingla.com" },
      operationId: "op-4453", publicationId: "00000000-0000-4000-8000-000000004456", sourceRevisionId: "rev-4453", sourceDigest,
      generatedAt: "2026-11-16T00:00:00Z", enforceReview,
    } as never);
  }

  it("a publish with one Draft section is refused; the same site with it reviewed publishes, and no stamp is in the artifact", async () => {
    await expect(build([block("a", "Welcome", { review: draft })], true)).rejects.toThrow(UNREVIEWED_SECTIONS);
    const built = await build([block("a", "Welcome", { review: { ...draft, state: "reviewed", by: "u1" } })], true);
    const serialized = JSON.stringify(built);
    expect(serialized).toContain("Welcome");
    expect(serialized).not.toContain("\"review\"");
    expect(serialized).not.toContain("composer");
  });

  it("a private preview (no enforceReview) still renders the draft, without the stamp", async () => {
    const built = await build([block("a", "Welcome", { review: draft })], false);
    expect(JSON.stringify(built)).not.toContain("\"review\"");
  });
});

describe("#4453 the Studio field and its migration", () => {
  it("every Studio block carries the hidden, read-only review field", () => {
    for (const config of siteBlocks) {
      const field = config.fields.find((entry) => "name" in entry && entry.name === "review") as { type?: string; admin?: { hidden?: boolean; readOnly?: boolean } } | undefined;
      expect(field?.type, config.slug).toBe("json");
      expect(field?.admin?.hidden && field.admin.readOnly, config.slug).toBe(true);
    }
  });

  it("the migration adds the column for every block type, live and versioned", () => {
    const sql = readFileSync(path.resolve(__dirname, "../migrations/20261116_103000_issue_4453_content_foundation.ts"), "utf8");
    for (const config of siteBlocks) {
      expect(sql, config.slug).toContain(`"pages_blocks_${config.slug}" ADD COLUMN IF NOT EXISTS "review" jsonb`);
      expect(sql, config.slug).toContain(`"_pages_v_blocks_${config.slug}" ADD COLUMN IF NOT EXISTS "review" jsonb`);
    }
  });
});
