/**
 * ORCH-1138 Leg 1 — regression guard for the public trip page "Where you'll be"
 * static Mapbox map (buildStaticMapUrl + the inlining-safe token read).
 *
 * Covers:
 *  - happy path: token + finite coords → a valid Mapbox Static Images API URL
 *    with the themed pin at the destination, '#'-stripped accent.
 *  - FAIL-SAFE (Constitution rule 9): NO token → null (caller hides map).
 *  - FAIL-SAFE: missing / non-finite coords → null (caller hides map).
 *  - token read prefers Constants.expoConfig.extra (the OTA/standalone-safe
 *    path) over process.env.
 *
 * fails-on-revert: delete the `if (...token...) return null` or the coord guard
 * in buildStaticMapUrl and the corresponding case below goes red.
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

beforeEach(() => {
  for (const k of Object.keys(mockExtra)) delete mockExtra[k];
  delete process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;
});

describe("buildStaticMapUrl — happy path", () => {
  test("token + finite coords → a valid Mapbox Static Images URL with themed pin", () => {
    const url = buildStaticMapUrl({
      lat: 40.6281,
      lng: 14.485,
      accentHex: "#e11d48",
      token: PK,
    });
    expect(url).not.toBeNull();
    const u = url as string;
    expect(u.startsWith("https://api.mapbox.com/styles/v1/mapbox/")).toBe(true);
    // lng,lat order (Mapbox is lon-first) in both the overlay pin and the center.
    expect(u).toContain("pin-s+e11d48(14.485,40.6281)");
    expect(u).toContain("/14.485,40.6281,");
    expect(u).toContain(`access_token=${encodeURIComponent(PK)}`);
    // '#' must be stripped from the pin color.
    expect(u).not.toContain("%23");
    expect(u).not.toContain("#");
  });

  test("invalid accent hex falls back to the default pin color (never breaks the URL)", () => {
    const url = buildStaticMapUrl({
      lat: 1,
      lng: 2,
      accentHex: "not-a-color",
      token: PK,
    });
    expect(url).toContain("pin-s+eb7825(");
  });
});

describe("buildStaticMapUrl — FAIL-SAFE (rule 9: hide, never fabricate/crash)", () => {
  test("absent token → null", () => {
    expect(buildStaticMapUrl({ lat: 1, lng: 2, token: null })).toBeNull();
  });

  test("empty/whitespace token → null", () => {
    expect(buildStaticMapUrl({ lat: 1, lng: 2, token: "   " })).toBeNull();
  });

  test("null coords → null (even with a valid token)", () => {
    expect(buildStaticMapUrl({ lat: null, lng: null, token: PK })).toBeNull();
    expect(buildStaticMapUrl({ lat: 1, lng: null, token: PK })).toBeNull();
    expect(buildStaticMapUrl({ lat: null, lng: 2, token: PK })).toBeNull();
  });

  test("non-finite coords → null", () => {
    expect(buildStaticMapUrl({ lat: NaN, lng: 2, token: PK })).toBeNull();
    expect(buildStaticMapUrl({ lat: 1, lng: Infinity, token: PK })).toBeNull();
  });
});

describe("getPublicMapboxToken — inlining-safe read", () => {
  test("reads from Constants.expoConfig.extra FIRST", () => {
    mockExtra.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN = PK;
    expect(getPublicMapboxToken()).toBe(PK);
  });

  test("falls back to process.env when extra is absent", () => {
    process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN = PK;
    expect(getPublicMapboxToken()).toBe(PK);
  });

  test("returns null when neither is set (→ map hides)", () => {
    expect(getPublicMapboxToken()).toBeNull();
  });

  test("builder with default token source uses the runtime read", () => {
    mockExtra.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN = PK;
    const url = buildStaticMapUrl({ lat: 1, lng: 2 });
    expect(url).toContain(`access_token=${encodeURIComponent(PK)}`);
  });
});
