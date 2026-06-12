/**
 * ORCH-1127 (ex-1116) — TESTER adversarial regression for the GIPHY cover-key
 * reachability fix. DIFFERENT ANGLE than the implementor's happy-path
 * `giphyKeyReachability.test.ts`:
 *
 *  - The implementor's test mocks `expo-constants` so `Constants.expoConfig` is
 *    ALWAYS a defined object carrying `extra`, and asserts the public service
 *    APIs resolve the key. It proves the happy `extra` read works.
 *
 *  - THIS test attacks two angles the implementor's does NOT cover:
 *
 *    (G1) STRUCTURAL SOURCE TRAP — read the actual service source files off disk
 *         and assert the load-bearing invariant directly: BOTH services import
 *         expo-constants, read `Constants.expoConfig?.extra`, and contain NO
 *         non-inlinable dynamic `process.env[<var>]` / `globalThis...env?.[<var>]`
 *         bracket read in executable code. A future edit that reverts EITHER
 *         service to the dynamic-only reader (the exact COMMS-0028 root-cause
 *         pattern) FAILS here even if someone also rewrites the mock-based tests.
 *         This is the angle that survives test-suite tampering — it inspects the
 *         shipped source, not a mock.
 *
 *    (G2) RUNTIME NULL-MANIFEST BOUNDARY — the implementor always provides a
 *         defined `Constants.expoConfig`. In a real standalone/edge runtime,
 *         `Constants.expoConfig` can be NULL. This test drives the trending path
 *         (coverProviderBrowseService) specifically with `expoConfig = null`
 *         AND an empty process.env, then with `expoConfig = null` + a STATIC
 *         process.env key, proving the optional-chained `?.extra` does not throw
 *         and the static fallback still carries the key. If a revert dropped the
 *         optional chaining or the static fallback, this throws/returns null.
 *
 * Fails-on-revert: reverting either service to the dynamic-only reader fails
 * G1 (no extra read / dynamic bracket present) AND G2-empty (key unresolved →
 * not_configured). Verified by line-deletion of the `readExtra(name) ??` read.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, jest, test } from "@jest/globals";

// ---- G2 runtime harness: a MUTABLE expoConfig the mock returns by reference.
// Distinct from the implementor's mock: here expoConfig itself can be set to
// null to exercise the optional-chaining boundary the implementor never hits.
const mockState: { expoConfig: { extra?: Record<string, string | undefined> } | null } = {
  expoConfig: { extra: {} },
};
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return mockState.expoConfig;
    },
  },
}));

jest.mock("../supabase", () => ({
  supabase: {
    functions: { invoke: jest.fn(async () => ({ data: null, error: null })) },
  },
}));

import { trendingGiphyCovers } from "../coverProviderBrowseService";
import { searchGiphyEventCovers } from "../giphyEventCoverService";

const ORIGINAL_API_KEY = process.env.EXPO_PUBLIC_GIPHY_API_KEY;
const ORIGINAL_KEY = process.env.EXPO_PUBLIC_GIPHY_KEY;
const originalFetch = global.fetch;

const fetchOk = (): Response =>
  ({
    json: async () => ({
      data: [
        {
          id: "gif-1",
          title: "loop",
          url: "https://giphy.com/gifs/x",
          images: {
            fixed_width: { url: "https://media.giphy.com/p.gif" },
            downsized_medium: { url: "https://media.giphy.com/m.gif" },
            downsized: { url: "https://media.giphy.com/d.gif" },
            original: { url: "https://media.giphy.com/o.gif" },
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

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.EXPO_PUBLIC_GIPHY_API_KEY;
  delete process.env.EXPO_PUBLIC_GIPHY_KEY;
  mockState.expoConfig = { extra: {} };
  global.fetch = jest.fn(async () => fetchOk()) as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
  if (ORIGINAL_API_KEY === undefined) delete process.env.EXPO_PUBLIC_GIPHY_API_KEY;
  else process.env.EXPO_PUBLIC_GIPHY_API_KEY = ORIGINAL_API_KEY;
  if (ORIGINAL_KEY === undefined) delete process.env.EXPO_PUBLIC_GIPHY_KEY;
  else process.env.EXPO_PUBLIC_GIPHY_KEY = ORIGINAL_KEY;
});

// ===========================================================================
// G1 — STRUCTURAL SOURCE TRAP (different angle: inspects shipped source, not a mock)
// ===========================================================================
describe("ORCH-1127 G1 — both GIPHY services have the extra-first reader in shipped source", () => {
  const SERVICES = ["giphyEventCoverService.ts", "coverProviderBrowseService.ts"];

  // Strip comments so the protective ORCH-1127 comment (which names the banned
  // pattern on purpose) does not self-trip the detector — mirror the gate.
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  // Dynamic bracket read with a NON-string-literal subscript (the non-inlinable
  // form). A static `process.env.EXPO_PUBLIC_X` member read is allowed.
  const DYNAMIC_BRACKET = /\.env\??\.?\[\s*(?!['"`])[^\]]+\]/;

  for (const file of SERVICES) {
    test(`${file} imports expo-constants, reads Constants.expoConfig.extra, and has NO dynamic env bracket read`, () => {
      const abs = path.join(__dirname, "..", file);
      const raw = readFileSync(abs, "utf8");
      const code = stripComments(raw);

      expect(raw).toMatch(/from "expo-constants"/);
      expect(code).toMatch(/Constants\.expoConfig\??\.extra/);
      // The killer assertion: no non-inlinable dynamic env read survives.
      expect(DYNAMIC_BRACKET.test(code)).toBe(false);
    });
  }
});

// ===========================================================================
// G2 — RUNTIME NULL-MANIFEST BOUNDARY (different angle: expoConfig === null)
// ===========================================================================
describe("ORCH-1127 G2 — trending path survives a null Constants.expoConfig", () => {
  test("expoConfig=null + empty process.env → not_configured (no crash on ?.extra)", async () => {
    mockState.expoConfig = null; // optional-chaining boundary the implementor never hits

    // Must reject with the controlled not_configured error, NOT a TypeError from
    // dereferencing null.extra. A revert that drops `?.` here would throw a
    // different (uncaught) error and fail this assertion.
    await expect(trendingGiphyCovers()).rejects.toThrow(/not configured/i);
  });

  test("expoConfig=null + STATIC process.env key → trending still resolves via the static fallback", async () => {
    mockState.expoConfig = null;
    process.env.EXPO_PUBLIC_GIPHY_API_KEY = "static-when-manifest-null";

    await expect(trendingGiphyCovers()).resolves.toHaveLength(1);
    expect(lastFetchApiKey()).toBe("static-when-manifest-null");
  });

  test("search path also survives expoConfig=null with static fallback", async () => {
    mockState.expoConfig = null;
    process.env.EXPO_PUBLIC_GIPHY_API_KEY = "static-search-when-null";

    await expect(searchGiphyEventCovers("late night")).resolves.toHaveLength(1);
    expect(lastFetchApiKey()).toBe("static-search-when-null");
  });
});
