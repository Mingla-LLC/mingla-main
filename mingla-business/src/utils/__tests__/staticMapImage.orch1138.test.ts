/**
 * ORCH-1138 Leg 1 / ORCH-1165 — regression guard for the "Where you'll be"
 * static map (buildStaticMapUrl): a key-less, provider-neutral proxy URL
 * (`<base>/static-map`), Google Maps Static API behind it since #4334.
 *
 * Covers:
 *  - happy path: finite coords + a functions base URL → `<base>/static-map`
 *    with NO key and NO provider host.
 *  - FAIL-SAFE (Constitution rule 9): missing functions base → null (hide map).
 *  - FAIL-SAFE: missing / non-finite coords → null (hide map).
 *
 * #4334 removed the dead client map-token reader and its three cases.
 *
 * fails-on-revert: delete the coord guard or the base guard in
 * buildProxyStaticMapUrl and the corresponding case below goes red.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

// Mutable extra the mock returns by reference; the util reads it at CALL time.
const mockExtra: Record<string, string | undefined> = {};
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: mockExtra };
    },
  },
}));

import { buildStaticMapUrl } from "../staticMapImage";

const BASE = "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1";

beforeEach(() => {
  for (const k of Object.keys(mockExtra)) delete mockExtra[k];
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
});

describe("buildStaticMapUrl — proxy URL (ORCH-1165), key-less + provider-neutral", () => {
  test("finite coords + base → proxy URL, no key, no provider host", () => {
    const url = buildStaticMapUrl({
      lat: 40.6281,
      lng: 14.485,
      accentHex: "#e11d48",
      functionsBaseUrl: BASE,
    });
    expect(url).not.toBeNull();
    const u = url as string;
    expect(u.startsWith(`${BASE}/static-map?`)).toBe(true);
    expect(u.includes("googleapis.com")).toBe(false);
    expect(u.includes("key=")).toBe(false);
    // lng,lat forwarded; accent normalized ('#' stripped, lowercased).
    expect(u).toContain("lat=40.6281");
    expect(u).toContain("lng=14.485");
    expect(u).toContain("accent=e11d48");
  });

  test("invalid accent hex falls back to the default pin color", () => {
    const url = buildStaticMapUrl({
      lat: 1,
      lng: 2,
      accentHex: "not-a-color",
      functionsBaseUrl: BASE,
    });
    expect(url).toContain("accent=eb7825");
  });

  test("reads the runtime functions base from Constants.expoConfig.extra", () => {
    mockExtra.EXPO_PUBLIC_SUPABASE_URL =
      "https://gqnoajqerqhnvulmnyvv.supabase.co";
    const url = buildStaticMapUrl({ lat: 1, lng: 2 });
    expect(url).toContain(`${BASE}/static-map?`);
  });
});

describe("buildStaticMapUrl — FAIL-SAFE (rule 9: hide, never fabricate/crash)", () => {
  test("absent functions base → null", () => {
    expect(buildStaticMapUrl({ lat: 1, lng: 2, functionsBaseUrl: null })).toBeNull();
  });

  test("empty/whitespace base → null", () => {
    expect(buildStaticMapUrl({ lat: 1, lng: 2, functionsBaseUrl: "   " })).toBeNull();
  });

  test("null coords → null (even with a valid base)", () => {
    expect(buildStaticMapUrl({ lat: null, lng: null, functionsBaseUrl: BASE })).toBeNull();
    expect(buildStaticMapUrl({ lat: 1, lng: null, functionsBaseUrl: BASE })).toBeNull();
    expect(buildStaticMapUrl({ lat: null, lng: 2, functionsBaseUrl: BASE })).toBeNull();
  });

  test("non-finite coords → null", () => {
    expect(buildStaticMapUrl({ lat: NaN, lng: 2, functionsBaseUrl: BASE })).toBeNull();
    expect(buildStaticMapUrl({ lat: 1, lng: Infinity, functionsBaseUrl: BASE })).toBeNull();
  });
});
