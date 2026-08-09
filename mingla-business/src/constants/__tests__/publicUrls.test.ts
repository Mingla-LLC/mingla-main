import { describe, expect, jest, test } from "@jest/globals";

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL: "https://business.usemingla.com",
      },
    },
  },
}));

import {
  BUSINESS_PUBLIC_ORIGIN,
  PublicUrlError,
  brandOgImageUrl,
  brandPublicPath,
  brandPublicUrl,
  checkoutPublicPath,
  checkoutPublicUrl,
  eventOgImageUrl,
  eventPublicPath,
  eventPublicUrl,
  experiencePublicPath,
  experiencePublicUrl,
  tripPublicUrl,
  venueOgImageUrl,
} from "../publicUrls";

describe("public business URL builders", () => {
  test("builds canonical public event, brand, and checkout URLs", () => {
    expect(BUSINESS_PUBLIC_ORIGIN).toBe("https://business.usemingla.com");
    expect(
      eventPublicPath({ brandSlug: "my brand", eventSlug: "show one" }),
    ).toBe("/e/my%20brand/show%20one");
    expect(
      eventPublicUrl({ brandSlug: "my-brand", eventSlug: "show-one" }),
    ).toBe("https://business.usemingla.com/e/my-brand/show-one");
    expect(brandPublicPath("acme popups")).toBe("/b/acme%20popups");
    expect(brandPublicUrl("acme")).toBe(
      "https://business.usemingla.com/b/acme",
    );
    expect(checkoutPublicPath("evt_123")).toBe("/checkout/evt_123");
    expect(checkoutPublicUrl("evt_123")).toBe(
      "https://business.usemingla.com/checkout/evt_123",
    );
  });

  test("rejects empty path segments instead of emitting guessed links", () => {
    expect(() =>
      eventPublicUrl({ brandSlug: "", eventSlug: "show" }),
    ).toThrow(PublicUrlError);
    expect(() => brandPublicUrl("   ")).toThrow(PublicUrlError);
    expect(() => checkoutPublicUrl("")).toThrow(PublicUrlError);
  });

  // ORCH-1114 — trip + experience public share-link URL builders.
  test("T-1/T-2: builds canonical public trip and experience URLs", () => {
    expect(tripPublicUrl({ brandSlug: "acme", tripSlug: "bali" })).toBe(
      "https://business.usemingla.com/t/acme/bali",
    );
    expect(
      experiencePublicUrl({ brandSlug: "acme", experienceSlug: "sunset-sail" }),
    ).toBe("https://business.usemingla.com/exp/acme/sunset-sail");
  });

  test("T-3: experience helper encodes path segments", () => {
    expect(
      experiencePublicPath({ brandSlug: "my brand", experienceSlug: "sail one" }),
    ).toBe("/exp/my%20brand/sail%20one");
  });

  test("T-4/T-5: experience helper rejects empty/whitespace segments (fails-on-revert)", () => {
    expect(() =>
      experiencePublicUrl({ brandSlug: "", experienceSlug: "x" }),
    ).toThrow(PublicUrlError);
    expect(() =>
      experiencePublicUrl({ brandSlug: "a", experienceSlug: "  " }),
    ).toThrow(PublicUrlError);
  });

  test("uses canonical rendered media when source imagery exists", () => {
    // [TEST-MOD-APPROVED #1615] Direction C makes the measured S5 renderer the
    // canonical preview; the old assertion expected the raw uploaded cover and
    // therefore bypassed the plate, title, and contrast contract entirely.
    expect(
      eventOgImageUrl({
        eventId: "event-1",
        coverMediaUrl: "https://cdn.usemingla.com/cover.png",
      }),
    ).toBe("https://business.usemingla.com/og/event/event-1.png");
    expect(eventOgImageUrl({ eventId: "event-1" })).toBe("");
    expect(brandOgImageUrl({ brandSlug: "acme" })).toBe("");
    expect(
      venueOgImageUrl({
        brandSlug: "acme",
        venueSlug: "rooftop",
        coverMediaUrl: "https://cdn.usemingla.com/venue.jpg",
      }),
    ).toBe("https://business.usemingla.com/og/venue/acme/rooftop.png");
  });
});
