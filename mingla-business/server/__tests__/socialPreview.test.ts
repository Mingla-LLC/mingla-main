import { describe, expect, test } from "@jest/globals";

declare const require: <T = unknown>(path: string) => T;

const {
  brandImageUrl,
  brandPublicUrl,
  buildBrandOgCardProps,
  buildEventOgCardProps,
  buildOgTextFit,
  eventImageUrl,
  eventPublicUrl,
  renderBrandHtml,
  renderEventHtml,
} = require("../socialPreview") as {
  brandImageUrl: (row: Record<string, unknown>) => string;
  brandPublicUrl: (row: Record<string, unknown>) => string;
  buildBrandOgCardProps: (
    input:
      | Record<string, unknown>[]
      | { brand: Record<string, unknown>; events: Record<string, unknown>[] }
      | null,
  ) => Record<string, unknown>;
  buildEventOgCardProps: (
    row: Record<string, unknown> | null,
  ) => Record<string, unknown>;
  buildOgTextFit: (input: {
    cardKind?: string;
    title: string;
    subtitle: string;
    primaryChip?: string;
    secondaryChip?: string;
    accentLabel?: string;
  }) => Record<string, unknown>;
  eventImageUrl: (row: Record<string, unknown>) => string;
  eventPublicUrl: (row: Record<string, unknown>) => string;
  renderBrandHtml: (
    input:
      | Record<string, unknown>[]
      | {
          brand: Record<string, unknown>;
          events: Record<string, unknown>[];
          venue?: Record<string, unknown> | null;
        },
  ) => string;
  renderEventHtml: (row: Record<string, unknown>) => string;
};

const row = {
  id: "event-1",
  brand_slug: "test-stripe",
  brand_name: "Test Stripe",
  brand_description: "Host-led popups in London.",
  brand_profile_photo_url: null,
  title: "Great Free Event",
  description: "A free Mingla QA event.",
  slug: "great-free-event",
  location_text: "The Good Room",
  is_online: false,
  cover_media_url: null,
  cover_media_type: null,
  public_theme: {
    business_event: {
      when: { date: "2026-05-08" },
    },
  },
};

const brand = {
  id: "brand-1",
  slug: "brand-3",
  name: "Brand 3",
  description: "Small-room popups and careful hosting.",
  profile_photo_url: null,
  cover_media_url: null,
  cover_media_type: null,
};

describe("social preview metadata renderers", () => {
  test("renders crawler-visible event metadata on the canonical business domain", () => {
    const html = renderEventHtml(row);

    expect(eventPublicUrl(row)).toBe(
      "https://business.usemingla.com/e/test-stripe/great-free-event",
    );
    expect(eventImageUrl(row)).toBe(
      "https://business.usemingla.com/og/event/event-1.png",
    );
    expect(html).toContain("<title>Great Free Event by Test Stripe | Mingla</title>");
    expect(html).toContain('property="og:title" content="Great Free Event by Test Stripe | Mingla"');
    expect(html).toContain('property="og:url" content="https://business.usemingla.com/e/test-stripe/great-free-event"');
    expect(html).toContain('property="og:image" content="https://business.usemingla.com/og/event/event-1.png"');
    expect(html).toContain('name="twitter:image" content="https://business.usemingla.com/og/event/event-1.png"');
    expect(html).toContain("<span class=\"pill\">May 8, 2026</span>");
    expect(html).not.toContain("business.mingla.com");
    expect(html).not.toContain("https://mingla.com/e");
    expect(html).not.toContain("exp://");
  });

  test("renders verified venue brand metadata with city in title", () => {
    const html = renderBrandHtml({
      brand: {
        ...brand,
        slug: "joes-pizza",
        name: "Joe's Pizza",
        description: "Neighbourhood slice shop.",
        kind: "physical",
        city: "Brooklyn",
      },
      venue: {
        kind: "physical",
        city: "Brooklyn",
      },
      events: [],
    });

    expect(html).toContain("Joe&#39;s Pizza · Brooklyn on Mingla</title>");
    expect(html).toContain("No upcoming events from this venue");
  });

  test("renders brand metadata with the Mingla Business OG fallback", () => {
    const html = renderBrandHtml({
      brand: {
        ...brand,
        slug: "test-stripe",
        name: "Test Stripe",
        description: "Host-led popups in London.",
      },
      events: [row],
    });

    expect(brandPublicUrl({ slug: "test-stripe" })).toBe(
      "https://business.usemingla.com/b/test-stripe",
    );
    expect(brandImageUrl({ slug: "test-stripe" })).toBe(
      "https://business.usemingla.com/og/brand/test-stripe.png",
    );
    expect(html).toContain("<title>Test Stripe on Mingla</title>");
    expect(html).toContain('property="og:type" content="profile"');
    expect(html).toContain(
      'property="og:image" content="https://business.usemingla.com/og/brand/test-stripe.png"',
    );
    expect(html).not.toContain("business.mingla.com");
    expect(html).not.toContain("https://mingla.com");
    expect(html).not.toContain("localhost");
  });

  test("uses the branded OG banner for share metadata even when source artwork exists", () => {
    expect(
      eventImageUrl({
        ...row,
        cover_media_url: "https://cdn.example.com/event-cover.png",
        cover_media_type: "image",
      }),
    ).toBe("https://business.usemingla.com/og/event/event-1.png");
    expect(
      brandImageUrl({
        ...brand,
        profile_photo_url: "https://cdn.example.com/brand-profile.png",
      }),
    ).toBe("https://business.usemingla.com/og/brand/brand-3.png");
    expect(
      brandImageUrl({
        ...brand,
        profile_photo_url: null,
        cover_media_url: "https://cdn.example.com/brand-cover.png",
        cover_media_type: "image",
      }),
    ).toBe("https://business.usemingla.com/og/brand/brand-3.png");
  });

  test("builds event OG card props with event date and location", () => {
    expect(buildEventOgCardProps(row)).toEqual(
      expect.objectContaining({
        cardKind: "event",
        title: "Great Free Event",
        kicker: "Test Stripe",
        dateLabel: "May 8, 2026",
        locationLabel: "The Good Room",
        coverUrl: null,
      }),
    );
    const props = buildEventOgCardProps(row);
    expect(props.textFit).toEqual(
      expect.objectContaining({
        primaryChipText: "May 8, 2026",
        secondaryChipText: "The Good Room",
      }),
    );
  });

  test("builds brand OG card props without exposing the brand handle", () => {
    const nextRow = {
      ...row,
      id: "event-2",
      title: "Summer Rooftop",
      slug: "summer-rooftop",
      cover_media_url: "https://cdn.example.com/cover.png",
      cover_media_type: "image",
      public_theme: {
        business_event: {
          when: { date: "2026-06-12" },
        },
      },
    };

    expect(
      buildBrandOgCardProps({
        brand: {
          ...brand,
          slug: "test-stripe",
          name: "Test Stripe",
          description: "Host-led popups in London.",
        },
        events: [nextRow, row],
      }),
    ).toEqual(
      expect.objectContaining({
        cardKind: "brand",
        title: "Test Stripe",
        kicker: "Mingla Business",
        eventCountLabel: "2 events",
        nextEventLabel: "Summer Rooftop - Jun 12, 2026",
        coverUrl: "https://cdn.example.com/cover.png",
      }),
    );
    const props = buildBrandOgCardProps({
      brand: {
        ...brand,
        slug: "test-stripe",
        name: "Test Stripe",
        description: "Host-led popups in London.",
      },
      events: [nextRow, row],
    });
    expect(props.textFit).toEqual(
      expect.objectContaining({
        primaryChipText: "2 events",
        secondaryChipText: "Summer Rooftop - Jun 12, 2026",
      }),
    );
  });

  test("renders brand page metadata without showing the brand username", () => {
    const html = renderBrandHtml({
      brand: { ...brand, slug: "test-stripe", name: "Test Stripe" },
      events: [row],
    });

    expect(html).toContain("<h1>Test Stripe</h1>");
    expect(html).toContain("<span class=\"pill\">1 event</span>");
    expect(html).not.toContain("@test-stripe");
  });

  test("renders brand-specific metadata for a real brand with zero events", () => {
    const html = renderBrandHtml({ brand, events: [] });

    expect(html).toContain("<title>Brand 3 on Mingla</title>");
    expect(html).toContain("<h1>Brand 3</h1>");
    expect(html).toContain("<span class=\"pill\">0 events</span>");
    expect(html).toContain("No upcoming events yet");
    expect(html).toContain(
      'property="og:url" content="https://business.usemingla.com/b/brand-3"',
    );
    expect(html).not.toContain("Brand not found");
  });

  test("builds brand OG card props from empty-brand identity instead of generic fallback", () => {
    expect(buildBrandOgCardProps({ brand, events: [] })).toEqual(
      expect.objectContaining({
        cardKind: "brand",
        title: "Brand 3",
        subtitle: "Small-room popups and careful hosting.",
        kicker: "Mingla Business",
        eventCountLabel: "0 events",
        nextEventLabel: "",
        coverUrl: null,
      }),
    );
  });

  test("long event title uses compact bounded text fit for OG card", () => {
    const longRow = {
      ...row,
      title: "Runtime Share Test FreeTA throwaway free-ticket QA",
      location_text: "The venue - The place with a very long neighbourhood label",
    };
    const props = buildEventOgCardProps(longRow);
    const textFit = props.textFit as Record<string, unknown>;

    expect(textFit).toEqual(
      expect.objectContaining({
        titleFontSize: 58,
        titleMaxLines: 2,
        titleMaxHeight: 120,
        secondaryChipMaxChars: 54,
      }),
    );
    expect(textFit.titleText).toBe("Runtime Share Test FreeTA throwaway free-ticket QA");
    expect(String(textFit.secondaryChipText)).toContain("...");
    expect(Number(textFit.titleMaxHeight)).toBeLessThanOrEqual(154);
    expect(Number(textFit.contentMaxHeight)).toBeLessThanOrEqual(492);
  });

  test("very long brand name and next-event cue use compact bounded text fit", () => {
    const longTitle = "Runtime Share Test FreeTA throwaway free-ticket QA";
    const props = buildBrandOgCardProps({
      brand: {
        ...brand,
        slug: "long-brand",
        name: "Runtime Share Test FreeTA throwaway free-ticket QA Collective",
      },
      events: [{ ...row, title: longTitle }],
    });
    const textFit = props.textFit as Record<string, unknown>;

    expect(textFit).toEqual(
      expect.objectContaining({
        titleFontSize: 54,
        titleMaxLines: 3,
        titleMaxHeight: 154,
        secondaryChipMaxChars: 42,
      }),
    );
    expect(String(textFit.titleText)).toContain("Runtime Share Test");
    expect(String(textFit.secondaryChipText)).toContain("...");
    expect(Number(textFit.titleMaxHeight)).toBeLessThanOrEqual(154);
    expect(Number(textFit.contentMaxHeight)).toBeLessThanOrEqual(492);
  });

  test("text fit strips oversized slots without changing canonical domain data", () => {
    const fit = buildOgTextFit({
      cardKind: "event",
      title: "Runtime Share Test FreeTA throwaway free-ticket QA and then an even longer suffix",
      subtitle: "A long but still honest event description that should never collide with the Mingla Business mark.",
      primaryChip: "Nov 9, 2026",
      secondaryChip: "The venue - The place with a very long neighbourhood label",
      accentLabel: "Leggo This",
    });

    expect(String(fit.titleText).length).toBeLessThanOrEqual(66);
    expect(String(fit.secondaryChipText).length).toBeLessThanOrEqual(42);
    expect(fit.primaryChipText).toBe("Nov 9, 2026");
  });

});
