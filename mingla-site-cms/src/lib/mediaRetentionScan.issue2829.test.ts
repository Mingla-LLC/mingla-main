/*
 * #2829 W6 pre-item (a) — the media in-use scan sees EVERY media field.
 *
 * The scan that decides whether media may be tombstoned (and later purged by
 * retention) named its fields by hand, so media used only as a hero's
 * background video, a film's video or poster, or a team portrait looked
 * unused and could be deleted from a live site — the same class of bug as the
 * six-page truncation.
 *
 * These tests derive every media field from the real block and collection
 * schemas and, for EACH one, store a document whose only reference to the
 * media is that field. Tombstoning must refuse every time. A hand list (or a
 * scan that skips a holder collection) fails here.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({
  cmsConfig: () => ({
    artifactBucket: "artifact-bucket",
    approvedBucket: "approved-bucket",
    recoveryBucket: "recovery-bucket",
    quarantineBucket: "quarantine-bucket",
  }),
}));
vi.mock("./observability", () => ({ emitCmsObservation: async () => {} }));
// #2829 W11 (A11) — removal also asks Core which publications it protects;
// none here, so only the draft decides.
vi.mock("./gateway", () => ({ readCoreRetentionProjection: async () => ({ protected_artifact_keys: [] }) }));
vi.mock("./objectStore", () => ({
  writeObject: async () => {},
  readObject: async () => {
    throw new Error("STORAGE_UNAVAILABLE");
  },
  deleteObject: async () => {},
  presignedQuarantinePut: async () => ({ url: "https://upload.invalid", headers: {} }),
}));

import { tombstoneMedia } from "./mediaPipeline";
import { mediaFieldPaths, mediaPathLabel, type MediaPathStep } from "./mediaFields";
import { NON_CONTENT_TENANT_COLLECTIONS, TENANT_MEDIA_HOLDERS, tenantMediaInUse } from "./mediaHolders";
import { Pages } from "../collections/Pages";

const TENANT_ID = "00000000-0000-4000-8000-000000000b01";
const SITE_ID = "00000000-0000-4000-8000-000000000b02";
const MEDIA_ID = "00000000-0000-4000-8000-000000000b05";

type Doc = Record<string, unknown>;

function payloadWith(collections: Record<string, Doc[]>) {
  return {
    find: async (input: Doc) => {
      const docs = collections[String(input.collection)] ?? [];
      const capped = input.pagination === false ? docs : docs.slice(0, typeof input.limit === "number" ? input.limit : 10);
      return { docs: capped, totalDocs: capped.length };
    },
    findByID: async (input: Doc) => {
      const found = (collections[String(input.collection)] ?? []).find((doc) => doc.id === input.id);
      if (!found) throw new Error("NOT_FOUND");
      return found;
    },
    update: async (input: Doc) => ({ ...(input.data as Doc) }),
  };
}

/** A document whose ONLY media reference is the field at `steps`. */
function docWithMediaAt(steps: MediaPathStep[], id: string): Doc {
  const root: Doc = { id: "holder-1", tenant: TENANT_ID, slug: "", title: "Holder" };
  let cursor: Doc = root;
  for (const step of steps) {
    if (step.kind === "key") {
      const next: Doc = {};
      cursor[step.name] = next;
      cursor = next;
    } else if (step.kind === "array") {
      const row: Doc = { id: "row-1" };
      cursor[step.name] = [row];
      cursor = row;
    } else if (step.kind === "block") {
      const row: Doc = { id: "block-1", blockType: step.blockType };
      cursor[step.name] = [row];
      cursor = row;
    } else {
      const value = step.polymorphic ? { relationTo: "media", value: id } : id;
      cursor[step.name] = step.hasMany ? [value] : value;
    }
  }
  return root;
}

const media = {
  id: MEDIA_ID,
  tenant: TENANT_ID,
  state: "READY",
  approved_master_key: `approved/${SITE_ID}/${MEDIA_ID}/${"a".repeat(64)}/master.webp`,
  rendition_manifest: { version: 1, master: {}, renditions: [] },
};

const requestWith = (collections: Record<string, Doc[]>) => ({
  context: {},
  user: { id: "user-1", tenantId: TENANT_ID, siteId: SITE_ID },
  payload: payloadWith({ media: [media], ...collections }),
});

const cases = TENANT_MEDIA_HOLDERS.flatMap((holder) =>
  mediaFieldPaths(holder.fields).map((steps) => ({
    slug: holder.slug,
    label: `${holder.slug}: ${mediaPathLabel(steps)}`,
    steps,
  }))
);

beforeEach(() => vi.clearAllMocks());

describe("#2829 the media in-use scan is derived from the schema", () => {
  it("finds the media fields a hand list missed (and the ones it had)", () => {
    const labels = cases.map((entry) => entry.label);
    for (const expected of [
      "pages: blocks[hero].media",
      "pages: blocks[hero].video",
      "pages: blocks[video_feature].video",
      "pages: blocks[video_feature].poster",
      "pages: blocks[team].members[].media",
      "pages: blocks[gallery].images[].media",
      "pages: blocks[media_feature].media",
      "pages: seo.image",
      "site-settings: logo",
      "site-settings: social_image",
      "destinations: featured_image",
      "destinations: seasons[].image",
      "destinations: gallery[].media",
      "stories: featured_image",
    ]) {
      expect(labels).toContain(expected);
    }
  });

  it.each(cases)("media used ONLY in $label is in use and survives cleanup", async ({ slug, steps }) => {
    const req = requestWith({ [slug]: [docWithMediaAt(steps, MEDIA_ID)] });
    expect((await tenantMediaInUse(req as never, TENANT_ID)).has(MEDIA_ID)).toBe(true);
    // #2829 W11 (A11): refused with the reason the owner can act on.
    await expect(tombstoneMedia(req as never, MEDIA_ID)).rejects.toThrow("MEDIA_IN_USE_DRAFT");
  });

  it("media no field uses is not counted as in use", async () => {
    const req = requestWith({
      pages: [{ id: "p", tenant: TENANT_ID, slug: "", blocks: [{ blockType: "hero", heading: "Hi" }] }],
      "site-settings": [{ id: "s", tenant: TENANT_ID, display_name: "Site" }],
    });
    expect((await tenantMediaInUse(req as never, TENANT_ID)).size).toBe(0);
  });

  it("every tenant-scoped content collection in payload.config is scanned", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../payload.config.ts"), "utf8");
    const block = source.slice(source.indexOf("multiTenantPlugin({"), source.indexOf("tenantsSlug"));
    const tenantCollections = [...block.matchAll(/^\s*"?([a-z-]+)"?:\s*\{\}/gm)].map((match) => match[1]!);
    expect(tenantCollections.length).toBeGreaterThan(5);
    const holders = new Set(TENANT_MEDIA_HOLDERS.map((holder) => holder.slug));
    for (const slug of tenantCollections) {
      if (NON_CONTENT_TENANT_COLLECTIONS.includes(slug)) continue;
      expect(holders, `tenant collection "${slug}" is missing from the media in-use scan`).toContain(slug);
    }
  });
});

describe("#2829 writes check every page media field is the site's own ready media", () => {
  const enforce = (Pages.hooks?.beforeChange ?? [])[0]!;

  it.each(
    mediaFieldPaths(Pages.fields).map((steps) => ({ label: mediaPathLabel(steps), steps })),
  )("a page referencing media that is not this site's in $label is refused", async ({ steps }) => {
    const data = { ...docWithMediaAt(steps, MEDIA_ID), revision: 1 };
    delete (data as Doc).id;
    const req = {
      context: {},
      user: { id: "user-1", tenantId: TENANT_ID, siteId: SITE_ID },
      // No media of this tenant exists, so any reference must be refused.
      payload: payloadWith({ pages: [], media: [] }),
    };
    await expect(
      enforce({ data, originalDoc: undefined, operation: "create", req } as never),
    ).rejects.toThrow("MEDIA_REJECTED");
  });
});
