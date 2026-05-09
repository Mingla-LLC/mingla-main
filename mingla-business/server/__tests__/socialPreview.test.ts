import { describe, expect, test } from "@jest/globals";

declare const require: <T = unknown>(path: string) => T;

const {
  brandImageUrl,
  brandPublicUrl,
  eventImageUrl,
  eventPublicUrl,
  renderBrandHtml,
  renderEventHtml,
} = require("../socialPreview") as {
  brandImageUrl: (row: Record<string, unknown>) => string;
  brandPublicUrl: (row: Record<string, unknown>) => string;
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
});
