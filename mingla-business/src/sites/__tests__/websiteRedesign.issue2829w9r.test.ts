/*
 * #2829 W9r (DESIGN_SPEC §1.2–§1.7, §3, §7) — the redesigned Website
 * section's rules, as pure functions:
 *  - the navigation offers only what exists (no site: Overview + Setup plan;
 *    collections only when the design has a page for them or entries exist;
 *    Past trips only when the brand offers trips), with the right meta;
 *  - old addresses redirect (look → design, domains → addresses, plan?part=);
 *  - the preview renders at the device's real CSS size, rotate does nothing
 *    on Desktop, and the remembered choice survives a round trip;
 *  - readability warnings sit under the swatch they concern;
 *  - the story editor writes exactly the site's rich-text tree;
 *  - no business-type word leaks for a brand that doesn't offer it.
 */
import {
  parseWebsitePath,
  routeToRender,
  websiteNavGroups,
  websitePath,
  type WebsiteNavInput,
} from "../websiteNav";
import {
  defaultPreviewPreference,
  fullScreenPreviewPath,
  parsePreviewPreference,
  preferenceFromQuery,
  previewDimensions,
  previewScale,
  previewSizeReadout,
  rotated,
  withDevice,
} from "../previewDevice";
import { blocksToDoc, docToBlocks, linkSelection, textToInlines, wrapSelection } from "../richTextBlocks";
import { offeringChangedLine, offeringNoun } from "../websiteCopy";
import { swatchWarnings, setSwatch } from "../siteLook";
import { previewFrameSource } from "../previewFrame";
import { DESIGNS } from "../../../../packages/site-contracts/src/designs.ts";
import { resolveTokens } from "../../../../packages/site-contracts/src/tokens.ts";
import { assertRichText } from "../../../../packages/site-contracts/src/richText.ts";

const BRAND = "4cb672ab-6e9c-441e-ade4-3a10d2619432";

const nav = (patch: Partial<WebsiteNavInput> = {}): WebsiteNavInput => ({
  hasSite: true,
  designLabel: "Voyage",
  designHasCollectionPages: true,
  designDirty: false,
  pagesInMenu: 7,
  counts: { destinations: 6, stories: 3, reviews: 3, past: 5 },
  reviewsNeedingConfirmation: 0,
  tripsTicked: true,
  unpublishedChanges: 3,
  domainNeedsAttention: false,
  plan: { done: 8, total: 8 },
  offline: false,
  ...patch,
});
const keys = (input: WebsiteNavInput) => websiteNavGroups(input).flatMap((group) => group.items.map((item) => item.key));

describe("#2829 W9r Website navigation", () => {
  it("a section the site doesn't have renders the Overview until the redirect lands (never the section)", () => {
    expect(routeToRender({ kind: "section", section: "publish" }, true)).toEqual({ kind: "section", section: "overview" });
    expect(routeToRender({ kind: "editor", section: "reviews", entryId: "new" }, true)).toEqual({ kind: "section", section: "overview" });
    expect(routeToRender({ kind: "section", section: "publish" }, false)).toEqual({ kind: "section", section: "publish" });
    expect(routeToRender({ kind: "preview" }, true)).toEqual({ kind: "preview" });
  });

  it("offers only Overview and Setup plan before a site exists", () => {
    expect(keys(nav({ hasSite: false, plan: { done: 3, total: 8 } }))).toEqual(["overview", "plan"]);
    expect(websiteNavGroups(nav({ hasSite: false, plan: { done: 3, total: 8 } }))[0]!.items[1]!.meta).toBe("3 of 8");
  });

  it("groups a live Voyage site exactly as designed, with meta on the right", () => {
    const groups = websiteNavGroups(nav());
    expect(groups.map((group) => group.heading)).toEqual([null, "Build", "Content", "Go live", "Manage"]);
    expect(keys(nav())).toEqual(["overview", "pages", "design", "destinations", "stories", "reviews", "past", "publish", "addresses", "plan", "settings"]);
    const meta = Object.fromEntries(groups.flatMap((group) => group.items.map((item) => [item.key, item.meta])));
    expect(meta).toMatchObject({ pages: "7", design: "Voyage", destinations: "6", publish: "3", plan: "Done", settings: null });
  });

  it("shows collections only when the design has a page for them or entries exist; past trips only for trips", () => {
    expect(keys(nav({ designHasCollectionPages: false, counts: { destinations: 0, stories: 0, reviews: 0, past: 0 }, tripsTicked: false })))
      .not.toEqual(expect.arrayContaining(["destinations", "stories", "reviews", "past"]));
    expect(keys(nav({ designHasCollectionPages: false, counts: { destinations: 0, stories: 2, reviews: 0, past: 0 } }))).toContain("stories");
    expect(keys(nav({ tripsTicked: false }))).not.toContain("past");
  });

  it("marks what needs attention with a dot, not a count", () => {
    const items = websiteNavGroups(nav({ reviewsNeedingConfirmation: 1, designDirty: true, domainNeedsAttention: true, offline: true }))
      .flatMap((group) => group.items);
    const byKey = Object.fromEntries(items.map((item) => [item.key, item]));
    expect(byKey.reviews).toMatchObject({ attention: true, meta: null });
    expect(byKey.design).toMatchObject({ attention: true });
    expect(byKey.addresses).toMatchObject({ attention: true });
    expect(byKey.settings!.meta).toBe("Offline");
  });

  it("maps every Website address, and redirects the old ones", () => {
    expect(parseWebsitePath(BRAND, [])).toEqual({ kind: "section", section: "overview" });
    expect(parseWebsitePath(BRAND, ["look"])).toEqual({ kind: "redirect", to: `/brand/${BRAND}/website/design` });
    expect(parseWebsitePath(BRAND, ["domains"])).toEqual({ kind: "redirect", to: `/brand/${BRAND}/website/addresses` });
    expect(parseWebsitePath(BRAND, ["plan"], { part: "story" })).toEqual({ kind: "section", section: "plan", planPart: "story" });
    expect(parseWebsitePath(BRAND, ["destinations", "new"])).toEqual({ kind: "editor", section: "destinations", entryId: "new" });
    expect(parseWebsitePath(BRAND, ["reviews", "abc-123"])).toEqual({ kind: "editor", section: "reviews", entryId: "abc-123" });
    expect(parseWebsitePath(BRAND, ["preview"])).toEqual({ kind: "preview" });
    expect(parseWebsitePath(BRAND, ["nope"])).toEqual({ kind: "section", section: "overview" });
    expect(parseWebsitePath(BRAND, ["pages", "x"])).toEqual({ kind: "section", section: "overview" });
    expect(websitePath(BRAND, { kind: "section", section: "plan", planPart: "build" })).toBe(`/brand/${BRAND}/website/plan?part=build`);
    expect(websitePath(BRAND, { kind: "section", section: "overview" })).toBe(`/brand/${BRAND}/website`);
  });
});

describe("#2829 W9r preview at any size (SPEC §37 A21)", () => {
  it("renders at the device's real CSS size, rotating tablet and phone only", () => {
    const desktop = defaultPreviewPreference(true);
    expect(previewDimensions(desktop)).toEqual({ width: 1440, height: 900 });
    expect(rotated(desktop)).toBe(desktop);
    const tablet = withDevice(desktop, "tablet");
    expect(previewDimensions(tablet)).toEqual({ width: 820, height: 1180 });
    expect(previewDimensions(rotated(tablet))).toEqual({ width: 1180, height: 820 });
    expect(previewSizeReadout(rotated(tablet))).toBe("1180 × 820 · landscape");
    const phone = withDevice(rotated(tablet), "phone");
    expect(previewDimensions(phone)).toEqual({ width: 390, height: 844 });
    expect(phone.tablet).toBe("landscape");
    expect(previewSizeReadout(desktop)).toBe("1440 × 900");
    expect(defaultPreviewPreference(false).device).toBe("phone");
  });

  it("scales to fit, never up", () => {
    expect(previewScale({ paneWidth: 408, maxHeight: 520, width: 1440, height: 900 })).toBeCloseTo(408 / 1440);
    expect(previewScale({ paneWidth: 408, maxHeight: 520, width: 390, height: 844 })).toBeCloseTo(520 / 844);
    expect(previewScale({ paneWidth: 2000, maxHeight: 2000, width: 390, height: 844 })).toBe(1);
  });

  it("round-trips the remembered choice and refuses anything else", () => {
    const pref = { device: "tablet" as const, tablet: "landscape" as const, phone: "portrait" as const };
    expect(parsePreviewPreference(JSON.parse(JSON.stringify(pref)))).toEqual(pref);
    expect(parsePreviewPreference({ device: "tv" })).toBeNull();
    expect(parsePreviewPreference(null)).toBeNull();
    expect(fullScreenPreviewPath(BRAND, pref)).toBe(`/brand/${BRAND}/website/preview?device=tablet&orientation=landscape`);
    expect(preferenceFromQuery(defaultPreviewPreference(true), { device: "phone", orientation: "landscape" }))
      .toEqual({ device: "phone", tablet: "portrait", phone: "landscape" });
  });

  it("frames the draft itself (not Studio's chrome) so the width is real", () => {
    const site = "11111111-1111-4111-8111-111111111111";
    expect(previewFrameSource("http://localhost:3101/preview?token=abc.def", site, "/about-us", null))
      .toBe(`http://localhost:3101/api/mingla/previews?site_id=${site}&token=abc.def&path=about-us`);
    expect(previewFrameSource("https://example.com/other", site, "", null)).toBe("https://example.com/other");
  });
});

describe("#2829 W9r readability sits under its swatch", () => {
  it("puts button-text warnings under Text on buttons, band warnings under the band, with a passing shade", () => {
    const tokens = setSwatch(setSwatch({}, { label: "Accent label", role: "accent_ink" }, "#9a8f6a")!, { label: "Tinted bands", role: "surface_sunken" }, "#4f5e71")!;
    const placed = swatchWarnings(DESIGNS.voyage, resolveTokens(DESIGNS.voyage.tokens, tokens));
    expect(placed.get("accent_ink")?.warning.pair).toBe("accent_label_on_accent");
    expect(placed.get("surface_sunken")?.warning.pair).toBe("body_on_tinted");
    expect(placed.get("accent_ink")?.suggestion).toMatch(/^#[0-9a-f]{6}$/);
    expect(swatchWarnings(DESIGNS.voyage, resolveTokens(DESIGNS.voyage.tokens, {})).size).toBe(0);
  });
});

describe("#2829 W9r story editor writes the site's rich-text tree", () => {
  it("round-trips headings, lists, quotes, marks and links", () => {
    const doc = {
      type: "doc" as const,
      children: [
        { type: "heading" as const, level: 2 as const, children: [{ type: "text" as const, text: "Day 1" }] },
        { type: "paragraph" as const, children: [{ type: "text" as const, text: "Coffee on " }, { type: "text" as const, text: "Rue de Bretagne", marks: ["bold" as const] }, { type: "link" as const, href: "https://example.com", children: [{ type: "text" as const, text: "map" }] }] },
        { type: "list" as const, ordered: false, items: [{ type: "list_item" as const, children: [{ type: "text" as const, text: "Musée" }] }, { type: "list_item" as const, children: [{ type: "text" as const, text: "Falafel" }] }] },
        { type: "quote" as const, children: [{ type: "text" as const, text: "Book ahead.", marks: ["italic" as const] }] },
      ],
    };
    const back = blocksToDoc(docToBlocks(doc));
    expect(back).toEqual(doc);
    expect(() => assertRichText(back)).not.toThrow();
    expect(blocksToDoc([{ id: "1", type: "paragraph", text: "   " }])).toBeNull();
  });

  it("Bold wraps the selection; unsafe links stay words", () => {
    expect(wrapSelection("Hello world", { start: 6, end: 11 }, "bold").text).toBe("Hello **world**");
    expect(linkSelection("see map", { start: 4, end: 7 }, "javascript:alert(1)")).toBeNull();
    expect(textToInlines("[x](javascript:alert(1))")).toEqual([{ type: "text", text: "[x](javascript:alert(1))" }]);
  });
});

describe("#2829 W9r copy follows the brand", () => {
  it("names what the brand offers, and 'menu' only for food and drink", () => {
    expect(offeringNoun(["trips", "events"])).toBe("trips");
    expect(offeringChangedLine(["venue_food_drink"])).toBe("Your menu changed in Mingla");
    expect(offeringChangedLine(["events"])).toBe("Your events changed in Mingla");
  });
  // #2829 W11 — "no Website surface says restaurant" is a structural rule now
  // held by the Sites strict-grep gate (issue-2830-sites-foundation.mjs).
});
