/**
 * Marketing tab layout (ORCH-0815-B foundation; ORCH-0826 M0 extension).
 *
 * Wraps `/(tabs)/marketing/*` sub-routes. The MarketingSubNav stays sticky
 * at the top; expo-router's `<Slot />` renders whichever sub-route the
 * user navigated to (Overview / Audiences / Campaigns / Templates).
 *
 * ORCH-0826 M0 (Q4 operator override): the universal "+" creator now lives
 * on the Marketing tab's TopBar, mounted in this layout so it persists
 * across all marketing sub-routes. The composer route
 * (`/(tabs)/marketing/campaigns/compose`) HIDES the "+" to keep the
 * focused-authoring surface uncluttered (matches the existing BottomNav
 * hide pattern from `(tabs)/_layout.tsx`).
 */

import React, { Suspense, useCallback, useState } from "react";
import { Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import { Slot, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MarketingSubNav } from "../../../src/components/marketing/MarketingSubNav";
import { MarketingBrandSwitcherProvider } from "../../../src/components/people/MarketingBrandSwitcherContext";
import { IconChrome } from "../../../src/components/ui/IconChrome";
import { TopBar } from "../../../src/components/ui/TopBar";
import { canvas, spacing } from "../../../src/constants/designSystem";

const LazyBrandSwitcherSheet = React.lazy(async () => {
  const mod = await import("../../../src/components/brand/BrandSwitcherSheet");
  return { default: mod.BrandSwitcherSheet };
});

const LazyUniversalCreatorSheet = React.lazy(async () => {
  const mod = await import("../../../src/components/ui/UniversalCreatorSheet");
  return { default: mod.UniversalCreatorSheet };
});

export default function MarketingTabLayout(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  /**
   * #2262 [composer-responsive-layout] — THE ONE VIEWPORT PIN, and it is web
   * only.
   *
   * `expo-router`'s `ScrollViewStyleReset` (rendered by `app/+html.tsx`) emits
   * `#root,body,html{height:100%}` — the LAYOUT viewport, which NO mobile
   * browser has resized for the soft keyboard since Chrome 108 matched Mobile
   * Safari. So a pure-flex chain from the document root keeps its full height
   * with the keyboard open, and the composer's action row sits underneath it.
   *
   * `useWindowDimensions().height` on react-native-web is
   * `Math.round(visualViewport.height * visualViewport.scale)` and re-fires on
   * `visualViewport`'s `resize` — i.e. it is already the VISIBLE height. RN-web
   * publishes that signal today and nothing consumed it; pinning the host to it
   * is what makes the flow-sibling commit bar work on mobile web.
   *
   * WHY IT LIVES HERE AND NOWHERE LOWER. This layout paints a 56pt TopBar plus
   * 8pt of padding ABOVE the `<Slot/>`, and `CHROME_CONTENT_PX` never counted
   * it — that single omission is what made the overflow device-independent.
   * Pinning at `compose.tsx`'s own root would double-count that bar; pinning at
   * `(tabs)/_layout.tsx` widens further. This host is the tightest ancestor
   * containing all of the composer's chrome, so FLEXBOX performs the TopBar
   * subtraction and no arithmetic is written anywhere.
   *
   * Every other `/(tabs)/marketing/*` route is unaffected when no soft keyboard
   * is open (visual viewport === layout viewport) and IMPROVED when one is.
   */
  const { height: windowHeight } = useWindowDimensions();

  // ORCH-0826 M0: BrandSwitcherSheet (matches Home + Hub + Account pattern)
  // + UniversalCreatorSheet for the universal "+" creator.
  const [brandSheetVisible, setBrandSheetVisible] = useState<boolean>(false);
  const [isUniversalCreatorOpen, setIsUniversalCreatorOpen] = useState<boolean>(false);

  const handleOpenSwitcher = useCallback((): void => {
    setBrandSheetVisible(true);
  }, []);

  // Hide universal "+" on composer screens (matches BottomNav hide pattern).
  const hideUniversalPlus = pathname.includes("/campaigns/compose");

  return (
    <View
      style={[
        styles.host,
        { paddingTop: insets.top },
        // The SSR guard is MANDATORY, not defensive. react-native-web returns
        // `{width: 0, height: 0}` when there is no `window`, and `height: 0`
        // would blank every marketing route during the static export. Same
        // guard `useResponsiveLayout` already applies to `width`.
        //
        // `flexGrow: 0` + `flexBasis: "auto"` ride WITH the height, and they are
        // load-bearing rather than tidy. `styles.host` carries `flex: 1` for
        // native, which compiles to `flex-grow: 1; flex-basis: 0%`; if ANY
        // ancestor between `#root` and this host is a COLUMN flex container,
        // that grow term is on the main axis and the browser fills the parent,
        // silently discarding the pinned height. The #2262 browser harness
        // caught exactly that: the inline style read `height: 414px` while the
        // element measured 750. Neutralising the grow makes the pin
        // authoritative whichever direction the ancestor chain happens to use.
        Platform.OS === "web" && windowHeight > 0
          ? { height: windowHeight, flexGrow: 0, flexShrink: 0, flexBasis: "auto" }
          : null,
      ]}
      testID="marketing-tab-layout-host"
    >
      <View style={styles.barWrap}>
        <TopBar
          leftKind="brand"
          onBrandTap={handleOpenSwitcher}
          extraRightSlot={
            hideUniversalPlus ? undefined : (
              <IconChrome
                icon="plus"
                size={36}
                onPress={() => setIsUniversalCreatorOpen(true)}
                accessibilityLabel="Create event, experience, or trip"
                testID="marketing-universal-creator-button"
              />
            )
          }
        />
      </View>
      <MarketingSubNav />
      <MarketingBrandSwitcherProvider value={handleOpenSwitcher}>
        <Slot />
      </MarketingBrandSwitcherProvider>
      {brandSheetVisible ? (
        <Suspense fallback={null}>
          <LazyBrandSwitcherSheet
            visible
            onClose={() => setBrandSheetVisible(false)}
          />
        </Suspense>
      ) : null}
      {/* ORCH-0826 M0: universal creator sheet */}
      {isUniversalCreatorOpen ? (
        <Suspense fallback={null}>
          <LazyUniversalCreatorSheet
            visible
            onClose={() => setIsUniversalCreatorOpen(false)}
          />
        </Suspense>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  barWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
});
