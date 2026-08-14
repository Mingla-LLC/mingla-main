import { afterEach, describe, expect, jest, test } from "@jest/globals";

/**
 * ORCH-1284 — tax-registrations CTA wrong-domain — TESTER adversarial
 * regression proof (different angle than the implementor's happy-path builder
 * test `useBrandStripeTaxAccountSession.orch1284.test.ts`).
 *
 * The implementor's test exercises ONLY the pure `taxToolsUrl` builder under the
 * clean canonical env (business URL set, no bogus vars present). It never proves
 * (a) that the SHIPPED hook wiring actually routes the CTA through that builder
 * to `WebBrowser.openAuthSessionAsync`, (b) that the two DEAD env vars are truly
 * ignored when they ARE set to garbage (only that they're absent), or (c) that a
 * trailing slash on the business URL normalizes to a single slash.
 *
 * This test attacks all three:
 *
 *   A — WIRING/RUNTIME (preferred): drive the REAL hook's `onSuccess` closure
 *       (captured off the actual `useMutation(options)` call the shipped hook
 *       makes) and assert `WebBrowser.openAuthSessionAsync` is invoked with a
 *       `host.usemingla.com/connect-tax-registrations?...` URL and NEVER the
 *       marketing apex. Also asserts `mutationFn` calls the service. Validates
 *       I-PROPOSED-EMBEDDED-TAX-UI (CTA → openAuthSessionAsync on the Mingla-
 *       hosted URL). The implementor's pure-builder test cannot reach this path.
 *
 *   B — BELT-AND-BRACES ENV: with the OLD dead vars
 *       (EXPO_PUBLIC_MINGLA_PUBLIC_WEB_BASE_URL / EXPO_PUBLIC_WEB_BASE_URL)
 *       explicitly set to garbage/marketing values, the builder STILL emits the
 *       business subdomain — proving the dead vars are truly ignored, not merely
 *       unset. On the pre-fix code these vars WIN, so this fails-on-revert.
 *
 *   C — TRAILING-SLASH NORMALIZATION: a business URL value carrying a trailing
 *       slash yields exactly ONE slash before `connect-tax-registrations`
 *       (never `//`), resolved through the real MINGLA_BUSINESS_WEB_URL module.
 *
 * FAILS-ON-REVERT: restoring the pre-fix base resolution
 * (`process.env.EXPO_PUBLIC_MINGLA_PUBLIC_WEB_BASE_URL ?? EXPO_PUBLIC_WEB_BASE_URL
 * ?? "https://usemingla.com"`) makes A's opened host + B's host become the
 * marketing apex (and B additionally emit the garbage host), and C's origin
 * become the apex — all three go RED.
 */

// platformUrl.ts throws at module load unless the business web URL is set; feed
// the canonical production value via a MUTABLE expo-constants `extra` getter so
// the trailing-slash case (C) can re-resolve the constant under jest.isolateModules.
const constantsState = { businessWebUrl: "https://host.usemingla.com" };
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        get EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL(): string {
          return constantsState.businessWebUrl;
        },
      },
    },
  },
}));

// The hook pulls in expo-web-browser + the Supabase-backed service at module
// load; both are heavy/native under node. Mock them so the import is hermetic
// and so we can assert on the opened URL / service call.
jest.mock("expo-web-browser", () => ({
  __esModule: true,
  openAuthSessionAsync: jest.fn(),
}));

jest.mock("../../services/brandStripeTaxAccountSessionService", () => ({
  __esModule: true,
  fetchBrandStripeTaxAccountSession: jest.fn(),
}));

// Capture the exact options object the shipped hook passes to useMutation, so we
// can invoke the REAL onSuccess / mutationFn closures outside of React.
jest.mock("@tanstack/react-query", () => ({
  __esModule: true,
  useMutation: jest.fn((options: unknown) => ({
    mutate: jest.fn(),
    mutateAsync: jest.fn(),
    isPending: false,
    __options: options,
  })),
}));

import { useMutation } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";

import {
  taxToolsUrl,
  useBrandStripeTaxAccountSession,
} from "../useBrandStripeTaxAccountSession";
import { fetchBrandStripeTaxAccountSession } from "../../services/brandStripeTaxAccountSessionService";

type MutationOptions = {
  mutationFn: (brandId: string) => Promise<unknown>;
  onSuccess: (result: {
    clientSecret: string;
    expiresAt: number | null;
    brandStripeAccountId: string;
  }) => Promise<void> | void;
};

const OLD_ENV = { ...process.env };

afterEach(() => {
  // Restore process.env so B's garbage vars never leak into A/C or other suites.
  process.env = { ...OLD_ENV };
  (WebBrowser.openAuthSessionAsync as jest.Mock).mockClear();
  (fetchBrandStripeTaxAccountSession as jest.Mock).mockClear();
  (useMutation as jest.Mock).mockClear();
});

describe("ORCH-1284 adversarial — tax CTA wiring, dead-env immunity, slash normalization", () => {
  // ---- A: WIRING / RUNTIME ----------------------------------------------------
  test("A — the shipped hook's onSuccess opens host.usemingla.com (never the marketing apex), and mutationFn calls the service", async () => {
    useBrandStripeTaxAccountSession();

    // The hook must have registered exactly one mutation with mutationFn + onSuccess.
    expect((useMutation as jest.Mock)).toHaveBeenCalledTimes(1);
    const options = (useMutation as jest.Mock).mock
      .calls[0][0] as MutationOptions;
    expect(typeof options.mutationFn).toBe("function");
    expect(typeof options.onSuccess).toBe("function");

    // mutationFn wiring: delegates to the service with the brandId.
    (fetchBrandStripeTaxAccountSession as jest.Mock).mockResolvedValue({
      clientSecret: "cs_live_wiring",
      expiresAt: null,
      brandStripeAccountId: "acct_wiring",
    } as never);
    await options.mutationFn("brand_wiring_123");
    expect(fetchBrandStripeTaxAccountSession).toHaveBeenCalledWith(
      "brand_wiring_123",
    );

    // onSuccess wiring: opens the Mingla-hosted URL via openAuthSessionAsync.
    const session = {
      clientSecret: "cs_live_wiring/xyz secret",
      expiresAt: null,
      brandStripeAccountId: "acct_wiring",
    };
    await options.onSuccess(session);

    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledTimes(1);
    const openedUrl = (WebBrowser.openAuthSessionAsync as jest.Mock).mock
      .calls[0][0] as string;
    const parsed = new URL(openedUrl);
    expect(parsed.host).toBe("host.usemingla.com");
    expect(parsed.pathname).toBe("/connect-tax-registrations");
    // The marketing 404 form is `://usemingla.com/connect-...`; must never appear.
    expect(openedUrl).not.toContain("://usemingla.com/connect-tax-registrations");
    // Params survive the round trip through the real builder.
    expect(parsed.searchParams.get("clientSecret")).toBe(
      "cs_live_wiring/xyz secret",
    );
    expect(parsed.searchParams.get("brandStripeAccountId")).toBe("acct_wiring");
  });

  // ---- B: DEAD ENV VARS ARE IGNORED ------------------------------------------
  test("B — dead env vars set to garbage/marketing values are ignored; builder still emits the business subdomain", () => {
    // These are the exact vars the PRE-FIX code read first. Set them loud.
    process.env.EXPO_PUBLIC_MINGLA_PUBLIC_WEB_BASE_URL =
      "https://garbage-marketing.example/evil";
    process.env.EXPO_PUBLIC_WEB_BASE_URL = "https://usemingla.com";

    const url = taxToolsUrl({
      clientSecret: "cs_b",
      expiresAt: null,
      brandStripeAccountId: "acct_b",
    });

    const parsed = new URL(url);
    expect(parsed.host).toBe("host.usemingla.com");
    // Neither dead var may leak into the output.
    expect(url).not.toContain("garbage-marketing.example");
    expect(url).not.toContain("://usemingla.com/connect-tax-registrations");
  });

  // ---- C: TRAILING-SLASH NORMALIZATION ---------------------------------------
  test("C — a business URL with a trailing slash normalizes to exactly one slash before the path", () => {
    const prev = constantsState.businessWebUrl;
    constantsState.businessWebUrl = "https://host.usemingla.com/";
    try {
      jest.isolateModules(() => {
        // Re-resolve MINGLA_BUSINESS_WEB_URL + the builder under the slashed value.
        const {
          taxToolsUrl: freshTaxToolsUrl,
        } = require("../useBrandStripeTaxAccountSession") as {
          taxToolsUrl: typeof taxToolsUrl;
        };
        const url = freshTaxToolsUrl({
          clientSecret: "cs_c",
          expiresAt: null,
          brandStripeAccountId: "acct_c",
        });
        expect(url).toContain(
          "https://host.usemingla.com/connect-tax-registrations",
        );
        // The bug we guard against: a double slash from an un-normalized base.
        expect(url).not.toContain(
          "host.usemingla.com//connect-tax-registrations",
        );
        expect(new URL(url).pathname).toBe("/connect-tax-registrations");
      });
    } finally {
      constantsState.businessWebUrl = prev;
    }
  });
});
