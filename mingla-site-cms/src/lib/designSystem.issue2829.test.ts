/*
 * #2829 W3 (T-W3) — Studio's design system: every catalogue block has one
 * Studio block with a layout; the look is stored as validated token values
 * and catalogue fonts; the v2 builder freezes the owner's exact colours and
 * fonts into the artifact; readability warnings never stop a publish; a font
 * that will not load falls back with a warning; a v2 rollback copies exactly.
 *
 * R-10: an unreadable choice publishes UNCHANGED (this suite + the runtime's
 * token emission test).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = new Map<string, Uint8Array>();
vi.mock("./config", () => ({ cmsConfig: () => ({ artifactBucket: "artifact-bucket" }) }));
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
}));

import { siteBlocks } from "../blocks/siteBlocks";
import { BLOCK_TYPES } from "../contracts/generated/blocks.ts";
import { ATELIER, DESIGNS, DESIGN_KEYS } from "../contracts/generated/designs.ts";
import { readabilityWarnings } from "../contracts/generated/readability.ts";
import { assertArtifactV2 } from "../contracts/generated/artifactV2.ts";
import {
  buildPublicationArtifact,
  buildRollbackPublicationArtifact,
  publicationDraftDigest,
} from "./artifactBuilder";
import type { CachedFace, FontPipelineDeps } from "./fontAssets";
import { ownerFontsOf, ownerTokensOf, validateFontsField, validateTokensField } from "./siteLook";

beforeEach(() => stored.clear());

const SITE = "00000000-0000-4000-8000-000000000001";
const BRAND = "00000000-0000-4000-8000-000000000002";
const PUBLICATION = "00000000-0000-4000-8000-000000000904";

function offlineFonts(fail: string[] = []): FontPipelineDeps & { fetched: string[] } {
  const fetched: string[] = [];
  return {
    fetched,
    fetch: (async (url: RequestInfo | URL) => {
      fetched.push(String(url));
      throw new Error("NO_NETWORK_IN_TESTS");
    }) as typeof fetch,
    storeFont: async () => {},
    cachedFaces: async (key) => {
      const [family, weights] = key.split("|");
      if (fail.includes(family!)) return null;
      return weights!.split(",").map((weight, index): CachedFace => ({
        family: family!, weight: Number(weight), style: "normal", unicode_range: "U+0000-00FF",
        digest: (index.toString(16) + family!.length.toString(16)).padEnd(64, "a").slice(0, 64), bytes: 1000,
      }));
    },
    saveFaces: async () => {},
  };
}

async function build(settingsOver: Record<string, unknown>, fontPipeline: FontPipelineDeps) {
  const tenant = { id: "t1", core_site_id: SITE, core_brand_id: BRAND, primary_hostname: "brand.sites.localhost" };
  const settings = { id: "settings-1", tenant: "t1", display_name: "Brand", ...settingsOver };
  const page = { id: "page-home", tenant: "t1", slug: "", title: "Home", enabled: true, blocks: [{ blockType: "divider" }, { blockType: "spacer", size: "small", variant: "atelier" }] };
  const collections: Record<string, unknown[]> = {
    pages: [page], navigation: [{ id: "nav-1", tenant: "t1", items: [] }], footer: [{ id: "footer-1", tenant: "t1" }],
    "site-settings": [settings], media: [],
  };
  const sourceDigest = await publicationDraftDigest({
    pages: collections.pages!, navigation: collections.navigation![0] ?? null,
    footer: collections.footer![0] ?? null, settings, media: [],
  });
  const req = { context: {}, payload: { find: async ({ collection }: { collection: string }) => ({ docs: collections[collection] ?? [] }) } } as never;
  return buildPublicationArtifact(req, {
    tenant: tenant as never, operationId: "op-w3", publicationId: PUBLICATION,
    sourceRevisionId: "rev-w3", sourceDigest, generatedAt: "2026-10-26T00:00:00Z", fontPipeline,
  });
}

describe("#2829 Studio blocks come from the catalogue", () => {
  it("has exactly one Studio block per catalogue type", () => {
    expect(siteBlocks.map((block) => block.slug).sort()).toEqual([...BLOCK_TYPES].sort());
  });

  it("every block offers a layout, limited to what the designs draw, defaulting to atelier's", () => {
    for (const block of siteBlocks) {
      const field = block.fields.find((entry) => (entry as { name?: string }).name === "variant") as
        | { options: Array<{ value: string }>; defaultValue: string; required?: boolean }
        | undefined;
      expect(field, block.slug).toBeDefined();
      const drawn = new Set(DESIGN_KEYS.flatMap((key) => DESIGNS[key].variants[block.slug as keyof typeof ATELIER.variants]));
      expect(field!.options.map((option) => option.value).every((value) => drawn.has(value))).toBe(true);
      expect(field!.defaultValue).toBe(ATELIER.variants[block.slug as keyof typeof ATELIER.variants][0]);
      expect(field!.required).toBe(false);
    }
  });
});

describe("#2829 the stored look is validated token values", () => {
  it("accepts any hex and catalogue fonts; refuses CSS and unknown families", () => {
    expect(validateTokensField({ colors: { ink_body: "#bbbbbb", accent: { seed: "#ff00aa", steps: { 400: "#ff00aa" } } } })).toBe(true);
    expect(validateTokensField({ colors: { canvas: "red;}" } })).toMatch(/not valid/);
    expect(validateTokensField({ css: "body{}" })).toMatch(/not valid/);
    expect(validateFontsField({ display: { family: "Fraunces", source: "google" }, body: { family: "Inter", source: "google" } })).toBe(true);
    expect(validateFontsField({ display: { family: "Not A Font", source: "google" } })).toMatch(/not in the Google Fonts list/);
    expect(validateFontsField({ display: { family: "x'); }", source: "google" } })).toBe("Choose fonts from the font list.");
  });

  it("merges the shape and motion presets; ignores stored values that are not valid", () => {
    expect(ownerTokensOf({ tokens: { colors: { canvas: "#ffffff" } }, radius: "round", button_shape: "square", motion: "none" }))
      .toEqual({ colors: { canvas: "#ffffff" }, radius: "round", button_shape: "square", motion: "none" });
    expect(ownerTokensOf({ tokens: { colors: { canvas: "white" } }, radius: "huge" })).toEqual({});
    expect(ownerFontsOf({ fonts: { display: { family: "Not A Font", source: "google" }, body: { family: "Inter", source: "google" } } }))
      .toEqual({ body: { family: "Inter", source: "google" } });
  });
});

describe("#2829 the v2 builder", () => {
  it("publishes the owner's exact colours and chosen fonts under the design, warnings and all (R-10)", async () => {
    const fonts = offlineFonts();
    const built = await build({
      design: "atelier",
      tokens: { colors: { ink_body: "#bbbbbb", canvas: "#ffffff", accent: { seed: "#ff00aa", steps: { 400: "#ff00aa" } } } },
      fonts: { display: { family: "Fraunces", source: "google" }, body: { family: "Inter", source: "google" } },
      radius: "soft",
    }, fonts);
    const artifact = JSON.parse(new TextDecoder().decode(stored.get(`artifact-bucket:${built.artifactKey}`)!));
    assertArtifactV2(artifact);
    expect(artifact.artifact_schema_version).toBe(2);
    expect(artifact.design).toEqual({ key: "atelier", version: 1 });
    expect(artifact.tokens.colors.ink_body).toBe("#bbbbbb");
    expect(artifact.tokens.colors.canvas).toBe("#ffffff");
    expect(artifact.tokens.colors.accent[400]).toBe("#ff00aa");
    expect(artifact.tokens.radius).toBe("soft");
    expect(readabilityWarnings(artifact.tokens).map((warning: { pair: string }) => warning.pair)).toContain("body_on_canvas");
    expect(artifact.fonts.display).toEqual({ family: "Fraunces", source: "google", weights: [400, 600], italic: false });
    expect(artifact.fonts.body).toEqual({ family: "Inter", source: "google", weights: [400, 600, 800], italic: false });
    expect(new Set(artifact.font_assets.map((asset: { family: string }) => asset.family))).toEqual(new Set(["Fraunces", "Inter"]));
    expect(artifact.font_fallbacks.map((face: { family: string }) => face.family).sort()).toEqual(["Fraunces", "Inter"]);
    expect(artifact.pages[0].blocks.map((block: { variant: string }) => block.variant)).toEqual(["atelier", "atelier"]);
    expect(built.generation).toEqual({ artifact_schema_version: 2, renderer_key: "sites-v2", design_key: "atelier", design_version: 1 });
    expect(built.fontWarnings).toEqual([]);
    expect(fonts.fetched).toEqual([]);
  });

  it("a font that will not load falls back to the design's with a warning; the publish still builds", async () => {
    const built = await build({ fonts: { display: { family: "Fraunces", source: "google" } } }, offlineFonts(["Fraunces"]));
    expect(built.fontWarnings).toEqual([{ slot: "display", requested: "Fraunces", used: "Oswald", code: "FONT_FETCH_FAILED" }]);
    expect(built.artifact.fonts.display.family).toBe("Oswald");
    assertArtifactV2(JSON.parse(built.serialized));
  });

  it("with no look stored, atelier's own defaults are published byte-exactly", async () => {
    const built = await build({}, offlineFonts());
    expect(built.artifact.tokens.colors.canvas).toBe("#101013");
    expect(built.artifact.tokens.colors.accent[300]).toBe("#dfb262");
    expect(built.artifact.fonts.display.family).toBe("Oswald");
  });

  it("a rollback copies a v2 publication exactly and reports v2", async () => {
    const built = await build({}, offlineFonts());
    const source = {
      id: PUBLICATION, site_id: SITE, source_revision_id: "rev-w3", source_digest: built.artifact.source_digest,
      status: "published", artifact_schema_version: 2, renderer_key: "sites-v2", renderer_version: 1,
      artifact_digest: built.artifactDigest, artifact_key: built.artifactKey,
    };
    const rolled = await buildRollbackPublicationArtifact({
      siteId: SITE, brandId: BRAND, publicationId: "00000000-0000-4000-8000-000000000905",
      sourceRevisionId: "rev-w3", sourceDigest: built.artifact.source_digest, generatedAt: "2026-10-27T00:00:00Z",
      rollbackSourcePublicationId: PUBLICATION, rollbackSource: source,
    });
    expect(rolled.generation).toEqual({ artifact_schema_version: 2, renderer_key: "sites-v2", design_key: "atelier", design_version: 1 });
    const copy = JSON.parse(rolled.serialized);
    expect({ ...copy, publication_id: PUBLICATION, generated_at: built.artifact.generated_at }).toEqual(JSON.parse(built.serialized));
    // A source claiming v2 that is really v1 bytes is refused.
    await expect(buildRollbackPublicationArtifact({
      siteId: SITE, brandId: BRAND, publicationId: "00000000-0000-4000-8000-000000000906",
      sourceRevisionId: "rev-w3", sourceDigest: built.artifact.source_digest, generatedAt: "2026-10-27T00:00:00Z",
      rollbackSourcePublicationId: PUBLICATION, rollbackSource: { ...source, artifact_schema_version: 1, renderer_key: "restaurant-website-v1" },
    })).rejects.toThrow("VALIDATION_FAILED");
  });
});

describe("#2829 S-10 the look is validated on every save, drafts included", () => {
  it("the Site settings hook refuses CSS in tokens and non-catalogue fonts, and passes valid values", async () => {
    const { SiteSettings } = await import("../collections/SiteSettings");
    const hooks = SiteSettings.hooks!.beforeChange! as Array<(args: Record<string, unknown>) => unknown>;
    // hooks[0] is the one-settings-per-tenant guard; hooks[1] is the look check.
    const lookHook = hooks[1]!;
    const run = (data: Record<string, unknown>) =>
      lookHook({ data, req: { t: (key: string) => key, payload: {} }, operation: "update", originalDoc: { tenant: "t1" }, collection: SiteSettings, context: {} });
    expect(() => run({ tokens: { colors: { canvas: "red;}" } } })).toThrow();
    expect(() => run({ tokens: { css: "body{}" } })).toThrow();
    expect(() => run({ fonts: { display: { family: "Not A Font", source: "google" } } })).toThrow();
    expect(() => run({ tokens: { colors: { canvas: "#ffffff", ink_body: "#bbbbbb" } }, fonts: { display: { family: "Fraunces", source: "google" } } })).not.toThrow();
  });
});
