// MINGLA-INVARIANT: I-SITES-ARI-NEVER-PICKS-AVOID | issue #4453 | Ari never proposes a style the fit table marks avoid for the brand's primary format; an owner may still pick it, with a warning.
/*
 * #4453 milestone 7 — formats.ts (generated copy): SC-F1 (primary format),
 * the v2.1 §2.4 fit table (N4), fixed reasons (N5), uniqueness (§6.6, D7
 * warns only) and the page-set slug rules (v2.1 §1.1).
 *
 * invariant: I-SITES-ARI-NEVER-PICKS-AVOID (declared on line 1 of this file).
 */
import { describe, expect, it } from "vitest";
import {
  FORMAT_KEYS, FORMAT_PAGE_SETS, FORMAT_RECIPES, STYLE_AVOID_WARNING, STYLE_KEYS, designFingerprint, fingerprintDistance,
  formatsForPlan, primaryFormat, secondaryFormats, similarLiveSites, skippedLine, styleFit, styleFitLevel, styleFitReason,
  topStylePicks, type FormatKey,
} from "../contracts/generated/formats.ts";
import { RESERVED_FIRST_SEGMENTS, SLUG_PATTERN } from "../contracts/generated/routes.ts";
import { BLOCK_TYPES } from "../contracts/generated/blocks.ts";
import { DESIGN_KEYS } from "../contracts/generated/designs.ts";

const AVOID: Record<FormatKey, string[]> = {
  restaurants: ["pop", "sunset"],
  hotels: ["grid", "pulse"],
  play: ["maison", "haven"],
  art: ["pop"],
  trips: ["pulse", "nocturne"],
  events: ["terra", "haven"],
  experiences: ["pulse", "grid"],
};
const PICKS: Record<FormatKey, string[]> = {
  restaurants: ["nocturne", "maison", "journal"],
  hotels: ["haven", "maison", "voyage"],
  play: ["pop", "pulse", "sunset"],
  art: ["grid", "journal", "maison"],
  trips: ["voyage", "terra", "journal"],
  events: ["pulse", "nocturne", "grid"],
  experiences: ["terra", "haven", "sunset"],
};

describe("#4453 primary format (SC-F1)", () => {
  it("the main action's page names the primary; else the first tick in M1 order", () => {
    expect(primaryFormat({ offerings_selected: ["events", "trips"] })).toBe("trips");
    expect(primaryFormat({ offerings_selected: ["events", "trips"], main_action_page: "events" })).toBe("events");
    expect(primaryFormat({ offerings_selected: ["venue_food_drink", "events"], main_action_page: "menu" })).toBe("restaurants");
    expect(primaryFormat({ offerings_selected: ["venue_stay"] })).toBe("hotels");
    expect(primaryFormat({ offerings_selected: [] })).toBeNull();
    expect(secondaryFormats({ offerings_selected: ["trips", "events", "experiences"] })).toEqual(["events", "experiences"]);
    expect(formatsForPlan(["venue_creative_arts", "venue_play"])).toEqual(["play", "art"]);
  });
});

describe("#4453 style fit (v2 §6.3 + v2.1 §2.4, N4)", () => {
  it("the ten styles exclude Atelier, and the table is the approved one", () => {
    expect(STYLE_KEYS).toHaveLength(10);
    expect(STYLE_KEYS).not.toContain("atelier");
    for (const style of STYLE_KEYS) expect(DESIGN_KEYS).toContain(style);
    for (const format of FORMAT_KEYS) {
      expect(STYLE_KEYS.filter((style) => styleFitLevel(format, style) === "avoid")).toEqual(expect.arrayContaining(AVOID[format]));
      expect(STYLE_KEYS.filter((style) => styleFitLevel(format, style) === "avoid")).toHaveLength(AVOID[format].length);
      expect(styleFit(format).filter((entry) => entry.fit === "pick").map((entry) => entry.style)).toEqual(PICKS[format]);
    }
  });

  it("Ari's suggestions never include an avoid style, whatever the signals", () => {
    for (const format of FORMAT_KEYS) {
      for (const descriptor of [null, "Nightclub", "Gallery", "Café", "Rooftop", "Studio"]) {
        const taken = [...STYLE_KEYS].slice(0, 7);
        for (const signals of [{ venue_descriptor: descriptor }, { venue_descriptor: descriptor, taken }]) {
          const picks = topStylePicks(format, signals, 10);
          expect(picks.some((entry) => entry.fit === "avoid")).toBe(false);
          expect(picks.map((entry) => entry.style)).not.toEqual(expect.arrayContaining(AVOID[format].slice(0, 1)));
        }
      }
      // Avoid styles are always ranked last.
      const ranked = styleFit(format);
      expect(ranked.slice(-AVOID[format].length).every((entry) => entry.fit === "avoid")).toBe(true);
    }
  });

  it("mood signals reorder picks; a taken pick drops behind the ○ styles", () => {
    expect(topStylePicks("restaurants", { venue_descriptor: "Cocktail bar" })[0]!.style).toBe("nocturne");
    expect(topStylePicks("events", { venue_descriptor: "Nightclub" }).map((entry) => entry.style).slice(0, 2)).toEqual(["pulse", "nocturne"]);
    const taken = topStylePicks("trips", { taken: ["voyage"] }, 10);
    expect(taken.findIndex((entry) => entry.style === "voyage")).toBeGreaterThan(taken.findIndex((entry) => entry.fit === "fits"));
    expect(topStylePicks("trips")[0]!.style).toBe("voyage");
  });

  it("reasons are 70 fixed sentences (N5): deterministic, distinct per pair, never a model call", () => {
    const all = FORMAT_KEYS.flatMap((format) => STYLE_KEYS.map((style) => styleFitReason(format, style)));
    expect(all).toHaveLength(70);
    expect(new Set(all).size).toBe(70);
    for (const reason of all) {
      expect(reason).toMatch(/^[A-Z][^{}$]*\.$/);
      expect(reason.length).toBeLessThanOrEqual(120);
    }
    expect(styleFitReason("trips", "voyage")).toBe("Big landscapes and a sociable voice for group trips.");
    expect(skippedLine("trips")).toBe("Ari skipped Pulse and Nocturne: after-dark looks for daylight trips.");
    expect(STYLE_AVOID_WARNING).toBe("This style is built for other kinds of places. Your bookings will still work.");
    expect(JSON.stringify(styleFit("art"))).toBe(JSON.stringify(styleFit("art")));
  });
});

describe("#4453 uniqueness (§6.6, D7)", () => {
  const base = { design: "voyage", header: "glass", hero: "fullbleed", home: [{ type: "hero", variant: "fullbleed" }, { type: "offering_grid", variant: "poster" }], fonts: { display: "Inter", body: "Inter" }, primary: "#1f6feb", accent: "#ff7a00" };
  it("distance counts the six parts; near colours share a bucket", () => {
    const a = designFingerprint(base);
    expect(fingerprintDistance(a, designFingerprint({ ...base, primary: "#2070ee" }))).toBe(0);
    expect(fingerprintDistance(a, designFingerprint({ ...base, hero: "editorial" }))).toBe(1);
    expect(fingerprintDistance(a, designFingerprint({ ...base, design: "terra", hero: "editorial", header: "pill" }))).toBe(3);
    expect(similarLiveSites(a, [a, designFingerprint({ ...base, hero: "editorial" }), designFingerprint({ ...base, design: "terra", header: "pill" })])).toBe(2);
  });
});

describe("#4453 page sets (v2.1 §1.1)", () => {
  it("every slug is valid, unreserved and unique within its format; every section type exists", () => {
    for (const format of FORMAT_KEYS) {
      const slugs = FORMAT_PAGE_SETS[format].map((entry) => entry.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
      for (const slug of slugs) {
        expect(slug).toMatch(SLUG_PATTERN);
        expect((RESERVED_FIRST_SEGMENTS as readonly string[]).includes(slug)).toBe(false);
      }
      expect(FORMAT_PAGE_SETS[format].filter((entry) => entry.listing)).toHaveLength(1);
      for (const section of [...FORMAT_RECIPES[format], ...FORMAT_PAGE_SETS[format].flatMap((entry) => entry.sections)]) {
        expect(BLOCK_TYPES).toContain(section.type);
      }
      for (const entry of FORMAT_PAGE_SETS[format]) {
        expect(entry.label.length).toBeLessThanOrEqual(16);
        if (entry.kind === "collection_index") expect(entry.slug).toBe(entry.collection);
      }
    }
    expect(FORMAT_PAGE_SETS.experiences.map((entry) => entry.slug)).toContain("book-a-session");
    expect(FORMAT_PAGE_SETS.restaurants.map((entry) => entry.slug)).not.toContain("contact");
  });
});
