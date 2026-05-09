import { describe, expect, test } from "@jest/globals";

declare const require: <T = unknown>(path: string) => T;

const {
  brandImageUrl,
  brandPublicUrl,
  buildBrandOgCardProps,
  buildEventOgCardProps,
  eventImageUrl,
  eventPublicUrl,
  renderBrandHtml,
  renderEventHtml,
} = require("../socialPreview") as {
  brandImageUrl: (row: Record<string, unknown>) => string;
  brandPublicUrl: (row: Record<string, unknown>) => string;
  buildBrandOgCardProps: (rows: Record<string, unknown>[]) => Record<string, string | null>;
  buildEventOgCardProps: (row: Record<string, unknown> | null) => Record<string, string | null>;
  eventImageUrl: (row: Record<string, unknown>) => string;
  eventPublicUrl: (row: Record<string, unknown>) => string;
  renderBrandHtml: (rows: Record<string, unknown>[]) => string;
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

  test("renders brand metadata with the Mingla Business OG fallback", () => {
    const html = renderBrandHtml([row]);

    expect(brandPublicUrl(row)).toBe("https://business.usemingla.com/b/test-stripe");
    expect(brandImageUrl(row)).toBe(
      "https://business.usemingla.com/og/brand/test-stripe.png",
    );
    expect(html).toContain("<title>Test Stripe on Mingla</title>");
    expect(html).toContain('property="og:type" content="profile"');
    expect(html).toContain('property="og:image" content="https://business.usemingla.com/og/brand/test-stripe.png"');
    expect(html).not.toContain("business.mingla.com");
    expect(html).not.toContain("https://mingla.com");
    expect(html).not.toContain("localhost");
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

    expect(buildBrandOgCardProps([nextRow, row])).toEqual(
      expect.objectContaining({
        cardKind: "brand",
        title: "Test Stripe",
        kicker: "Mingla Business",
        eventCountLabel: "2 events",
        nextEventLabel: "Summer Rooftop - Jun 12, 2026",
        coverUrl: "https://cdn.example.com/cover.png",
      }),
    );
  });

  test("renders brand page metadata without showing the brand username", () => {
    const html = renderBrandHtml([row]);

    expect(html).toContain("<h1>Test Stripe</h1>");
    expect(html).toContain("<span class=\"pill\">1 event</span>");
    expect(html).not.toContain("@test-stripe");
  });
});
