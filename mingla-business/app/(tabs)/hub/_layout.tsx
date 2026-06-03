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
import { BusinessTodoToggle } from "../../../src/components/home/BusinessTodoToggle";
import { HubSubNav } from "../../../src/components/hub/HubSubNav";
import { VenueClaimStatusBanner } from "../../../src/components/brand/VenueClaimStatusBanner";
import { VenueClaimFeedbackSheet } from "../../../src/components/brand/VenueClaimFeedbackSheet";
import { useVenueClaimOpenCount } from "../../../src/hooks/useVenueClaimFeedback";
import { Toast, type ToastKind } from "../../../src/components/ui/Toast";
import { useBusinessTodos } from "../../../src/hooks/useBusinessTodos";
import { useCurrentBrand } from "../../../src/hooks/useCurrentBrand";
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
import type { BusinessTodo } from "../../../src/utils/businessTodos";

export default function HubTabLayout(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const setCurrentBrand = useCurrentBrandStore((s) => s.setCurrentBrand);
  const currentBrand = useCurrentBrand();
  const todos = useBusinessTodos();
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
  // ORCH-1064 — venue-claim feedback sheet + single Toast host for the Hub.
  const [feedbackSheetVisible, setFeedbackSheetVisible] = useState<boolean>(false);
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(
    null,
  );

  const openCount = useVenueClaimOpenCount(
    currentBrand?.id ?? null,
    currentBrand?.claimFollowUpAt ?? null,
  );

  const showToast = useCallback((message: string, kind: ToastKind): void => {
    setToast({ message, kind });
  }, []);

  const handleOpenFeedback = useCallback((): void => {
    setFeedbackSheetVisible(true);
  }, []);

  const handleCloseFeedback = useCallback((): void => {
    setFeedbackSheetVisible(false);
  }, []);

  const handleResubmitted = useCallback((): void => {
    setFeedbackSheetVisible(false);
    showToast("Re-submitted — we'll take another look.", "success");
  }, [showToast]);

  const handleFeedbackActionError = useCallback(
    (message: string): void => {
      showToast(message, "warn");
    },
    [showToast],
  );

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

  const handleTodoAction = useCallback(
    (todo: BusinessTodo): void => {
      switch (todo.action.kind) {
        case "open_brand_switcher":
          setBrandSheetVisible(true);
          return;
        case "open_universal_creator":
          setIsUniversalCreatorOpen(true);
          return;
        case "route":
          router.push(todo.action.route as never);
          return;
        default: {
          const _exhaustive: never = todo.action;
          return _exhaustive;
        }
      }
    },
    [router],
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
      {/* ORCH-1038 — unified smart to-do toggle, flush under the top bar and
          ABOVE the sub-nav pills; same component + list as Home. */}
      <View style={styles.todoWrap}>
        <BusinessTodoToggle
          todos={todos}
          onAction={handleTodoAction}
          testID="hub-todo-toggle"
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
      <VenueClaimStatusBanner
        brand={currentBrand}
        openCount={openCount}
        onPressFeedback={handleOpenFeedback}
      />
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
      {/* ORCH-1064 — venue-claim feedback sheet + the single Hub Toast host. */}
      <VenueClaimFeedbackSheet
        visible={feedbackSheetVisible}
        brand={currentBrand ?? null}
        accountId={user?.id ?? null}
        onClose={handleCloseFeedback}
        onResubmitted={handleResubmitted}
        onActionError={handleFeedbackActionError}
      />
      <Toast
        visible={toast !== null}
        kind={toast?.kind ?? "info"}
        message={toast?.message ?? ""}
        onDismiss={() => setToast(null)}
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
  todoWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
});
