/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => { unmount: () => void };
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};
const {
  renderContentShareHtml,
  renderSharedCardHtml,
} = require("../../server/socialPreview") as {
  renderContentShareHtml: (contentShare: Record<string, unknown>) => string;
  renderSharedCardHtml: (
    snapshot: Record<string, unknown>,
    appUrl: string,
  ) => string;
};
const {
  createContentShareAnalyticsHandler,
} = require("../../api/content-share-analytics") as {
  createContentShareAnalyticsHandler: (
    send?: (url: string, init: { body: string }) => Promise<unknown>,
  ) => (
    req: Record<string, unknown>,
    res: Record<string, unknown>,
  ) => Promise<unknown>;
};

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

const captureWebMock = jest.fn();
const brandRefetchMock = jest.fn();
let capturedBrandProps: Record<string, unknown> | null = null;
const brandQuery: Record<string, unknown> = {
  data: {
    brand: { id: "brand_3859", slug: "lantern-room" },
    events: [],
    pastEvents: [],
    trips: [],
    pastTrips: [],
    experiences: [],
    upcoming: [],
    upcomingHasMore: false,
    menu: [],
    venue: null,
  },
  isLoading: false,
  isFetching: false,
  isError: false,
  isStale: false,
  refetch: brandRefetchMock,
};

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ brandSlug: "lantern-room" }),
}));
jest.mock("../../src/analytics/webAnalytics", () => ({
  captureAdClickIds: jest.fn(),
  captureWeb: (...args: unknown[]) => captureWebMock(...args),
  fireAdPageView: jest.fn(),
  fireAdViewContent: jest.fn(),
}));
jest.mock("../../src/hooks/usePublicEvents", () => ({
  usePublicBrandBySlug: () => brandQuery,
  usePublicBrandVenues: () => ({
    data: [{ id: "venue_3859" }],
    isLoading: false,
    isFetching: true,
    isError: false,
    refetch: jest.fn(),
  }),
}));
jest.mock("../../src/hooks/usePublicBrandSections", () => ({
  usePublicBrandHappeningNow: () => ({ data: [] }),
  usePublicBrandPast: () => ({
    rows: [],
    hasMore: false,
    loadState: "ready",
    loadMore: jest.fn(),
  }),
}));
jest.mock("../../src/components/brand/PublicBrandPage", () => ({
  PublicBrandPage: (props: Record<string, unknown>) => {
    capturedBrandProps = props;
    return null;
  },
}));
jest.mock("../../src/components/brand/PublicBrandNotFound", () => ({
  PublicBrandNotFound: () => null,
}));

import PublicBrandRoute from "../b/[brandSlug]";
import {
  captureBuyerWebPublicPageViewed,
  createBuyerWebPublicContract,
  resolveBuyerWebPublicLifecycle,
  type BuyerWebPublicTarget,
} from "../../src/analytics/publicParityWebAdapter";

const businessRoot = resolve(__dirname, "../..");
const repoRoot = resolve(businessRoot, "..");
const readBusiness = (relative: string): string =>
  readFileSync(resolve(businessRoot, relative), "utf8");
const readRepo = (relative: string): string =>
  readFileSync(resolve(repoRoot, relative), "utf8");

const mountBrand = (): { unmount: () => void } => {
  let tree: { unmount: () => void } | null = null;
  TestRenderer.act(() => {
    tree = TestRenderer.create(<PublicBrandRoute />);
  });
  return { unmount: () => TestRenderer.act(() => tree?.unmount()) };
};

const runCommonSharePageScript = (
  html: string,
  consent: string | null,
): { url: string; body: Record<string, unknown> }[] => {
  const script = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g))
    .map((match) => match[1])
    .find((source) => source.includes('"event":"public_page_viewed"'));
  if (script === undefined) return [];
  const posted: { url: string; body: Record<string, unknown> }[] = [];
  new Function("localStorage", "navigator", script)(
    { getItem: () => consent },
    {
      sendBeacon: (url: string, body: string) => {
        posted.push({ url, body: JSON.parse(body) as Record<string, unknown> });
        return true;
      },
    },
  );
  return posted;
};

const analyticsResponse = (): Record<string, unknown> => ({
  statusCode: 0,
  setHeader: jest.fn(),
  end: jest.fn(),
});

beforeEach(() => {
  capturedBrandProps = null;
  captureWebMock.mockClear();
  brandRefetchMock.mockReset();
  brandQuery.isLoading = false;
  brandQuery.isFetching = false;
  brandQuery.isError = false;
  brandQuery.isStale = false;
});

describe("issue #3859 — buyer web public-host parity", () => {
  test("the real brand route keeps retained content mounted and revalidates Follow", async () => {
    brandQuery.isFetching = true;
    brandQuery.isStale = true;
    brandRefetchMock.mockResolvedValue({
      isError: false,
      data: brandQuery.data,
    });
    const page = mountBrand();
    expect(capturedBrandProps).not.toBeNull();
    expect(capturedBrandProps?.venuesLoadState).toBe("ready");

    const revalidate = capturedBrandProps?.revalidateBeforeFollow as
      | (() => Promise<boolean>)
      | undefined;
    await expect(revalidate?.()).resolves.toBe(true);
    expect(brandRefetchMock).toHaveBeenCalledTimes(1);
    page.unmount();

    brandQuery.isFetching = false;
    brandQuery.isError = true;
    capturedBrandProps = null;
    const retainedErrorPage = mountBrand();
    expect(capturedBrandProps).not.toBeNull();
    retainedErrorPage.unmount();
  });

  test("brand revalidation refuses a changed canonical identity", async () => {
    brandQuery.isStale = true;
    brandRefetchMock.mockResolvedValue({
      isError: false,
      data: {
        ...(brandQuery.data as Record<string, unknown>),
        brand: { id: "another_brand", slug: "another-brand" },
      },
    });
    const page = mountBrand();
    const revalidate = capturedBrandProps?.revalidateBeforeFollow as
      | (() => Promise<boolean>)
      | undefined;
    await expect(revalidate?.()).resolves.toBe(false);
    page.unmount();
  });

  test("the lifecycle adapter treats retained refresh/error as usable stale truth", () => {
    expect(resolveBuyerWebPublicLifecycle({
      hasData: true,
      isLoading: false,
      isFetching: true,
      isError: false,
    })).toBe("stale");
    expect(resolveBuyerWebPublicLifecycle({
      hasData: true,
      isLoading: false,
      isFetching: false,
      isError: true,
    })).toBe("stale");
    expect(resolveBuyerWebPublicLifecycle({
      hasData: false,
      isLoading: false,
      isFetching: true,
      isError: false,
    })).toBe("loading");
    expect(resolveBuyerWebPublicLifecycle({
      hasData: false,
      isLoading: false,
      isFetching: false,
      isError: true,
    })).toBe("error");
  });

  test("all eight web families validate through the shared contract", async () => {
    const stayId = "a0b1c2d3-e4f5-6789-abcd-ef0123456789";
    const shareId = "0f1e2d3c-4b5a-6789-abcd-0123456789ab";
    const targets: BuyerWebPublicTarget[] = [
      { kind: "brand", entityId: "brand_01", brandSlug: "slow-burn" },
      { kind: "venue", entityId: "venue_01", brandSlug: "slow-burn", venueSlug: "lantern-room" },
      { kind: "event", entityKind: "rsvp", entityId: "event_01", brandSlug: "slow-burn", eventSlug: "guest-list" },
      { kind: "trip", entityId: "trip_01", brandSlug: "slow-burn", tripSlug: "weekend-away" },
      { kind: "experience", entityId: "experience_01", brandSlug: "slow-burn", experienceSlug: "chef-table" },
      { kind: "stay", entityId: stayId, groupId: stayId },
      { kind: "opaque-share", entityId: shareId, shareId, cardKind: "place" },
      { kind: "content-share", entityId: "Aa0Bb1Cc2Dd3Ee4F", code: "Aa0Bb1Cc2Dd3Ee4F", contentKind: "curated" },
    ];
    expect((await Promise.all(targets.map((target) =>
      createBuyerWebPublicContract({ target, state: "populated" })
    ))).map((contract) => contract?.identity.kind)).toEqual([
      "brand",
      "venue",
      "rsvp",
      "trip",
      "experience",
      "stay",
      "opaque-share",
      "content-share",
    ]);
    await expect(createBuyerWebPublicContract({
      target: { kind: "brand", entityId: "brand_01", brandSlug: "Unsafe Slug" },
      state: "populated",
    })).resolves.toBeNull();
  });

  test("common page analytics emits only the bounded contract context", async () => {
    await expect(captureBuyerWebPublicPageViewed({
      target: { kind: "trip", entityId: "trip_01", brandSlug: "slow-burn", tripSlug: "weekend-away" },
      state: "stale",
      authState: "anonymous",
    })).resolves.toBe(true);
    expect(captureWebMock).toHaveBeenCalledWith("public_page_viewed", {
      surface: "buyer-web",
      page_family: "trip",
      entity_id: "trip_01",
      entity_kind: "trip",
      route_kind: "trip",
      initial_state: "stale",
      auth_state: "anonymous",
    });
    expect(JSON.stringify(captureWebMock.mock.calls)).not.toMatch(
      /name|email|phone|filename|token|provider|https?:|raw_error/i,
    );
    captureWebMock.mockClear();
    await expect(captureBuyerWebPublicPageViewed({
      target: { kind: "trip", entityId: "trip_01", brandSlug: "unsafe/path", tripSlug: "weekend-away" },
      state: "populated",
    })).resolves.toBe(false);
    expect(captureWebMock).not.toHaveBeenCalled();
  });

  test("every changed route uses the adapter instead of blocking on isFetching", () => {
    const routes = [
      "app/b/[brandSlug]/index.tsx",
      "app/e/[brandSlug]/[eventSlug].tsx",
      "app/t/[brandSlug]/[tripSlug].tsx",
      "app/exp/[brandSlug]/[experienceSlug].tsx",
    ];
    for (const route of routes) {
      const source = readBusiness(route);
      expect(source).toContain("resolveBuyerWebPublicLifecycle({");
      expect(source).toContain("captureBuyerWebPublicPageViewed({");
      expect(source).not.toMatch(/if \([^\n]+\.isLoading \|\| [^\n]+\.isFetching\)/);
    }
  });

  test("working venue, stay, /p and /s contracts remain on their existing rails", () => {
    const venue = readBusiness("app/b/[brandSlug]/v/[venueSlug].tsx");
    const stay = readBusiness("app/stay/[groupId].tsx");
    const share = readBusiness("server/socialPreview.js");
    const opaque = readBusiness("api/shared-card.js");
    expect(venue).toContain("classifyPublicVenueRouteState({");
    expect(stay).toContain("loading={query.isLoading}");
    expect(stay).toContain("Linking.openURL(session.authorizationUrl)");
    expect(share).toContain("asText(destination.kind) !== factsKind");
    expect(share).toContain("asText(destination.webPath, \"\") !== path");
    expect(share).toContain("window.location.replace");
    expect(opaque).toContain("hasValidSharedCardProxySecret(req)");
    expect(readRepo("scripts/issue-2004/share-click-canonical-destination.implementor.happy.test.mjs"))
      .toContain("/s/");
  });

  // #2331 I-PRIVACY-ON-UNLESS-VISITOR-TURNED-OFF: both hosts carry the privacy
  // bar and send the bounded view unless the visitor turned analytics off.
  test("the real /p and /s hosts emit one bounded common view unless analytics is turned off", async () => {
    const shareId = "0f1e2d3c-4b5a-6789-abcd-0123456789ab";
    const code = "Aa0Bb1Cc2Dd3Ee4F";
    const opaqueHtml = renderSharedCardHtml({
      share_id: shareId,
      kind: "place",
      title: "Lantern Room",
      cover_url: null,
      metadata: {},
    }, `https://usemingla.com/p/${shareId}`);
    const contentHtml = renderContentShareHtml({
      shortCode: code,
      version: 1,
      facts: { schemaVersion: 1, kind: "curated", title: "Night plan" },
      destination: null,
      publicDetails: null,
      media: null,
    });
    expect(contentHtml).toContain("record('share_public_page_viewed')");

    const expected = [
      { family: "opaque-share", entityId: shareId, html: opaqueHtml },
      { family: "content-share", entityId: code, html: contentHtml },
    ];
    for (const fixture of expected) {
      expect(fixture.html).toContain('data-testid="privacy-bar"');
      expect(fixture.html).toContain("data-mingla-privacy-choices");
      for (const off of [
        JSON.stringify({ choice: "denied" }),
        JSON.stringify({ analytics: false, ads: true, ts: 1 }),
      ]) {
        expect(runCommonSharePageScript(fixture.html, off)).toEqual([]);
      }
      for (const on of [null, "malformed", JSON.stringify({ analytics: true, ads: false, ts: 1 })]) {
        expect(runCommonSharePageScript(fixture.html, on)).toHaveLength(1);
      }
      const posted = runCommonSharePageScript(
        fixture.html,
        JSON.stringify({ choice: "granted" }),
      );
      expect(posted).toEqual([{
        url: "/api/content-share-analytics",
        body: {
          event: "public_page_viewed",
          surface: "buyer-web",
          page_family: fixture.family,
          entity_id: fixture.entityId,
          entity_kind: fixture.family,
          route_kind: fixture.family,
          initial_state: "populated",
          auth_state: "unknown",
        },
      }]);
      expect(JSON.stringify(posted)).not.toMatch(
        /name|email|phone|filename|token|provider|https?:|raw_error/i,
      );
    }

    const previousKey = process.env.EXPO_PUBLIC_POSTHOG_KEY;
    process.env.EXPO_PUBLIC_POSTHOG_KEY = "phc_issue3859";
    try {
      const forwarded: Record<string, unknown>[] = [];
      const handler = createContentShareAnalyticsHandler(async (_url, init) => {
        forwarded.push(JSON.parse(init.body) as Record<string, unknown>);
        return {};
      });
      for (const fixture of expected) {
        const [request] = runCommonSharePageScript(
          fixture.html,
          JSON.stringify({ value: "granted" }),
        );
        const response = analyticsResponse();
        await handler({
          method: "POST",
          headers: { origin: "https://usemingla.com" },
          body: request.body,
        }, response);
        expect(response.statusCode).toBe(204);

        const attacks = [
          { name: "buyer" },
          { email: "no@example.com" },
          { phone: "+15555550123" },
          { free_text: "unbounded" },
          { intake_answers: ["private"] },
          { filename: "private.pdf" },
          { token: "secret" },
          { provider_reference: "provider-secret" },
          { raw_error: "private details" },
          { entity_id: "https://attacker.example/secret" },
          { entity_id: "a".repeat(129) },
        ];
        for (const attack of attacks) {
          const refused = analyticsResponse();
          await handler({
            method: "POST",
            headers: { origin: "https://usemingla.com" },
            body: { ...request.body, ...attack },
          }, refused);
          expect(refused.statusCode).toBe(400);
        }
      }
      expect(forwarded).toHaveLength(2);
      expect(forwarded.map((request) => request.event)).toEqual([
        "public_page_viewed",
        "public_page_viewed",
      ]);
      expect(JSON.stringify(forwarded)).not.toMatch(
        /name|email|phone|filename|token|provider|https?:|raw_error/i,
      );
    } finally {
      if (previousKey === undefined) delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
      else process.env.EXPO_PUBLIC_POSTHOG_KEY = previousKey;
    }
  });
});
