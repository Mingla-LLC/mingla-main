/* eslint-disable @typescript-eslint/no-explicit-any -- this suite mutates untyped artifact JSON on purpose to prove each refusal. */
/*
 * #2829 W3 (T-W3) — the v2 artifact contract and the v1 → v2 upgrade.
 *
 * `assertArtifactV2` refuses unknown keys, markup, unsafe links, layouts the
 * design does not draw and anything over the limits; `upgradeV1ToV2` turns
 * every gögi block type into a v2 block under atelier without moving a field.
 */
import { describe, expect, it } from "vitest";
import { assertRestaurantArtifact } from "./artifact";
import { assertArtifactV2, MAX_ARTIFACT_BYTES, type ArtifactV2 } from "./generated/artifactV2.ts";
import { upgradeV1ToV2 } from "./generated/upgradeV1ToV2.ts";
import { BLOCK_TYPES } from "./generated/blocks.ts";
import { NEUTRAL_BLOCK_TYPES } from "./generated/designs.ts";
import { blockSchema, blocksSchema, tokenOverridesSchema } from "./generated/ariToolSchemas.ts";
import { FX, FX_SITE, fixtureMedia, gogiV1Fixture } from "./gogiV1.fixture";

const fonts = [
  { family: "Oswald", weight: 400, style: "normal" as const, unicode_range: "U+0000-00FF", digest: "d".repeat(64), bytes: 1000 },
  { family: "Plus Jakarta Sans", weight: 400, style: "normal" as const, unicode_range: "U+0000-00FF", digest: "e".repeat(64), bytes: 1000 },
];

function upgraded(): ArtifactV2 {
  return upgradeV1ToV2(gogiV1Fixture(), { fontAssets: fonts });
}

function expectRefused(mutate: (artifact: Record<string, unknown>) => void, code: string | RegExp) {
  const artifact = structuredClone(upgraded()) as unknown as Record<string, unknown>;
  mutate(artifact);
  expect(() => assertArtifactV2(artifact)).toThrow(code);
}

describe("#2829 the gögi fixture", () => {
  it("is a valid v1 artifact that uses all 22 restaurant block types", () => {
    const v1 = gogiV1Fixture();
    assertRestaurantArtifact(v1);
    const used = new Set(v1.pages.flatMap((page) => page.blocks.map((block) => block.type)));
    // #2829 W5 — the travel/collection/form types are v2-only (no v1 form exists).
    expect([...used].sort()).toEqual(BLOCK_TYPES.filter((type) => !NEUTRAL_BLOCK_TYPES.includes(type)).sort());
  });
});

describe("#2829 upgradeV1ToV2", () => {
  it("produces a valid v2 artifact under atelier", () => {
    const artifact = upgraded();
    assertArtifactV2(artifact, JSON.stringify(artifact).length);
    expect(artifact.design).toEqual({ key: "atelier", version: 1 });
    expect(artifact.renderer_key).toBe("sites-v2");
    expect(artifact.artifact_schema_version).toBe(2);
  });

  it("keeps every v1 field and adds the atelier variant; rich text becomes the tree", () => {
    const v1 = gogiV1Fixture();
    const v2 = upgraded();
    v1.pages.forEach((page, pageIndex) => {
      page.blocks.forEach((block, blockIndex) => {
        const next = v2.pages[pageIndex]!.blocks[blockIndex]! as Record<string, unknown>;
        expect(next.variant).toBe("atelier");
        for (const [key, value] of Object.entries(block)) {
          if (block.type === "rich_text" && key === "paragraphs") continue;
          expect(next[key]).toEqual(value);
        }
      });
    });
    const prose = v2.pages[0]!.blocks.find((block) => block.type === "rich_text") as Record<string, unknown>;
    expect(prose.body).toEqual({
      type: "doc",
      children: [
        { type: "paragraph", children: [{ type: "text", text: "Come as you are." }] },
        { type: "paragraph", children: [{ type: "text", text: "Rice at noon, shawarma at three." }] },
      ],
    });
    expect("paragraphs" in prose).toBe(false);
  });

  it("turns the six roles into paths and the menu order into navigation", () => {
    const v2 = upgraded();
    expect(v2.pages.map((page) => page.path)).toEqual(["", "about", "menu", "gallery", "reservations"]);
    expect(v2.navigation.items.map((item) => `${item.label}>${item.href}`)).toEqual([
      "Home>/", "About>/about", "Menu>/menu", "Gallery>/gallery", "Book>/reservations",
    ]);
    // The six-role runtime sent a retired /contact to the booking page.
    expect(v2.redirects).toEqual([{ from: "/contact", to: "/reservations", status: 308 }]);
  });

  it("carries the brand's colours exactly and the pairing as font slots", () => {
    const v1 = gogiV1Fixture();
    (v1.site_settings.colors as Record<string, string>) = { background: "#FAFAFA", foreground: "#222222", accent: "#FF00AA" };
    const v2 = upgradeV1ToV2(v1);
    expect(v2.tokens.colors.canvas).toBe("#fafafa");
    expect(v2.tokens.colors.ink_body).toBe("#222222");
    expect(v2.tokens.colors.accent[400]).toBe("#ff00aa");
    // Only the one step the brand set moves; atelier's hover gold stays.
    expect(v2.tokens.colors.accent[300]).toBe("#dfb262");
    expect(v2.fonts.display).toEqual({ family: "Oswald", source: "google", weights: [400, 600], italic: false });
    expect(v2.tokens.heading_case).toBe("uppercase");
    const serif = gogiV1Fixture();
    (serif.site_settings as Record<string, unknown>).typography = "editorial-serif";
    const serifV2 = upgradeV1ToV2(serif);
    expect(serifV2.fonts.display.family).toBe("Playfair Display");
    expect(serifV2.tokens.heading_case).toBe("none");
  });

  it("makes absolute media on the site's own origin relative", () => {
    const fixture = gogiV1Fixture() as unknown as Record<string, any>;
    const origin = fixture.site_settings.seo.canonical_url;
    const v1 = JSON.parse(JSON.stringify(fixture).replaceAll('"/media/', `"${origin}/media/`));
    assertRestaurantArtifact(v1);
    const v2 = upgradeV1ToV2(v1);
    assertArtifactV2(v2);
    expect((v2.pages[0]!.blocks[0] as Record<string, unknown>).media_url).toBe(`/media/${FX(1)}/1440.webp`);
  });

  it("upgrades a W2 page-tree artifact too", () => {
    const v1 = gogiV1Fixture() as unknown as Record<string, any>;
    v1.pages = v1.pages.map((page: Record<string, any>) => ({
      path: page.role === "home" ? "" : page.slug, title: page.title, enabled: page.enabled, kind: "standard", blocks: page.blocks,
    }));
    v1.navigation = { items: [{ label: "Menu", href: "/menu", children: [{ label: "Gallery", href: "/gallery" }] }], wordmark: "EFH" };
    v1.site_routes = { routes: { trips: "trips", events: "events", experiences: "experiences", destinations: "destinations", stories: "stories" }, redirects: [{ from: "/old", to: "/menu", status: 301 }], language: "en-GB", timezone: "Africa/Lagos" };
    assertRestaurantArtifact(v1);
    const v2 = upgradeV1ToV2(v1);
    assertArtifactV2(v2);
    expect(v2.navigation).toEqual(v1.navigation);
    expect(v2.redirects).toEqual([{ from: "/old", to: "/menu", status: 301 }]);
    expect(v2.language).toBe("en-GB");
    expect(v2.timezone).toBe("Africa/Lagos");
  });
});

describe("#2829 assertArtifactV2 refusals", () => {
  it("refuses unknown keys at every level", () => {
    expectRefused((a) => { a.extra = 1; }, "ARTIFACT_SCHEMA_MISMATCH");
    expectRefused((a: any) => { a.pages[0].blocks[0].style = "color:red"; }, "ARTIFACT_BLOCK_TYPE_MISMATCH");
    expectRefused((a: any) => { a.brand.css = "x"; }, "ARTIFACT_BRAND_MISMATCH");
    expectRefused((a: any) => { a.tokens.colors.extra = "#000000"; }, /ARTIFACT_TOKENS_MISMATCH/);
    expectRefused((a: any) => { a.fonts.display.url = "https://fonts.googleapis.com"; }, /ARTIFACT_FONTS_MISMATCH/);
  });

  it("refuses markup and unsafe links (FORBIDDEN_TEXT, isSafeHref)", () => {
    expectRefused((a: any) => { a.pages[0].blocks[0].heading = "<script>alert(1)</script>"; }, "ARTIFACT_BLOCK_CONTENT_MISMATCH");
    expectRefused((a: any) => { a.pages[0].blocks[0].ctas[0].href = "javascript:alert(1)"; }, "ARTIFACT_BLOCK_CONTENT_MISMATCH");
    expectRefused((a: any) => { a.pages[0].blocks[2].body.children[0].children[0].text = "x onload=alert(1)"; }, "ARTIFACT_RICH_TEXT_MISMATCH");
    expectRefused((a: any) => { a.pages[0].blocks[2].body.children.push({ type: "html", value: "<b>" }); }, "ARTIFACT_RICH_TEXT_MISMATCH");
    expectRefused((a: any) => { a.footer.links[0].href = "data:text/html,x"; }, "ARTIFACT_FOOTER_MISMATCH");
  });

  it("refuses a layout the design does not draw", () => {
    expectRefused((a: any) => { a.pages[0].blocks[0].variant = "cover-bottom-search"; }, "ARTIFACT_VARIANT_MISMATCH");
    // #2829 W7 — voyage is registered now: an atelier page switched to it still carries atelier layouts.
    expectRefused((a: any) => { a.design = { key: "voyage", version: 1 }; }, "ARTIFACT_VARIANT_MISMATCH");
    expectRefused((a: any) => { a.design = { key: "lagoon", version: 1 }; }, "ARTIFACT_DESIGN_MISMATCH");
    expectRefused((a: any) => { a.design.version = 2; }, "ARTIFACT_DESIGN_MISMATCH");
  });

  it("refuses colours that are not explicit hex and fonts that are not first-party", () => {
    expectRefused((a: any) => { a.tokens.colors.canvas = "red"; }, /ARTIFACT_TOKENS_MISMATCH/);
    expectRefused((a: any) => { a.tokens.colors.accent[400] = "#fff"; }, /ARTIFACT_TOKENS_MISMATCH/);
    expectRefused((a: any) => { a.font_assets[0].digest = "x"; }, /ARTIFACT_FONT_ASSETS_MISMATCH/);
    expectRefused((a: any) => { a.font_assets[0].family = "Comic Neue"; }, /ARTIFACT_FONT_ASSETS_MISMATCH/);
    expectRefused((a: any) => { a.fonts.display.family = "Oswald'; }"; }, /ARTIFACT_FONTS_MISMATCH/);
  });

  it("enforces the limits", () => {
    expectRefused((a: any) => { a.pages = Array.from({ length: 101 }, (_, i) => ({ ...a.pages[0], path: i ? `p${i}` : "" })); }, "ARTIFACT_PAGES_MISMATCH");
    expectRefused((a: any) => { a.pages[0].blocks = Array.from({ length: 61 }, () => ({ type: "divider", variant: "atelier" })); }, "ARTIFACT_BLOCKS_MISMATCH");
    expectRefused((a: any) => { a.navigation.items = Array.from({ length: 9 }, () => ({ label: "Home", href: "/" })); }, "ARTIFACT_NAVIGATION_MISMATCH");
    expectRefused((a: any) => { a.navigation.items = [{ label: "Home", href: "/", children: Array.from({ length: 9 }, () => ({ label: "Menu", href: "/menu" })) }]; }, "ARTIFACT_NAVIGATION_MISMATCH");
    expectRefused((a: any) => { a.redirects = Array.from({ length: 201 }, (_, i) => ({ from: `/r${i}`, to: "/menu", status: 308 })); }, "ARTIFACT_ROUTES_MISMATCH");
    expectRefused((a: any) => { a.font_assets = Array.from({ length: 25 }, (_, i) => ({ ...a.font_assets[0], weight: 100 * ((i % 9) + 1), unicode_range: `U+${i.toString(16).padStart(4, "0")}` })); }, /ARTIFACT_FONT_ASSETS_MISMATCH/);
    expectRefused((a: any) => { a.media = Array.from({ length: 1001 }, (_, i) => fixtureMedia(`aaaaaaaa-bbbb-4ccc-8ddd-${String(5000 + i).padStart(12, "0")}`)); }, "ARTIFACT_MEDIA_MISMATCH");
    expect(() => assertArtifactV2(upgraded(), MAX_ARTIFACT_BYTES + 1)).toThrow("ARTIFACT_TOO_LARGE");
  });

  it("refuses another site's media, absolute media and a non-origin canonical", () => {
    expectRefused((a: any) => { a.media[0].object_key = a.media[0].object_key.replace(FX_SITE, FX(99)); }, "ARTIFACT_MEDIA_MISMATCH");
    expectRefused((a: any) => { a.media[0].url = `https://evil.example${a.media[0].url}`; }, "ARTIFACT_MEDIA_MISMATCH");
    expectRefused((a: any) => { a.pages[0].blocks[0].media_url = `/media/${FX(77)}/1440.webp`; }, "ARTIFACT_BLOCK_CONTENT_MISMATCH");
    expectRefused((a: any) => { a.seo.canonical_url = "https://example.com/path"; }, "ARTIFACT_SEO_MISMATCH");
    expectRefused((a: any) => { a.pages[0].enabled = false; }, "ARTIFACT_HOME_EMPTY");
  });
});

describe("#2829 Ari tool schemas come from the catalogue", () => {
  it("covers every block type, limits layouts to the design, and carries no markup fields", () => {
    // #2829 W9b — provider-safe keywords: `anyOf` and one-value `enum`, never `oneOf`/`const`.
    const schemas = (blocksSchema("atelier").anyOf as Array<Record<string, any>>);
    expect(schemas.map((schema) => schema.properties.type.enum[0])).toEqual(BLOCK_TYPES);
    expect(blockSchema("hero", "atelier").properties).toMatchObject({ variant: { enum: ["atelier"] } });
    const text = JSON.stringify(blocksSchema("atelier")) + JSON.stringify(tokenOverridesSchema());
    expect(text).not.toMatch(/"(html|css|style|script|className)"/i);
    expect(JSON.stringify(tokenOverridesSchema())).toContain("^#[0-9a-f]{6}$");
  });
});
