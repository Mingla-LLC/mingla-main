import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), "..", relativePath), "utf8");

describe("ORCH-0964 design rework — public event page premium renderer", () => {
  const sharedSource = repoFile("packages/offering-rendering/PublicEventPage.tsx");
  // ORCH-1138 A1 (SPEC amendment A-1) — createThemePalette + the ThemePalette
  // type + the color-math helpers were extracted VERBATIM out of
  // PublicEventPage.tsx into themePalette.ts (behavior-neutral). These three
  // structural assertions now read the new module home; the page still consumes
  // them via `useMemo(() => createThemePalette(theme))` (asserted below against
  // sharedSource). [TEST-MOD-APPROVED ORCH-1138]
  const paletteSource = repoFile("packages/offering-rendering/themePalette.ts");
  const typesSource = repoFile("packages/offering-rendering/types.ts");
  // [TEST-MOD-APPROVED #2468] the maps deep-link builder is the new single
  // owner of every "open in maps" URL; the venue-card assertions below read it.
  const mapsDeepLinkSource = repoFile(
    "packages/offering-rendering/mapsDeepLink.ts",
  );
  const packageSource = repoFile("packages/offering-rendering/package.json");
  const businessAdapterSource = readFileSync(
    path.join(process.cwd(), "src/components/event/PublicEventPage.tsx"),
    "utf8",
  );
  // #1062 B1 cross-app junk removal: this business-repo jest suite previously
  // reached into app-mobile's ExpandedBusinessEventSheet.tsx to cross-check the
  // CONSUMER sheet's photo/onOpenMaps wiring. That file was DELETED in
  // ORCH-1138 Leg 3 (#507, "EBES deletion") and its logic moved to app-mobile's
  // ConsumerEventDetailScreen — a separate app with its own test suite. The
  // cross-app assertions are dropped (architecturally out of scope for
  // mingla-business jest); the business renderer's own photo/onOpenMaps wiring
  // stays covered below via sharedSource + businessAdapterSource.

  test("event body keeps the cover-scroll concept and upgrades into a glass sheet", () => {
    const bodyContentBlock =
      sharedSource.match(/bodyContent: \{[\s\S]*?\n  \},/)?.[0] ?? "";
    // #1062 B2 drift-to-truth: ORCH-1169 (#543) extracted the raw expo-blur
    // BlurView into the shared, mobile-web-safe GlassBlur wrapper. The body
    // still upgrades into a glass sheet — now via <GlassBlur> (asserted below) —
    // and offering-rendering still depends on expo-blur (GlassBlur imports it).
    expect(sharedSource).toContain('import { GlassBlur } from "./GlassBlur"');
    expect(packageSource).toContain('"expo-blur": "*"');
    // #1062 B2 drift-to-truth: META-ORCH-0991 (sheet rework) + ORCH-1138
    // (aspect-adaptive hero) rebuilt the cover-scroll — the fixed heroWrap
    // (absolute, height 380) + paddingTop-288 body offset were replaced by the
    // shared EventCoverMedia cover + a body that OVERLAPS the cover via
    // marginTop:-28 ("preserves the prior immersive seam"). The cover-scroll
    // concept + immersive seam are preserved; the glass sheet is asserted below.
    expect(sharedSource).toContain("<EventCoverMedia");
    expect(bodyContentBlock).toContain("marginTop: -28");
    expect(sharedSource).toContain('pointerEvents="none"');
    expect(sharedSource).toContain("style={styles.bodyGlassLayer}");
    expect(paletteSource).toContain("type ThemePalette");
    expect(paletteSource).toContain(
      "const createThemePalette = (theme: ResolvedTheme)",
    );
    expect(paletteSource).toContain("const contrastAdjustedAccent = (");
    expect(paletteSource).toContain("const contrastAdjustedForWhiteText = (");
    expect(sharedSource).toContain(
      "const palette = useMemo(() => createThemePalette(theme)",
    );
    expect(sharedSource).toContain("tint={palette.glassTint}");
    expect(sharedSource).toContain("backgroundColor: palette.page");
    expect(bodyContentBlock).toContain("maxWidth: 660");
    expect(bodyContentBlock).toContain("borderTopLeftRadius: 28");
  });

  test("tickets render as large themed cards instead of divider rows", () => {
    const ticketCardBlock =
      sharedSource.match(/ticketCard: \{[\s\S]*?\n  \},/)?.[0] ?? "";
    const ticketBuyerBlock =
      sharedSource.match(/ticketBuyerBtn: \{[\s\S]*?\n  \},/)?.[0] ?? "";
    expect(sharedSource).toContain("styles.ticketCard");
    expect(sharedSource).toContain("styles.ticketHeaderRow");
    expect(sharedSource).toContain("styles.ticketPricePill");
    expect(sharedSource).toContain("styles.ticketFooterRow");
    expect(sharedSource).toContain("styles.ticketCardAccent");
    expect(sharedSource).toContain("backgroundColor: palette.card");
    expect(sharedSource).toContain("borderColor: palette.cutoutBorder");
    expect(sharedSource).toContain("backgroundColor: palette.accent");
    expect(sharedSource).toContain("borderColor: palette.accentText");
    expect(sharedSource).toContain("shadowColor: palette.accent");
    expect(sharedSource).toContain("color: palette.accentText");
    expect(ticketCardBlock).toContain("borderWidth: 1.5");
    expect(ticketCardBlock).toContain("shadowOpacity: 0.3");
    expect(ticketBuyerBlock).toContain("minHeight: 58");
    expect(ticketBuyerBlock).toContain("borderWidth: 2");
    expect(ticketBuyerBlock).toContain("shadowOpacity: 0.42");
    expect(ticketBuyerBlock).toContain('alignItems: "center"');
    expect(sharedSource).not.toContain("ticketRowDivider");
    expect(sharedSource).not.toContain("isLast");
  });

  test("brand and venue affordances use the selected theme color beyond text accents", () => {
    expect(sharedSource).toContain("const heroColor =");
    expect(sharedSource).toContain("styles.brandKicker");
    expect(sharedSource).toContain("styles.brandTextCol");
    expect(sharedSource).toContain("backgroundColor: palette.glass");
    expect(sharedSource).toContain("color: palette.primaryText");
    expect(sharedSource).toContain("styles.venueIconDisk");
    expect(sharedSource).toContain("color: palette.secondaryText");
    expect(sharedSource).toContain("Presented by");
  });

  test("event date and time labels stay READABLE via luminance-aware palette colors above the themed event surface (ORCH-1117 R1 — no raw #ffffff)", () => {
    // #1062 B2 drift-to-truth: ORCH-1117 R1 replaced the raw-white date/time
    // labels (invisible on light brand themes) with luminance-aware palette
    // colors contrast-adjusted ≥4.5:1. The date eyebrow takes palette.accent;
    // the recurrence pill label takes palette.primaryText.
    expect(sharedSource).toContain(
      "{ color: palette.accent, fontFamily: theme.fontFamilyValue }",
    );
    expect(sharedSource).toContain("styles.recurrencePillLabel");
    expect(sharedSource).toContain("{ color: palette.primaryText }");
  });

  test("presented-by card renders the brand profile photo when available", () => {
    expect(typesSource).toContain("photo?: string");
    expect(sharedSource).toContain("brand?.photo !== undefined");
    expect(sharedSource).toContain("source={{ uri: brand.photo }}");
    expect(sharedSource).toContain("styles.brandPhoto");
    expect(businessAdapterSource).toContain("photo: brand.photo");
  });

  // [TEST-MOD-APPROVED #2468] maps-deep-link-coordinates.
  //
  // WHAT THIS TEST USED TO PIN, AND WHY IT HAD TO CHANGE. It asserted that the
  // BUSINESS ADAPTER itself contained `Platform.OS === "ios"`, `maps://?q=`,
  // `geo:0,0?q=` and the google text-search URL — i.e. it pinned the adapter as
  // a maps-URL BUILDER, and it pinned the `?q=<free text>` form specifically.
  // That form IS the #2468 defect: it discards the coordinate we already store
  // and lets Apple/Google re-geocode, so the same link resolved to Alverton
  // Street, London SE8 for a Lagos event on a London-located device
  // (reproduced twice on a real simulator against production data). It also
  // pinned `onOpenMaps?: (query: string) => void`, the signature that made it
  // impossible to pass the coordinate at all.
  //
  // The URL now has ONE owner, `@mingla/offering-rendering/mapsDeepLink`, and
  // the adapter only forwards a target. The text forms still exist — inside
  // that builder, as the honest fallback for an event with no stored pin — and
  // are pinned by issue_2468_maps_deep_link.test.ts T-2.
  //
  // The test's INTENT ("without leaking hidden addresses") is not weakened: it
  // is strengthened below, because the privacy gate now refuses to read
  // `locationGeo` at all when the address is hidden.
  test("location card opens platform maps without leaking hidden addresses", () => {
    expect(typesSource).toContain("onOpenMaps?: (target: MapsOpenTarget) => void");
    expect(sharedSource).toContain("const venueMapsTarget = selectVenueMapsTarget({");
    // The privacy gate moved into the shared builder, one owner for all three
    // renderers — and it is fed the SAME predicate this test always pinned.
    expect(sharedSource).toContain("addressHidden: event.hideAddressUntilTicket");
    expect(mapsDeepLinkSource).toContain("if (params.addressHidden) return null;");
    // ...and it is null-checked BEFORE locationGeo is read, so a hidden-address
    // event cannot hand out an exact pin even if a host over-supplies the prop.
    expect(
      mapsDeepLinkSource.indexOf("if (params.addressHidden) return null;"),
    ).toBeLessThan(mapsDeepLinkSource.indexOf("normalizeMapsGeo(params.locationGeo)"));
    expect(sharedSource).toContain("callbacks.onOpenMaps?.(venueMapsTarget)");
    expect(sharedSource).toContain("Open maps");
    expect(sharedSource).toContain("styles.venueMapsPill");
    expect(sharedSource).toContain("borderColor: palette.accentText");
    // The adapter is a FORWARDER now, not a URL builder.
    expect(businessAdapterSource).toContain("const openMapsForTarget =");
    expect(businessAdapterSource).toContain("openMapsTarget(target)");
    expect(businessAdapterSource).toContain("onOpenMaps: openMapsForTarget");
    expect(businessAdapterSource).not.toContain('"maps://?q=');
    expect(businessAdapterSource).not.toContain('`maps://?q=');
    expect(businessAdapterSource).not.toContain('`geo:0,0?q=');
    // The coordinate-anchored shapes #2468 proved correct, at their one owner.
    expect(mapsDeepLinkSource).toContain("`maps://?ll=${pair}&q=${encodedLabel}`");
    // [TEST-MOD-APPROVED #2468] tester P3-2: the android label is now run
    // through `encodeGeoLabel`, which percent-escapes the parens that would
    // otherwise close the `(<label>)` wrapper early. The coordinate authority
    // asserted on the same line is unchanged.
    expect(mapsDeepLinkSource).toContain(
      "`geo:${pair}?q=${pair}(${encodeGeoLabel(label)})`",
    );
    expect(mapsDeepLinkSource).toContain('.replace(/\\(/g, "%28")');
  });
});
