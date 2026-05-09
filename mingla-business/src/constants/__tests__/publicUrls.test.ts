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

  test("uses public absolute media when present and canonical fallbacks otherwise", () => {
    expect(
      eventOgImageUrl({
        eventId: "event-1",
        coverMediaUrl: "https://cdn.usemingla.com/cover.png",
      }),
    ).toBe("https://cdn.usemingla.com/cover.png");
    expect(eventOgImageUrl({ eventId: "event-1" })).toBe(
      "https://business.usemingla.com/og/event/event-1.png",
    );
    expect(brandOgImageUrl({ brandSlug: "acme" })).toBe(
      "https://business.usemingla.com/og/brand/acme.png",
    );
  });
});
