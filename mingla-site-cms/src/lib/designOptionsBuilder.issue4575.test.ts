/*
 * #4575 — Grid design options in the publish builder and Studio's look lists.
 *
 * The builder freezes `design.options` into the artifact only when an
 * option changes the drawing (SC-2): no stored options, all-null, or "mono"
 * without the cover publish `design` exactly as before, and a design that
 * does not offer options never carries them. Undo and the look-saved report
 * treat the options as part of the look; the migration adds exactly the four
 * nullable columns and four enums.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const stored = new Map<string, Uint8Array>();
vi.mock("./config", () => ({ cmsConfig: () => ({ artifactBucket: "artifact-bucket" }) }));
vi.mock("./observability", () => ({ emitCmsObservation: async () => {} }));
vi.mock("./gateway", () => ({
  readCoreProjection: async (_path: string, _site: string, _op: string, ids: string[]) => ({
    offerings: ids.map((id) => ({ id, kind: "offering", title: "Tasting night", summary: "Six courses.", url: "https://host.usemingla.com/e/b/tasting" })),
    feed: null,
    menu: [],
    menu_venue_id: null,
  }),
}));
vi.mock("./objectStore", () => ({
  writeObject: async (bucket: string, key: string, bytes: Uint8Array) => { stored.set(`${bucket}:${key}`, bytes); },
  readObject: async (bucket: string, key: string) => {
    const value = stored.get(`${bucket}:${key}`);
    if (!value) throw new Error("STORAGE_UNAVAILABLE");
    return value;
  },
}));

import { assertArtifactV2 } from "../contracts/generated/artifactV2.ts";
import { buildPublicationArtifact, publicationDraftDigest } from "./artifactBuilder";
import type { FontPipelineDeps } from "./fontAssets";
import { LOOK_KEYS } from "./draftHistory";
import { lookChanged } from "./lookSavedReport";
import { designOptionsOf, validateDesignOptionsField } from "./siteLook";
import { SiteSettings } from "../collections/SiteSettings";
import { migrations } from "../migrations";

const SITE = "00000000-0000-4000-8000-000000000001";
const BRAND = "00000000-0000-4000-8000-000000000002";
const PUBLICATION = "00000000-0000-4000-8000-000000000904";
const FIXED_ID = "11111111-1111-4111-8111-000000000777";

const offlineFonts: FontPipelineDeps = {
  fetch: (async () => { throw new Error("NO_NETWORK_IN_TESTS"); }) as typeof fetch,
  storeFont: async () => {},
  cachedFaces: async (key) => key.split("|")[1]!.split(",").map((weight, index) => ({
    family: key.split("|")[0]!, weight: Number(weight), style: "normal" as const, unicode_range: "U+0000-00FF",
    digest: String(index).padEnd(64, "b"), bytes: 1000,
  })),
  saveFaces: async () => {},
};

const heroMedia = {
  id: "11111111-1111-4111-8111-000000000888", tenant: "t1", state: "READY", detected_mime: "image/jpeg", width: 1600, height: 900,
  rendition_manifest: { renditions: [{ width: 1600, target_width: 1600, digest: "c".repeat(64), key: `approved/${SITE}/11111111-1111-4111-8111-000000000888/1600.webp` }] },
};

async function build(look: Record<string, unknown>, blocks: Array<Record<string, unknown>> = [{ blockType: "offering_grid", heading: "Experiences", offering_ids: [{ offering_id: FIXED_ID }] }]) {
  const tenant = { id: "t1", core_site_id: SITE, core_brand_id: BRAND, primary_hostname: "brand.sites.localhost" };
  const settings = { id: "settings-1", tenant: "t1", display_name: "Brand", ...look };
  const page = { id: "page-home", tenant: "t1", slug: "", title: "Home", enabled: true, blocks };
  const collections: Record<string, unknown[]> = {
    pages: [page], navigation: [{ id: "nav-1", tenant: "t1", items: [] }], footer: [{ id: "footer-1", tenant: "t1" }],
    "site-settings": [settings],
    media: [heroMedia],
  };
  const sourceDigest = await publicationDraftDigest({ pages: [page], navigation: collections.navigation![0] ?? null, footer: collections.footer![0] ?? null, settings, media: [heroMedia] });
  const req = { context: {}, payload: { find: async ({ collection }: { collection: string }) => ({ docs: collections[collection] ?? [] }) } } as never;
  const built = await buildPublicationArtifact(req, {
    tenant: tenant as never, operationId: "op-4575", publicationId: PUBLICATION,
    sourceRevisionId: "rev-4575", sourceDigest, generatedAt: "2026-11-23T00:00:00Z", fontPipeline: offlineFonts,
  });
  expect(() => assertArtifactV2(JSON.parse(built.serialized))).not.toThrow();
  return built;
}

describe("#4575 the builder freezes Grid's options only when set (SC-2)", () => {
  it.each([
    ["no design_options", {}],
    ["all-null", { design_options: { cover: null, photos: null } }],
    ["mono without the cover", { design_options: { cover: null, photos: "mono" } }],
    ["garbage", { design_options: { cover: "half" } }],
  ])("%s: design is exactly { key, version }", async (_label, look) => {
    const built = await build({ design: "grid", ...look });
    expect(built.artifact.design).toStrictEqual({ key: "grid", version: 1 });
    expect(JSON.parse(built.serialized).design).toStrictEqual({ key: "grid", version: 1 });
  });

  it("the cover alone publishes the cover and full colour", async () => {
    const built = await build({ design: "grid", design_options: { cover: "full", photos: null } });
    expect(built.artifact.design).toStrictEqual({ key: "grid", version: 1, options: { cover: "full", photos: "colour" } });
  });

  it("the cover with black and white publishes the cover only; colour alone publishes colour only", async () => {
    expect((await build({ design: "grid", design_options: { cover: "full", photos: "mono" } })).artifact.design)
      .toStrictEqual({ key: "grid", version: 1, options: { cover: "full" } });
    expect((await build({ design: "grid", design_options: { photos: "colour" } })).artifact.design)
      .toStrictEqual({ key: "grid", version: 1, options: { photos: "colour" } });
  });

  it("a design that offers no options never carries them (a switched-away Grid site keeps its stored choice)", async () => {
    for (const design of ["voyage", "terra", "atelier"]) {
      const built = await build({ design, design_options: { cover: "full", photos: "colour" } });
      expect(built.artifact.design).toStrictEqual({ key: design, version: 1 });
    }
  });
});

describe("#4575 cover gap SC-5: a grid-index hero keeps its facts under the cover", () => {
  const hero = {
    blockType: "hero", variant: "grid-index", heading: "Kolanut", media: "11111111-1111-4111-8111-000000000888", ctas: [],
    fact_badges: [{ big: "Next", small: "Opening" }, { big: "Open", small: "Tue to Sun" }, { big: "Where", small: "Abuja" }],
    booking_bar: "venue_table", booking_target_id: FIXED_ID, show_rating: true,
  };
  const heroOf = (built: Awaited<ReturnType<typeof build>>) =>
    (built.artifact.pages.find((page: { path: string }) => page.path === "")!.blocks as Array<Record<string, unknown>>).find((block) => block.type === "hero")!;

  it("with the cover on, the facts, booking bar and rating publish", async () => {
    const published = heroOf(await build({ design: "grid", design_options: { cover: "full" } }, [hero]));
    expect(published.variant).toBe("grid-index");
    expect(published.fact_badges).toHaveLength(3);
    expect(published.booking_bar).toBe("venue_table");
    expect(published.show_rating).toBe(true);
  });

  it("with the cover off (or photos alone), they are stripped as before", async () => {
    for (const look of [{ design: "grid" }, { design: "grid", design_options: { photos: "colour" } }]) {
      const published = heroOf(await build(look, [hero]));
      expect(published.fact_badges).toBeUndefined();
      expect(published.booking_bar).toBeUndefined();
      expect(published.show_rating).toBeUndefined();
    }
  });
});

describe("#4575 Studio's look includes the design options", () => {
  it("Undo puts the options back and a change to them is a look save", () => {
    expect(LOOK_KEYS).toContain("design_options");
    expect(lookChanged({ design: "grid", design_options: { cover: null, photos: null } }, { design: "grid", design_options: { cover: "full", photos: null } })).toBe(true);
    expect(lookChanged({ design: "grid", design_options: { cover: "full", photos: null } }, { design: "grid", design_options: { cover: "full", photos: null } })).toBe(false);
  });

  it("the settings group shows on Grid only and refuses an invalid value (SC-10-Studio)", () => {
    const field = SiteSettings.fields.find((candidate) => "name" in candidate && candidate.name === "design_options") as unknown as {
      type: string; admin: { condition: (data: unknown) => boolean }; validate: (value: unknown) => true | string;
      fields: Array<{ name: string; options: Array<{ value: string }> }>;
    };
    expect(field.type).toBe("group");
    expect(field.admin.condition({ design: "grid" })).toBe(true);
    for (const design of ["voyage", "atelier", "terra", undefined]) expect(field.admin.condition({ design })).toBe(false);
    expect(field.fields.map((sub) => [sub.name, sub.options.map((option) => option.value)])).toEqual([["cover", ["full"]], ["photos", ["colour", "mono"]]]);
    expect(field.validate).toBe(validateDesignOptionsField);
    expect(validateDesignOptionsField({ cover: "full", photos: null })).toBe(true);
    expect(validateDesignOptionsField(null)).toBe(true);
    expect(validateDesignOptionsField({ cover: "half" })).toBe("That design option is not valid.");
    expect(validateDesignOptionsField({ ticker: "on" })).toBe("That design option is not valid.");
    expect(designOptionsOf({ design_options: { cover: "full" } })).toEqual({ cover: "full" });
    expect(designOptionsOf({})).toBeNull();
  });
});

describe("#4575 the migration", () => {
  const source = readFileSync(path.resolve(__dirname, "../migrations/20261123_100000_issue_4575_design_options.ts"), "utf8");
  const [up, down] = source.split("export async function down");

  it("adds exactly the four nullable columns and four enums, additive only", () => {
    expect([...up!.matchAll(/CREATE TYPE "sites_cms"\."([a-z_]+)" AS ENUM\(([^)]*)\)/g)].map((m) => [m[1], m[2]])).toEqual([
      ["enum_site_settings_design_options_cover", "'full'"],
      ["enum_site_settings_design_options_photos", "'colour', 'mono'"],
      ["enum__site_settings_v_version_design_options_cover", "'full'"],
      ["enum__site_settings_v_version_design_options_photos", "'colour', 'mono'"],
    ]);
    expect([...up!.matchAll(/ALTER TABLE "sites_cms"\."([a-z_]+)" ADD COLUMN "([a-z_]+)" "sites_cms"\."([a-z_]+)";/g)].map((m) => [m[1], m[2], m[3]])).toEqual([
      ["site_settings", "design_options_cover", "enum_site_settings_design_options_cover"],
      ["site_settings", "design_options_photos", "enum_site_settings_design_options_photos"],
      ["_site_settings_v", "version_design_options_cover", "enum__site_settings_v_version_design_options_cover"],
      ["_site_settings_v", "version_design_options_photos", "enum__site_settings_v_version_design_options_photos"],
    ]);
    expect(up).not.toMatch(/DEFAULT|NOT NULL|DROP|ALTER TYPE|UPDATE /);
    expect(down!.match(/DROP COLUMN/g)).toHaveLength(4);
    expect(down!.match(/DROP TYPE/g)).toHaveLength(4);
  });

  it("is registered last in the migrations index", () => {
    expect(migrations.at(-1)!.name).toBe("20261123_100000_issue_4575_design_options");
  });
});
