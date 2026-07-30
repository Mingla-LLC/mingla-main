/**
 * ORCH-1186 [salvaged from ORCH-1158 Issue 3, wizard-map-preview] — happy-path
 * regression guard for the event create-wizard "Where" step map preview
 * (CreatorStep3Where).
 *
 * CONTEXT: ORCH-1158 added a REAL static-map preview to the wizard's Where step,
 * replacing the striped placeholder, with an honest "pick an address" empty state
 * when there are no coords. The ORCH-1158 branch test asserted the PRE-ORCH-1165
 * client-token URL contract (api.mapbox.com + access_token). On current `main`
 * the static map is fetched through the vendor-NEUTRAL `static-map` Supabase edge
 * proxy (ORCH-1165): the URL is token-less and the substring "mapbox" appears
 * NOWHERE. This test asserts the CURRENT proxy contract + the wizard wiring.
 *
 * Two assertion styles, both fails-on-revert under TRUE LINE DELETION:
 *   - BEHAVIORAL: real calls to buildStaticMapUrl with the EXACT params the
 *     wizard passes ({ lat, lng, accentHex, height: 160 }) — proves the resolved
 *     coords → a real proxy URL and absent coords → null (the empty state).
 *   - SOURCE: the render wiring (comment-stripped) — delete the buildStaticMapUrl
 *     call, the <Image>, or the empty-state branch and the matching expectation
 *     goes red.
 *
 * Runs under the default mingla-business ts-jest (node env). The behavioral
 * assertions call the PURE proxy builder (buildProxyStaticMapUrl) directly — it
 * has NO expo-constants / `@mingla/*`-alias dependency, so it resolves under the
 * default jest config (the wizard's `buildStaticMapUrl` is just that pure builder
 * with the runtime functions-base resolved first). PURE-ADD test (no token).
 */
import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

import {
  buildProxyStaticMapUrl,
  type StaticMapParams,
} from "../../../../../packages/offering-rendering/mapboxStaticProxyUrl";

const BASE = "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1";
const ACCENT = "#eb7825"; // accent.warm — the exact value the wizard passes.

// The wizard's buildStaticMapUrl resolves the runtime functions base then calls
// the pure proxy builder with it. Here we drive that pure builder directly,
// resolving the base from the params' explicit override (mirrors the runtime
// resolution: an explicit functionsBaseUrl wins; otherwise the runtime base).
const buildStaticMapUrl = (params: StaticMapParams): string | null =>
  buildProxyStaticMapUrl(
    params,
    params.functionsBaseUrl === undefined ? BASE : params.functionsBaseUrl,
  );

const ROOT = path.resolve(__dirname, "../../../..");
const read = (rel: string): string =>
  fs.readFileSync(path.join(ROOT, rel), "utf8");
const strip = (src: string): string =>
  src.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");

// ─────────────────────────────────────────────────────────────────────────────
// BEHAVIORAL — the buildStaticMapUrl contract the wizard depends on.
// ─────────────────────────────────────────────────────────────────────────────
describe("ORCH-1186 wizard map preview — buildStaticMapUrl contract", () => {
  test("resolved coords → a real, token-less, vendor-neutral proxy URL", () => {
    const url = buildStaticMapUrl({
      lat: 38.9072,
      lng: -77.0369,
      accentHex: ACCENT,
      height: 160,
      functionsBaseUrl: BASE,
    });
    expect(url).not.toBeNull();
    const u = url as string;
    expect(u.startsWith(`${BASE}/static-map?`)).toBe(true);
    expect(u).toContain("lat=38.9072");
    expect(u).toContain("lng=-77.0369");
    expect(u).toContain("accent=eb7825"); // '#' stripped, lowercased
    // Vendor-neutral (Seth's hard requirement): no token, no upstream host.
    expect(u.includes("access_token")).toBe(false);
    expect(u.toLowerCase().includes("mapbox")).toBe(false);
  });

  test("absent coords → null (the wizard renders the honest empty state)", () => {
    expect(
      buildStaticMapUrl({ lat: null, lng: null, accentHex: ACCENT, height: 160 }),
    ).toBeNull();
  });

  test("absent functions base → null (the wizard renders the empty state)", () => {
    expect(
      buildStaticMapUrl({
        lat: 38.9072,
        lng: -77.0369,
        accentHex: ACCENT,
        height: 160,
        functionsBaseUrl: null,
      }),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE — the wizard wiring (fails-on-revert under true line deletion).
// ─────────────────────────────────────────────────────────────────────────────
describe("ORCH-1186 wizard map preview — CreatorStep3Where wiring", () => {
  const SRC = strip(
    read("src/components/event/CreatorStep3Where.tsx"),
  );

  test("builds the static-map URL from the picked address coords", () => {
    expect(SRC).toContain("buildStaticMapUrl({");
    expect(SRC).toContain("lat: draft.locationGeo?.lat ?? null");
    expect(SRC).toContain("lng: draft.locationGeo?.lng ?? null");
  });

  test("renders the real map <Image> when a URL resolves", () => {
    expect(SRC).toMatch(/mapUrl !== null \?/);
    expect(SRC).toContain("<Image");
  });

  test("renders the honest empty state (no fabricated tile) when no URL", () => {
    expect(SRC).toContain("Pick an address to preview the map");
    // The old striped placeholder must NOT come back (rule 9).
    expect(SRC).not.toContain("mapStripes");
    expect(SRC).not.toContain("map preview");
  });
});
