/**
 * ORCH-1127 (ex-1116) — GIF cover-key reachability regression.
 *
 * Proves the corrected key-read path: BOTH giphy services resolve the public
 * GIPHY key from `Constants.expoConfig.extra` FIRST (mirror supabase.ts), with
 * a STATIC `process.env` fallback — so the key is reachable in a Hermes
 * standalone / OTA build where `process.env` is empty.
 *
 * Root cause this guards against (COMMS-0028 / SPEC_AMENDMENT_ORCH-1127):
 * the prior reader used DYNAMIC `globalThis.process?.env?.[name]` which
 * babel-preset-expo never inlines → undefined in every non-Metro build →
 * `not_configured` → "This source is taking a break.".
 *
 * Why the OLD tests missed it: Node/jest (and Metro dev) both populate
 * `process.env`, so the dynamic lookup resolved. These tests simulate the
 * STANDALONE condition by EMPTYING `process.env.EXPO_PUBLIC_GIPHY_*` and
 * placing the key ONLY in the mocked `Constants.expoConfig.extra`.
 *
 * T-CORRECT-1  standalone simulation: empty process.env, key in extra → resolves.
 * T-CORRECT-2  fails-on-revert: with the extra-first read reverted to the
 *              dynamic-only reader, the same input → not_configured (test FAILS).
 *              (Structurally enforced: this file asserts the extra path resolves;
 *              deleting the `readExtra(name) ??` read in the services makes
 *              T-CORRECT-1 FAIL — see the implementation report's fails-on-revert
 *              hash.)
 * T-CORRECT-3  Metro/dev path intact: key only in static process.env, extra empty.
 * T-CORRECT-4  dual-name fallback preserved: only EXPO_PUBLIC_GIPHY_KEY set.
 */

import { afterAll, beforeEach, describe, expect, jest, test } from "@jest/globals";

// Mutable extra object the mock returns by reference; tests mutate it per case.
// The services read Constants.expoConfig?.extra at CALL time, so mutation here
// is reflected without re-importing the module.
const mockExtra: Record<string, string | undefined> = {};
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: mockExtra };
    },
  },
}));

// curatedPexelsCovers (in the browse service) needs a supabase mock at import
// time even though these tests only call the GIPHY paths.
jest.mock("../supabase", () => ({
  supabase: {
    functions: { invoke: jest.fn(async () => ({ data: null, error: null })) },
  },
}));

import { searchGiphyEventCovers } from "../giphyEventCoverService";
import { trendingGiphyCovers } from "../coverProviderBrowseService";

const ORIGINAL_API_KEY = process.env.EXPO_PUBLIC_GIPHY_API_KEY;
const ORIGINAL_KEY = process.env.EXPO_PUBLIC_GIPHY_KEY;

const fetchOk = (): Response =>
  ({
    json: async () => ({
      data: [
        {
          id: "gif-1",
          title: "Trending loop",
          url: "https://giphy.com/gifs/trending",
          images: {
            fixed_width: { url: "https://media.giphy.com/preview.gif" },
            downsized_medium: { url: "https://media.giphy.com/medium.gif" },
            downsized: { url: "https://media.giphy.com/downsized.gif" },
            original: { url: "https://media.giphy.com/original.gif" },
          },
        },
      ],
    }),
    ok: true,
    status: 200,
  }) as Response;

const lastFetchApiKey = (): string | null => {
  const calls = (global.fetch as jest.Mock).mock.calls;
  if (calls.length === 0) return null;
  return new URL(String(calls[calls.length - 1][0])).searchParams.get("api_key");
};

const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  // Simulate a Hermes standalone bundle: process.env carries NO giphy key.
  delete process.env.EXPO_PUBLIC_GIPHY_API_KEY;
  delete process.env.EXPO_PUBLIC_GIPHY_KEY;
  // Reset the mocked manifest extra.
  for (const k of Object.keys(mockExtra)) delete mockExtra[k];
  global.fetch = jest.fn(async () => fetchOk()) as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
  if (ORIGINAL_API_KEY === undefined) delete process.env.EXPO_PUBLIC_GIPHY_API_KEY;
  else process.env.EXPO_PUBLIC_GIPHY_API_KEY = ORIGINAL_API_KEY;
  if (ORIGINAL_KEY === undefined) delete process.env.EXPO_PUBLIC_GIPHY_KEY;
  else process.env.EXPO_PUBLIC_GIPHY_KEY = ORIGINAL_KEY;
});

describe("T-CORRECT-1 — standalone: empty process.env, key in Constants.expoConfig.extra", () => {
  test("giphyEventCoverService.searchGiphyEventCovers resolves the key from extra (not null)", async () => {
    mockExtra.EXPO_PUBLIC_GIPHY_API_KEY = "extra-only-key";

    await expect(searchGiphyEventCovers("jazz night")).resolves.toHaveLength(1);
    expect(lastFetchApiKey()).toBe("extra-only-key");
  });

  test("coverProviderBrowseService.trendingGiphyCovers resolves the key from extra (not null)", async () => {
    mockExtra.EXPO_PUBLIC_GIPHY_API_KEY = "extra-only-key";

    await expect(trendingGiphyCovers()).resolves.toHaveLength(1);
    expect(lastFetchApiKey()).toBe("extra-only-key");
  });
});

describe("T-CORRECT-2 — fails-on-revert anchor: extra path is load-bearing", () => {
  // If the services regress to a dynamic-only process.env reader (no extra
  // read), these inputs (key ONLY in extra, process.env empty) resolve null →
  // both calls throw not_configured. The assertions below would then FAIL —
  // which is the intended fails-on-revert behavior.
  test("with key only in extra, neither service throws not_configured", async () => {
    mockExtra.EXPO_PUBLIC_GIPHY_API_KEY = "extra-only-key";

    await expect(searchGiphyEventCovers("supper club")).resolves.toBeDefined();
    await expect(trendingGiphyCovers()).resolves.toBeDefined();
  });
});

describe("T-CORRECT-3 — Metro/dev path: key only in static process.env, extra empty", () => {
  test("giphyEventCoverService resolves via the static process.env fallback", async () => {
    process.env.EXPO_PUBLIC_GIPHY_API_KEY = "static-env-key";

    await expect(searchGiphyEventCovers("jazz")).resolves.toHaveLength(1);
    expect(lastFetchApiKey()).toBe("static-env-key");
  });

  test("coverProviderBrowseService resolves via the static process.env fallback", async () => {
    process.env.EXPO_PUBLIC_GIPHY_API_KEY = "static-env-key";

    await expect(trendingGiphyCovers()).resolves.toHaveLength(1);
    expect(lastFetchApiKey()).toBe("static-env-key");
  });
});

describe("T-CORRECT-4 — dual-name fallback preserved (EXPO_PUBLIC_GIPHY_KEY)", () => {
  test("resolves from EXPO_PUBLIC_GIPHY_KEY in extra", async () => {
    mockExtra.EXPO_PUBLIC_GIPHY_KEY = "extra-secondary-name-key";

    await expect(searchGiphyEventCovers("market")).resolves.toHaveLength(1);
    expect(lastFetchApiKey()).toBe("extra-secondary-name-key");
  });

  test("resolves from EXPO_PUBLIC_GIPHY_KEY in static process.env", async () => {
    process.env.EXPO_PUBLIC_GIPHY_KEY = "static-secondary-name-key";

    await expect(trendingGiphyCovers()).resolves.toHaveLength(1);
    expect(lastFetchApiKey()).toBe("static-secondary-name-key");
  });
});
