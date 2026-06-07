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
import { StyleSheet, View } from "react-native";
import { Slot, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MarketingSubNav } from "../../../src/components/marketing/MarketingSubNav";
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
    <View style={[styles.host, { paddingTop: insets.top }]}>
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
      <Slot />
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
