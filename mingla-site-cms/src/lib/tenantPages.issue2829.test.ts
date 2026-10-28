/*
 * #2829 W2 — R-1, the six-page bug.
 *
 * Page reads carried `limit: 5` while six pages were allowed, so the sixth was
 * silently dropped from publish, preview, Ari's reads and the media reference
 * scan — which then let retention treat that page's photos as unused.
 *
 * The stub Payload below behaves like the real one: a numeric `limit` returns
 * AT MOST that many rows and never errors. Only `pagination: false` returns
 * every row. So any call site reverted to a capped read fails here, and the
 * source gate at the bottom fails on any `collection: "pages"` read with a
 * numeric limit anywhere in this app.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = new Map<string, Uint8Array>();

vi.mock("./config", () => ({
  cmsConfig: () => ({
    artifactBucket: "artifact-bucket",
    approvedBucket: "approved-bucket",
    recoveryBucket: "recovery-bucket",
    quarantineBucket: "quarantine-bucket",
  }),
}));
vi.mock("./observability", () => ({ emitCmsObservation: async () => {} }));
vi.mock("./gateway", () => ({
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
  deleteObject: async () => {},
  presignedQuarantinePut: async () => ({ url: "https://upload.invalid", headers: {} }),
}));

import { findAllTenantPages } from "./tenantPages";
import { tombstoneMedia } from "./mediaPipeline";
import { buildPublicationArtifact, publicationDraftDigest } from "./artifactBuilder";

const TENANT_ID = "00000000-0000-4000-8000-000000000a01";
const SITE_ID = "00000000-0000-4000-8000-000000000a02";
const BRAND_ID = "00000000-0000-4000-8000-000000000a03";
const PAGE6_MEDIA_ID = "00000000-0000-4000-8000-000000000a05";

type Doc = Record<string, unknown>;

/** A Payload stand-in that truncates exactly as the real one does. */
function payloadWith(collections: Record<string, Doc[]>, calls: Doc[] = []) {
  return {
    find: async (input: Doc) => {
      calls.push(input);
      const docs = collections[String(input.collection)] ?? [];
      const capped = input.pagination === false
        ? docs
        : docs.slice(0, typeof input.limit === "number" ? input.limit : 10);
      return { docs: capped, totalDocs: docs.length };
    },
    findByID: async (input: Doc) => {
      const docs = collections[String(input.collection)] ?? [];
      const found = docs.find((doc) => doc.id === input.id);
      if (!found) throw new Error("NOT_FOUND");
      return found;
    },
    update: async (input: Doc) => ({ ...(input.data as Doc) }),
  };
}

const pageDocs = (count: number, blocksFor: (index: number) => Doc[] = () => []) =>
  Array.from({ length: count }, (_, index) => ({
    id: `page-${index + 1}`,
    tenant: TENANT_ID,
    title: `Page ${index + 1}`,
    blocks: blocksFor(index + 1),
  }));

beforeEach(() => stored.clear());

describe("#2829 findAllTenantPages never truncates", () => {
  it("returns 7 of 7 pages through a Payload that caps any numeric limit", async () => {
    const calls: Doc[] = [];
    const req = { context: {}, payload: payloadWith({ pages: pageDocs(7) }, calls) };
    const docs = await findAllTenantPages(req as never, TENANT_ID);
    expect(docs).toHaveLength(7);
    expect(calls[0]).toMatchObject({ collection: "pages", pagination: false });
    expect(calls[0]).not.toHaveProperty("limit");
    expect(JSON.stringify(calls[0]!.where)).toContain(TENANT_ID);
  });

  it("refuses a tenant holding more pages than a site may have, rather than truncating", async () => {
    const req = { context: {}, payload: payloadWith({ pages: pageDocs(101) }) };
    await expect(findAllTenantPages(req as never, TENANT_ID)).rejects.toThrow(
      "PAGE_LIMIT_EXCEEDED",
    );
  });
});

describe("#2829 the media reference scan sees every page", () => {
  const media = {
    id: PAGE6_MEDIA_ID,
    tenant: TENANT_ID,
    state: "READY",
    approved_master_key: `approved/${SITE_ID}/${PAGE6_MEDIA_ID}/${"a".repeat(64)}/master.webp`,
    rendition_manifest: { version: 1, master: {}, renditions: [] },
  };
  const scanRequest = (pages: Doc[]) => ({
    context: {},
    user: { id: "user-1", tenantId: TENANT_ID, siteId: SITE_ID },
    payload: payloadWith({ pages, media: [media], "site-settings": [] }),
  });

  it("a photo used only on the sixth page is IN USE and cannot be tombstoned", async () => {
    const pages = pageDocs(7, (index) =>
      index === 6 ? [{ blockType: "media_feature", media: PAGE6_MEDIA_ID }] : []
    );
    await expect(tombstoneMedia(scanRequest(pages) as never, PAGE6_MEDIA_ID))
      .rejects.toThrow("MEDIA_IN_USE_DRAFT");
  });

  it("a photo used only in the seventh page's gallery is IN USE too", async () => {
    const pages = pageDocs(7, (index) =>
      index === 7 ? [{ blockType: "gallery", images: [{ media: PAGE6_MEDIA_ID }] }] : []
    );
    await expect(tombstoneMedia(scanRequest(pages) as never, PAGE6_MEDIA_ID))
      .rejects.toThrow("MEDIA_IN_USE_DRAFT");
  });
});

describe("#2829 the publication builder publishes every page", () => {
  it("builds all seven pages, including a nested /resources/faqs", async () => {
    const tree: Array<[string, string, string | null]> = [
      ["page-home", "", null],
      ["page-about", "about", null],
      ["page-menu", "menu", null],
      ["page-gallery", "gallery", null],
      ["page-contact", "contact", null],
      ["page-resources", "resources", null],
      ["page-faqs", "faqs", "page-resources"],
    ];
    const pages = tree.map(([id, slug, parent]) => ({
      id,
      tenant: TENANT_ID,
      slug,
      parent,
      kind: "standard",
      title: slug || "Home",
      enabled: true,
      blocks: [{ blockType: "faq", heading: slug || "Home", items: [{ question: "Q?", answer: "A." }] }],
    }));
    const settings = { id: "settings-1", tenant: TENANT_ID, display_name: "Seven pages" };
    const collections: Record<string, Doc[]> = {
      pages,
      navigation: [{
        id: "nav-1",
        tenant: TENANT_ID,
        items: [
          { label: "Home", target_type: "page", page: "page-home" },
          {
            label: "Resources",
            target_type: "page",
            page: "page-resources",
            children: [{ label: "FAQs", target_type: "page", page: "page-faqs" }],
          },
        ],
      }],
      footer: [{ id: "footer-1", tenant: TENANT_ID }],
      "site-settings": [settings],
      media: [],
    };
    const sourceDigest = await publicationDraftDigest({
      pages,
      navigation: collections.navigation![0]!,
      footer: collections.footer![0]!,
      settings,
      media: [],
    });
    const { artifact, serialized } = await buildPublicationArtifact(
      { context: {}, payload: payloadWith(collections) } as never,
      {
        tenant: {
          id: TENANT_ID,
          core_site_id: SITE_ID,
          core_brand_id: BRAND_ID,
          primary_hostname: "seven.sites.localhost",
        },
        operationId: "op-2829-seven",
        publicationId: "00000000-0000-4000-8000-000000000a06",
        sourceRevisionId: "rev-2829-seven",
        sourceDigest,
        generatedAt: "2026-10-26T00:00:00Z",
      },
    );
    expect((artifact.pages as Doc[]).map((page) => page.path)).toEqual([
      "", "about", "contact", "gallery", "menu", "resources", "resources/faqs",
    ]);
    expect(artifact.navigation).toEqual({
      items: [
        { label: "Home", href: "/" },
        { label: "Resources", href: "/resources", children: [{ label: "FAQs", href: "/resources/faqs" }] },
      ],
    });
    const contract = (await import("../contracts/generated/artifactV2.ts").then((m) => ({ assertRestaurantArtifact: m.assertArtifactV2 }))) as { assertRestaurantArtifact: (value: unknown) => void };
    expect(() => contract.assertRestaurantArtifact(JSON.parse(serialized))).not.toThrow();
  });
});

/** Strip // and /* *\/ comments so a comment describing the bug never trips the gate. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** The object literal that encloses position `at`, by brace matching. */
function enclosingObject(source: string, at: number): string {
  let depth = 0;
  let start = at;
  for (; start >= 0; start -= 1) {
    const char = source[start];
    if (char === "}") depth += 1;
    else if (char === "{") {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  depth = 0;
  let end = at;
  for (; end < source.length; end += 1) {
    const char = source[end];
    if (char === "{") depth += 1;
    else if (char === "}") {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  return source.slice(start, end + 1);
}

export function cappedPageReads(root: string): string[] {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "generated") walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
      const source = stripComments(fs.readFileSync(full, "utf8"));
      // A value in an object literal, not a type union (`collection: "pages" | …`).
      const pattern = /collection\s*:\s*["']pages["'](?!\s*\|)/g;
      for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
        if (/\blimit\s*:\s*\d/.test(enclosingObject(source, match.index))) {
          offenders.push(path.relative(root, full));
        }
      }
    }
  };
  walk(root);
  return offenders;
}

describe("#2829 gate: no capped page read anywhere in Studio", () => {
  it("no `collection: \"pages\"` read carries a numeric limit", () => {
    expect(cappedPageReads(path.resolve(process.cwd(), "src"))).toEqual([]);
  });

  it("the gate itself catches a capped read and ignores one in a comment", () => {
    const dir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-gate-"));
    try {
      fs.writeFileSync(
        path.join(dir, "bad.ts"),
        'await payload.find({\n  collection: "pages",\n  where,\n  limit: 5,\n});\n',
      );
      fs.writeFileSync(
        path.join(dir, "fine.ts"),
        '// collection: "pages", limit: 5\nawait payload.find({ collection: "pages", pagination: false });\n',
      );
      expect(cappedPageReads(dir)).toEqual(["bad.ts"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
