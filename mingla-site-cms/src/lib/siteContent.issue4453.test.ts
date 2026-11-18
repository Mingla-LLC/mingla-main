/*
 * #4453 milestone 7b — destination and story cards show the record's OWN
 * picture when it has one anywhere (featured, else its gallery or season for a
 * destination, else the first picture inside a story), never another record's
 * and never a made-up one. With none, no picture is published (the design's
 * no-photo treatment), never a broken reference.
 */
import { describe, expect, it } from "vitest";
import { firstUploadedPicture, shapeSiteCollections } from "./siteContent";

const idOf = (value: unknown) => String(value && typeof value === "object" ? (value as { id: string }).id : value);
const render = (mediaId: unknown, alt: string) => ({ id: idOf(mediaId), url: `/media/${idOf(mediaId)}/1440.webp`, alt, width: 1440, height: 960 });
const lexical = (children: unknown[]) => ({ root: { type: "root", children } });
const text = (value: string) => ({ type: "paragraph", children: [{ type: "text", text: value }] });

describe("#4453 m7b destination and story pictures", () => {
  it("a destination falls back to its own gallery, then its own season picture; with none it has no picture", () => {
    const shaped = shapeSiteCollections({
      destinations: [
        { id: "d1", slug: "porto", title: "Porto", featured_image: "m-feat", gallery: [{ media: "m-gal" }], enabled: true },
        { id: "d2", slug: "lisbon", title: "Lisbon", gallery: [{ media: { id: "m-gal2" }, alt: "Tram" }], seasons: [{ heading: "Summer", image: "m-sea" }], enabled: true },
        { id: "d3", slug: "faro", title: "Faro", seasons: [{ heading: "Winter", image: "m-sea3" }], enabled: true },
        { id: "d4", slug: "evora", title: "Evora", enabled: true },
      ],
      stories: [], categories: [], testimonials: [],
    } as never, render as never);
    expect(shaped.destinations.map((row) => row.featured_image?.id ?? null)).toEqual(["m-feat", "m-gal2", "m-sea3", null]);
    expect(shaped.destinations[1]!.featured_image?.alt).toBe("Tram");
  });

  it("a story falls back to the first picture inside it; with none it has no picture", () => {
    const shaped = shapeSiteCollections({
      destinations: [],
      stories: [
        { id: "s1", slug: "one", title: "One", published_at: "2026-09-01T00:00:00.000Z", content: lexical([text("Hi"), { type: "upload", relationTo: "media", value: { id: "m-in" } }]), enabled: true },
        { id: "s2", slug: "two", title: "Two", published_at: "2026-09-02T00:00:00.000Z", content: lexical([text("No pictures.")]), enabled: true },
      ],
      categories: [], testimonials: [],
    } as never, render as never);
    expect(shaped.stories.map((row) => row.featured_image?.id ?? null)).toEqual(["m-in", null]);
    expect(firstUploadedPicture(lexical([{ type: "upload", relationTo: "other", value: "x" }]))).toBeNull();
  });
});
