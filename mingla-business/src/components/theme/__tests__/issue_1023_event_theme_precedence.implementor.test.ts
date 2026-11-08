/**
 * #1023 (Seth): colour, font and motion resolve event override → brand →
 * Mingla default, for the page AND the motion tint. The Explorer event screen
 * resolved the canonical payload with the brand only (since 96cbd78baa,
 * #1936) and the RPC mapper dropped the event's overrides.
 */
import { readFileSync } from "fs";
import path from "path";

import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../../../app-mobile/src/services/supabase", () => ({ supabase: { rpc: jest.fn() } }));
// The Explorer hook file imports React Query for its hook; the mapper under
// test never calls it. Virtual: the business CI lane installs no app-mobile
// dependencies (a real resolve fails there).
jest.mock("@tanstack/react-query", () => ({ useQuery: jest.fn() }), { virtual: true });
jest.mock("@mingla/offering-rendering", () => {
  // the REAL theme rules, not stubs: this suite is about their precedence
  const resolver = jest.requireActual<typeof import("../../../../../packages/offering-rendering/themeResolver")>("../../../../../packages/offering-rendering/themeResolver");
  return {
    forwardableAcquisitionState: () => undefined,
    isThemeAnimationSlug: resolver.isThemeAnimationSlug,
    isThemeColor: resolver.isThemeColor,
    isThemeFontSlug: resolver.isThemeFontSlug,
  };
});

// require, not import: the business typecheck must not follow the Explorer
// hook into app-mobile's dependency graph (it has no app-mobile node_modules).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { mapRpcPayloadToPublicEvent } = require("../../../../../app-mobile/src/hooks/usePublicEventBySlug") as {
  mapRpcPayloadToPublicEvent: (payload: Record<string, unknown>) => {
    event: { themeOverrides?: ThemeInput | null };
    brand: { theme?: ThemeInput | null } | null;
  };
};
import { resolveTheme } from "../../../../../packages/offering-rendering/themeResolver";
import { MINGLA_DEFAULT_THEME, type ThemeInput } from "../../../../../packages/offering-rendering/designTokens";
import { buildThemeMotionPalette } from "../../../../../packages/theme-animations/tint";

const payload = (extra: Record<string, unknown>, brandColor: string | null): Record<string, unknown> => ({
  id: "event-1023",
  brandId: "brand-1",
  brandSlug: "77events",
  eventSlug: "y2k",
  name: "Y2K",
  status: "scheduled",
  tickets: [],
  timezone: "Africa/Lagos",
  brand: { id: "brand-1", slug: "77events", name: "77Events", themeColor: brandColor, themeFont: null, themeAnimation: "confetti" },
  ...extra,
});

/** Exactly what ConsumerEventDetailScreen does with a canonical payload. */
const screenTheme = (p: Record<string, unknown>) => {
  const canonical = mapRpcPayloadToPublicEvent(p);
  return resolveTheme(canonical.brand?.theme ?? null, canonical.event.themeOverrides ?? null);
};

describe("#1023 event theme precedence (Explorer event screen)", () => {
  test("an event colour override beats the brand, for the page and the motion tint", () => {
    const theme = screenTheme(
      payload({ themeColorOverride: "#2563eb", themeAnimationOverride: "love_burst" }, "#846420"),
    );
    expect(theme.color).toBe("#2563eb");
    expect(theme.animation).toBe("love_burst");
    expect(buildThemeMotionPalette(theme.color).key).toBe("#2563eb");
  });

  test("no override → the brand colour", () => {
    const theme = screenTheme(payload({}, "#846420"));
    expect(theme.color).toBe("#846420");
    expect(buildThemeMotionPalette(theme.color).key).toBe("#846420");
  });

  test("neither → the Mingla default", () => {
    const theme = screenTheme(payload({}, null));
    expect(theme.color).toBe(MINGLA_DEFAULT_THEME.color);
  });

  test("the screen resolves with the event's overrides and tints the motion with that same theme", () => {
    const src = readFileSync(
      path.join(__dirname, "../../../../../app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx"),
      "utf8",
    );
    expect(src).toContain("resolveTheme(canonical.brand.theme, canonical.event.themeOverrides ?? null)");
    const overlayAt = src.indexOf('testID="issue-1023-motion-overlay"');
    const overlay = src.slice(overlayAt, src.indexOf("</View>", overlayAt));
    expect(overlay).toContain("theme={theme}");
  });
});
