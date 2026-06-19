/**
 * ORCH-1138 Leg 1 — regression guard for the public trip page "Where you'll be"
 * static map (buildStaticMapUrl).
 *
 * ORCH-1165 [Mapbox static map server-proxy] UPDATE [TEST-MOD-APPROVED ORCH-1165]:
 * the static map is no longer composed against api.mapbox.com with a client `pk.*`
 * token (that token was never provisioned, so the map never rendered). It now
 * points at the `mapbox-static` Supabase edge fn — a token-less, host-hidden proxy
 * URL. This file's old assertions (api.mapbox.com host + access_token + client
 * token param) asserted the SUPERSEDED contract; they are rewritten here to the
 * new proxy contract. The rule-9 coord fail-safe coverage is preserved.
 *
 * Covers:
 *  - happy path: finite coords + a functions base URL → a proxy URL pointing at
 *    `<base>/mapbox-static` with NO Mapbox token and NO api.mapbox.com host.
 *  - FAIL-SAFE (Constitution rule 9): missing functions base → null (hide map).
 *  - FAIL-SAFE: missing / non-finite coords → null (hide map).
 *  - getPublicMapboxToken (retained backward-compat export) still reads the
 *    inlining-safe Constants.expoConfig.extra → process.env order.
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

import { buildStaticMapUrl, getPublicMapboxToken } from "../mapboxStaticImage";

const PK = "pk.eyJtaW5nbGEtdGVzdCJ9.signature";
const BASE = "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1";

beforeEach(() => {
  for (const k of Object.keys(mockExtra)) delete mockExtra[k];
  delete process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
});

describe("buildStaticMapUrl — proxy URL (ORCH-1165), token-less + mapbox-less", () => {
  test("finite coords + base → proxy URL, NO token, NO api.mapbox.com", () => {
    const url = buildStaticMapUrl({
      lat: 40.6281,
      lng: 14.485,
      accentHex: "#e11d48",
      functionsBaseUrl: BASE,
    });
    expect(url).not.toBeNull();
    const u = url as string;
    expect(u.startsWith(`${BASE}/mapbox-static?`)).toBe(true);
    expect(u.includes("api.mapbox.com")).toBe(false);
    expect(u.includes("access_token")).toBe(false);
    expect(u.toLowerCase().includes("pk.")).toBe(false);
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
    expect(url).toContain(`${BASE}/mapbox-static?`);
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

describe("getPublicMapboxToken — retained inlining-safe read (backward-compat)", () => {
  test("reads from Constants.expoConfig.extra FIRST", () => {
    mockExtra.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN = PK;
    expect(getPublicMapboxToken()).toBe(PK);
  });

  test("falls back to process.env when extra is absent", () => {
    process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN = PK;
    expect(getPublicMapboxToken()).toBe(PK);
  });

  test("returns null when neither is set", () => {
    expect(getPublicMapboxToken()).toBeNull();
  });
});
