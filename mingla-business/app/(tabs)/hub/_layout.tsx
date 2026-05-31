/**
 * (tabs)/hub layout (ORCH-0826 + M0-rework) — Hub tab shell.
 *
 * Renders the canonical Hub chrome:
 *   1. TopBar (brand chip + universal "+" creator trigger)
 *   2. HubSubNav (Events / Experiences / Trips pills)
 *   3. <Slot /> — the active sub-route
 *
 * Sub-routes (`events.tsx`, `experiences.tsx`, `trips.tsx`) render
 * content only. They do NOT render their own TopBar — that produced a
 * duplicate "Events" header rendered BELOW the sub-tab pills in the
 * initial M0 layout (operator-flagged 2026-05-14).
 *
 * Mirrors `marketing/_layout.tsx` pattern: layout owns chrome + brand
 * switcher + universal creator state; sub-routes own content state.
 *
 * Mingla_Artifacts/specs/SPEC_ORCH-0826_M0_HUB_FOUNDATION.md §6.5
 */

import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Slot, usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandDeleteSheet } from "../../../src/components/brand/BrandDeleteSheet";
import { BrandSwitcherSheet } from "../../../src/components/brand/BrandSwitcherSheet";
import { DeckReadinessCard } from "../../../src/components/venue/DeckReadinessCard";
import { HubSubNav } from "../../../src/components/hub/HubSubNav";
import { VenueClaimStatusBanner } from "../../../src/components/brand/VenueClaimStatusBanner";
import { useCurrentBrand } from "../../../src/hooks/useCurrentBrand";
import { useBrandPlacePipelineState } from "../../../src/hooks/useBrandPlacePipelineState";
import {
  persistHubLastTab,
  useHubInitialTab,
  useHubVisibleTabs,
  type HubTabName,
} from "../../../src/hooks/useHubTabs";
import { useVenueClaimRefresh } from "../../../src/hooks/useVenueClaimRefresh";
import { IconChrome } from "../../../src/components/ui/IconChrome";
import { TopBar } from "../../../src/components/ui/TopBar";
import { UniversalCreatorSheet } from "../../../src/components/ui/UniversalCreatorSheet";
import { canvas, spacing } from "../../../src/constants/designSystem";
import { useAuth } from "../../../src/context/AuthContext";
import {
  useCurrentBrandStore,
  type Brand,
} from "../../../src/store/currentBrandStore";
import { routeForPipelineStateFix } from "../../../src/utils/deckReadinessRoutes";

export default function HubTabLayout(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const setCurrentBrand = useCurrentBrandStore((s) => s.setCurrentBrand);
  const currentBrand = useCurrentBrand();
  const pipelineState = useBrandPlacePipelineState(currentBrand?.id ?? null);
  const visibleTabs = useHubVisibleTabs(currentBrand?.id ?? null);
  const initialTab = useHubInitialTab(
    currentBrand?.id ?? null,
    visibleTabs.data ?? [],
  );
  useVenueClaimRefresh();

  const [brandSheetVisible, setBrandSheetVisible] = useState<boolean>(false);
  const [isUniversalCreatorOpen, setIsUniversalCreatorOpen] = useState<boolean>(false);
  const [deleteSheetVisible, setDeleteSheetVisible] = useState<boolean>(false);
  const [brandPendingDelete, setBrandPendingDelete] = useState<Brand | null>(null);

  const handleOpenSwitcher = useCallback((): void => {
    setBrandSheetVisible(true);
  }, []);

  const handleCloseSwitcher = useCallback((): void => {
    setBrandSheetVisible(false);
  }, []);

  const handleBrandCreated = useCallback(
    (brand: Brand): void => {
      setCurrentBrand(brand);
    },
    [setCurrentBrand],
  );

  const handleRequestDeleteBrand = useCallback((brand: Brand): void => {
    setBrandPendingDelete(brand);
    setDeleteSheetVisible(true);
  }, []);

  const handleCloseDeleteSheet = useCallback((): void => {
    setDeleteSheetVisible(false);
    // Don't clear brandPendingDelete immediately — exit animation reads it.
  }, []);

  const handleBrandDeleted = useCallback((): void => {
    const deleted = brandPendingDelete;
    setDeleteSheetVisible(false);
    if (deleted !== null) {
      setCurrentBrand(null);
    }
  }, [brandPendingDelete, setCurrentBrand]);

  useEffect(() => {
    if (visibleTabs.data === undefined || initialTab === null) return;
    const activePath = pathname.toLowerCase();
    const active: HubTabName = activePath.includes("/hub/getstarted")
      ? "getstarted"
      : activePath.includes("/hub/trips")
        ? "trips"
        : activePath.includes("/hub/experiences")
          ? "experiences"
          : "events";
    if (!visibleTabs.data.includes(active)) {
      router.replace(`/(tabs)/hub/${initialTab}` as never);
    }
  }, [initialTab, pathname, router, visibleTabs.data]);

  const handleHubTabPress = useCallback((tab: HubTabName): void => {
    persistHubLastTab(tab);
  }, []);

  const handleDeckReadinessFix = useCallback(
    (fix: string): void => {
      if (currentBrand === null) return;
      router.push(
        routeForPipelineStateFix({
          brandId: currentBrand.id,
          state: pipelineState.data,
          fix,
        }) as never,
      );
    },
    [currentBrand, pipelineState.data, router],
  );

  return (
    <View style={[styles.host, { paddingTop: insets.top }]}>
      <View style={styles.barWrap}>
        <TopBar
          leftKind="brand"
          onBrandTap={handleOpenSwitcher}
          extraRightSlot={
            <IconChrome
              icon="plus"
              size={36}
              onPress={() => setIsUniversalCreatorOpen(true)}
              accessibilityLabel="Create event, experience, or trip"
              testID="hub-universal-creator-button"
            />
          }
        />
      </View>
      <HubSubNav
        visibleTabs={visibleTabs.data}
        counts={{
          events: visibleTabs.counts?.events,
          trips: visibleTabs.counts?.trips,
          experiences: visibleTabs.counts?.experiences,
        }}
        loading={visibleTabs.isLoading}
        onTabPress={handleHubTabPress}
      />
      <VenueClaimStatusBanner brand={currentBrand} />
      {pipelineState.data !== null &&
      pipelineState.data !== undefined &&
      pipelineState.data.status !== "draft" ? (
        <View style={styles.readinessWrap}>
          <DeckReadinessCard
            state={pipelineState.data}
            onFix={handleDeckReadinessFix}
          />
        </View>
      ) : null}
      <Slot />
      <BrandSwitcherSheet
        visible={brandSheetVisible}
        onClose={handleCloseSwitcher}
        onBrandCreated={handleBrandCreated}
        onRequestDeleteBrand={handleRequestDeleteBrand}
      />
      <UniversalCreatorSheet
        visible={isUniversalCreatorOpen}
        onClose={() => setIsUniversalCreatorOpen(false)}
      />
      <BrandDeleteSheet
        visible={deleteSheetVisible}
        brand={brandPendingDelete}
        accountId={user?.id ?? null}
        onClose={handleCloseDeleteSheet}
        onDeleted={handleBrandDeleted}
      />
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
  readinessWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
});
