import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  captureOfferingCheckoutStart,
  captureOfferingCta,
  captureOfferingPageView,
} from "../offeringEngagementCapture.web";

const invoke = jest.fn();

jest.mock("../supabase", () => ({
  supabase: { functions: { invoke } },
}));

const BRAND_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const scope = {
  brandId: BRAND_ID,
  entityType: "event" as const,
  entityId: EVENT_ID,
};

describe("#4037 buyer-web aggregate capture", () => {
  const localStorageGet = jest.fn();
  const cookieGet = jest.fn(() => "");

  beforeEach(() => {
    invoke.mockReset().mockResolvedValue({ error: null });
    localStorageGet.mockReset();
    cookieGet.mockClear();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          href: "https://usemingla.com/e/acme/show?utm_source=newsletter",
        },
        localStorage: { getItem: localStorageGet },
      },
    });
    const testDocument = { referrer: "https://acme.example/events" };
    Object.defineProperty(testDocument, "cookie", {
      configurable: true,
      get: cookieGet,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: testDocument,
    });
  });

  it("emits page, CTA and checkout events without reading consent or browser storage", async () => {
    await captureOfferingPageView(scope);
    await captureOfferingCta(scope, "buy");
    await captureOfferingCheckoutStart(scope, SESSION_ID);

    expect(invoke).toHaveBeenCalledTimes(3);
    expect(invoke.mock.calls.map((call) => call[1].body.eventType)).toEqual([
      "page_view",
      "cta_click",
      "checkout_start",
    ]);
    expect(invoke.mock.calls[1][1].body).toMatchObject({
      brandId: BRAND_ID,
      entityType: "event",
      entityId: EVENT_ID,
      ctaType: "buy",
      surface: "buyer_web",
    });
    expect(invoke.mock.calls[2][1].body.checkoutSessionId).toBe(SESSION_ID);
    expect(localStorageGet).not.toHaveBeenCalled();
    expect(cookieGet).not.toHaveBeenCalled();
  });

  it("keeps the aggregate emitter isolated from ad, consent and persistence code", () => {
    const source = readFileSync(
      join(process.cwd(), "src/services/offeringEngagementCapture.web.ts"),
      "utf8",
    );
    for (const forbidden of [
      "webAnalytics",
      "postHog",
      "localStorage",
      "sessionStorage",
      "cookie",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("wires every public page and the unambiguous destination CTAs", () => {
    const files = {
      event: "src/components/event/PublicEventPage.tsx",
      brand: "src/components/brand/PublicBrandPage.tsx",
      trip: "app/t/[brandSlug]/[tripSlug].tsx",
      experience: "app/exp/[brandSlug]/[experienceSlug].tsx",
      venue: "app/b/[brandSlug]/v/[venueSlug].tsx",
    } as const;
    const sources = Object.fromEntries(
      Object.entries(files).map(([name, path]) => [
        name,
        readFileSync(join(process.cwd(), path), "utf8"),
      ]),
    );
    for (const source of Object.values(sources)) {
      expect(source).toContain("captureOfferingPageView(engagementScope)");
    }
    expect(sources.event).toContain(
      'captureOfferingCta(engagementScope, "buy")',
    );
    expect(sources.event).toContain(
      'captureOfferingCta(engagementScope, "rsvp")',
    );
    expect(sources.event).toContain(
      'captureOfferingCta(engagementScope, "directions")',
    );
    expect(sources.brand).toContain(
      'captureOfferingCta(engagementScope, "website")',
    );
    expect(sources.brand).toContain(
      'captureOfferingCta(engagementScope, "call")',
    );
    expect(sources.trip).toContain(
      'captureOfferingCta(engagementScope, "book")',
    );
    expect(sources.experience).toContain(
      'captureOfferingCta(engagementScope, "book")',
    );
    expect(sources.venue).toContain(
      'captureOfferingCta(engagementScope, "book")',
    );
    expect(sources.venue).toContain(
      'captureOfferingCta(engagementScope, "directions")',
    );
  });
});
