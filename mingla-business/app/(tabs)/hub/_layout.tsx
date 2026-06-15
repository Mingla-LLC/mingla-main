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

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Slot, usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BusinessTodoToggle } from "../../../src/components/home/BusinessTodoToggle";
import { HubSubNav } from "../../../src/components/hub/HubSubNav";
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
import { canvas, spacing } from "../../../src/constants/designSystem";
import { useAuth } from "../../../src/context/AuthContext";
import {
  useCurrentBrandStore,
  type Brand,
} from "../../../src/store/currentBrandStore";
import { useHubCreatorStore } from "../../../src/store/hubCreatorStore";
import type { BusinessTodo } from "../../../src/utils/businessTodos";

const LazyBrandSwitcherSheet = React.lazy(async () => {
  const mod = await import("../../../src/components/brand/BrandSwitcherSheet");
  return { default: mod.BrandSwitcherSheet };
});

const LazyBrandDeleteSheet = React.lazy(async () => {
  const mod = await import("../../../src/components/brand/BrandDeleteSheet");
  return { default: mod.BrandDeleteSheet };
});

const LazyInvitePendingSheet = React.lazy(async () => {
  const mod = await import("../../../src/components/team/InvitePendingSheet");
  return { default: mod.InvitePendingSheet };
});
const LazyUniversalCreatorSheet = React.lazy(async () => {
  const mod = await import("../../../src/components/ui/UniversalCreatorSheet");
  return { default: mod.UniversalCreatorSheet };
});

export default function HubTabLayout(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const setCurrentBrand = useCurrentBrandStore((s) => s.setCurrentBrand);
  const currentBrand = useCurrentBrand();
  const todos = useBusinessTodos();
  // ORCH-1145 — venue visibility for the conditional "Venue" pill. Computed
  // from the already-resolved currentBrand (NO second brand fetch); mirrors the
  // retired brand-page `showVenueListing` gate.
  const venueVisibility = React.useMemo(
    () => ({
      hasPhysicalLocation: currentBrand?.hasPhysicalLocation === true,
      hasPlacePool: currentBrand?.placePoolId != null,
    }),
    [currentBrand?.hasPhysicalLocation, currentBrand?.placePoolId],
  );
  const visibleTabs = useHubVisibleTabs(
    currentBrand?.id ?? null,
    venueVisibility,
  );
  const initialTab = useHubInitialTab(
    currentBrand?.id ?? null,
    visibleTabs.data ?? [],
  );
  useVenueClaimRefresh();

  const [brandSheetVisible, setBrandSheetVisible] = useState<boolean>(false);
  const [isUniversalCreatorOpen, setIsUniversalCreatorOpen] = useState<boolean>(false);
  // META-ORCH-1059 — a Hub SUB-route empty state ("Create your first offering")
  // opens the SAME chooser via this shared flag (sub-routes can't reach the
  // layout's local state). Mirror it into the local state + clear the flag.
  const creatorRequestOpen = useHubCreatorStore((s) => s.isOpen);
  const closeCreatorRequest = useHubCreatorStore((s) => s.close);
  useEffect(() => {
    if (creatorRequestOpen) {
      setIsUniversalCreatorOpen(true);
      closeCreatorRequest();
    }
  }, [creatorRequestOpen, closeCreatorRequest]);
  const [deleteSheetVisible, setDeleteSheetVisible] = useState<boolean>(false);
  const [brandPendingDelete, setBrandPendingDelete] = useState<Brand | null>(null);
  // ORCH-1111 — pending-invite Accept/Decline sheet (Hub shares the same
  // smart To-Do list as Home, so the invite row + its action must work here too).
  const [pendingInvite, setPendingInvite] = useState<{
    invitationId: string;
    brandName: string;
  } | null>(null);

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
    // META-ORCH-1059 fold-in fix: this layout stays MOUNTED while the user
    // pushes a route OUTSIDE the hub group (e.g. /experience/{id} from a hub
    // list row). When that happens `pathname` is no longer a `/hub/...` path,
    // so the old code fell through to `active="events"`, found that a
    // restaurant/experiences-only brand's visibleTabs do NOT include "events",
    // and fired `router.replace('/(tabs)/hub/...')` — yanking the user back to
    // the hub mid-transition (the operator's "swipe animates in then bounces
    // back + nav locks"). Only run the visible-tab redirect when we are
    // actually ON a hub sub-route; never hijack navigation to another stack.
    if (!activePath.includes("/hub/")) return;
    const active: HubTabName = activePath.includes("/hub/getstarted")
      ? "getstarted"
      : activePath.includes("/hub/trips")
        ? "trips"
        : activePath.includes("/hub/experiences")
          ? "experiences"
          : // ORCH-1145 — the Venue tab route file is `listing.tsx`.
            activePath.includes("/hub/listing")
            ? "venue"
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
        case "open_pending_invite":
          // ORCH-1111 — open the Accept/Decline sheet for this invite.
          setPendingInvite({
            invitationId: todo.action.invitationId,
            brandName: todo.action.brandName,
          });
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
    <View
      style={[
        styles.host,
        {
          paddingTop: insets.top + (Platform.OS === "web" ? spacing.sm : 0),
        },
      ]}
    >
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
      {/* META-ORCH-1059 — the venue-claim "being reviewed" blue box was removed
          from Hub (operator: redundant — the brand-page venue listing already
          shows claim status). A pending/under-review claim now surfaces as a
          smart row in the shared to-do toggle above (see buildBusinessTodos). */}
      <Slot />
      {brandSheetVisible ? (
        <Suspense fallback={null}>
          <LazyBrandSwitcherSheet
            visible
            onClose={handleCloseSwitcher}
            onBrandCreated={handleBrandCreated}
            onRequestDeleteBrand={handleRequestDeleteBrand}
          />
        </Suspense>
      ) : null}
      {isUniversalCreatorOpen ? (
        <Suspense fallback={null}>
          <LazyUniversalCreatorSheet
            visible
            onClose={() => setIsUniversalCreatorOpen(false)}
          />
        </Suspense>
      ) : null}
      {pendingInvite !== null ? (
        <Suspense fallback={null}>
          <LazyInvitePendingSheet
            visible
            invitationId={pendingInvite.invitationId}
            brandName={pendingInvite.brandName}
            onClose={() => setPendingInvite(null)}
          />
        </Suspense>
      ) : null}
      {deleteSheetVisible ? (
        <Suspense fallback={null}>
          <LazyBrandDeleteSheet
            visible
            brand={brandPendingDelete}
            accountId={user?.id ?? null}
            onClose={handleCloseDeleteSheet}
            onDeleted={handleBrandDeleted}
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
  todoWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
});
