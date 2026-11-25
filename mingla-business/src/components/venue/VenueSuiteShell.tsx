/**
 * META-ORCH-1148 sub-ORCH 2.0 — the Venue Suite SHELL.
 *
 * The suite container mounted by the Hub Venue tab. OWNS the `activeModule`
 * state machine and renders the responsive shell:
 *  - web desktop (isWideDesktop): a two-column master rail + workspace,
 *    left-anchored and filling the full page width (ORCH-1184 removed the
 *    1200px cap); the Hub chrome stays above.
 *  - web-phone + native: single column. The module nav is the venue module pill
 *    row, which on native/web-phone REPLACES the Hub offering pills via the
 *    `venueSuiteStore` bridge (rendered in `_layout.tsx`). The shell renders the
 *    pill row inline ONLY as a fallback when the layout bridge isn't driving it
 *    — to avoid a double row, the inline row is shown only on web-phone where
 *    the layout swap also applies; the layout is the single owner. (Native: the
 *    layout owns the row; the shell does not duplicate it.)
 *
 * Module dispatch (NO dead taps, §6):
 *  - overview  → VenueIntelligenceModule (ORCH-1186-B venue intelligence
 *                dashboard) + a reservations-activation card when the toggle is
 *                OFF. (The listing recap relocated to Settings in Leg 1.)
 *  - settings  → <VenueSettingsModule>.
 *  - booking   → live operator modules: Tables (2.1a) · Availability (2.1a) ·
 *                Reservations (2.1b) · Waitlist (2.1b). No ComingSoon left.
 *
 * Bands C/D are not in the module union → cannot be selected → cannot dead-tap.
 *
 * META-ORCH-1255 Leg B — VENUE-SCOPED: the shell takes `venueId` and passes it
 * to every module + the reservations-settings hooks, so everything on screen
 * belongs to ONE venue_listings row. Lineage note for the ORCH-1040/1145
 * source contract: the venue tab originally mounted `VenueListingContent`
 * with `chromeMode="tab"` directly; ORCH-1186 relocated that listing recap
 * into the Settings module, and 1255 hosts this shell on the pushed
 * per-venue page (`/venue/{venueId}`) instead of the Hub tab. `VenueMenuModule`
 * stays brand-keyed ([TRANSITIONAL-3] — menus are brand-level content).
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { loadVenueHostScreens } from "./host/venueHostOwner";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";
import { router, useNavigation } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  color,
  space,
  type,
} from "../../constants/designSystem";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import {
  useMyVenueAccess,
  type MyVenueAccess,
} from "../../hooks/useMyVenueAccess";
import { useVenueReservationSettings } from "../../hooks/useVenueReservationSettings";
import { useSetVenueFeature, useVenueFeatures } from "../../hooks/useVenueFeatures";
import { VenueFeatureError } from "../../services/venueFeaturesService";
import {
  VENUE_FEATURE_KEYS,
  backfilledFeatureSet,
  builtPreset,
  featureSetFrom,
  type VenueFeatureKey,
  type VenueTypeKey,
} from "../../types/venueFeatures";
import { useVenueSuiteStore } from "../../store/venueSuiteStore";
import type { VenueModule } from "../../types/venueReservation";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { SuiteDesktopShell } from "../suite/SuiteDesktopShell";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { QueryClientContext } from "@tanstack/react-query";
import { venueFeatureKeys } from "../../hooks/venueFeatureKeys";
import { FeatureSetupNeedsCard } from "./features/FeatureSetupNeedsCard";
import { featureSetupNeeds, type SetupRefusal, type SetupTarget } from "./features/featureSetupModel";
import {
  filterVenueModulesForCapabilities,
  scopedStaffManagesOffers,
  withCloseAccess,
  withStationsAccess,
  withTillAccess,
} from "./venueCapabilityGate";
import { venueWriteErrorCopy } from "./features/venueFeaturesCopy";

/** Lazy ConfirmDialog / Toast — both pull reanimated and red node/web suites
 * that mount VenueSuiteShell (e.g. #2737 shellScroll render proof). */
const LazyConfirmDialog = React.lazy(async () => {
  const mod = await import("../ui/ConfirmDialog");
  return { default: mod.ConfirmDialog };
});
const LazyToast = React.lazy(async () => {
  const mod = await import("../ui/Toast");
  return { default: mod.Toast };
});
import type { VenueAvailabilityLeaveHandle } from "./VenueAvailabilityModule";
import { VenueIntelligenceModule } from "./VenueIntelligenceModule";
import { VenueMenuModule } from "./VenueMenuModule";
import { VenueReservationsModule } from "./VenueReservationsModule";
import {
  VenueSettingsModule,
  type VenueSettingsLeaveHandle,
} from "./VenueSettingsModule";
import { VenueTablesModule } from "./VenueTablesModule";
import { VenueWaitlistModule } from "./VenueWaitlistModule";
import {
  formatLeaveChangedBody,
  sectionLabelForModule,
  type VenueModuleLeaveHandle,
} from "./venueLeaveContract";
import { deriveVenueRailModules } from "./venueRail";
import { useTillReleased } from "../../hooks/useTillReleased";
import { tillHref, TillLauncher } from "./till/TillLauncher";
import { stationHref, StationsLauncher } from "./station/StationsLauncher";
import { closeHref, DayCloseLauncher } from "./close/DayCloseLauncher";
import { moduleSelfScrolls, venueScrollBottomPad } from "./venueShellScroll";
import {
  deriveVenueNav,
  hasNoStoredFeatures,
  resolveTablesAlias,
  shouldLeaveHiddenModule,
  venueOrderEntry,
  venueUsesSpaces,
  withVenueReviewsModule,
} from "./venueModules";

export { deriveVenueRailModules } from "./venueRail";

/**
 * Issue #1735 CI rework — the Insights module loads behind a HOST-owned lazy
 * boundary (the GlobalSearchSheetHost precedent; the #1550 rule: hosts own
 * code-splitting). Two loads it keeps out of the EAGER path: (a) the web
 * boot payload — the full instrument/watch/report tree pushed __common past
 * the ORCH-1083 cap; (b) the analytics→posthog→expo-modules-core chain,
 * which throws at module scope under the stay/venue render-proof configs.
 * The factory runs only when the Insights branch first RENDERS.
 */
const LazyVenueInsightsModule = React.lazy(async () => {
  const mod = await import("./insights/VenueInsightsModule");
  return { default: mod.VenueInsightsModule };
});

/**
 * Issue #1791 (#1767 Phase 3) — the Orders queue loads behind the SAME
 * host-owned lazy boundary, and this is not decoration. Phase 1 hit a
 * web-render import-chain bug for exactly this reason: the module pulls in the
 * bottom-sheet primitive (`Sheet` -> `SheetMobile` -> @gorhom/bottom-sheet) and
 * `lucide-react-native`, both of which are native-only chains that throw at
 * MODULE SCOPE under the stay/venue web render configs. An eager import here
 * would drag them into every one of those configs whether the Orders branch
 * ever renders or not. The factory runs only when the branch first RENDERS.
 * (The #1550 rule: hosts own code-splitting.)
 */
const LazyVenueOrdersModule = React.lazy(async () => {
  return { default: (await loadVenueHostScreens()).VenueOrdersModule };
});

/**
 * #4490 — the classic Availability module shares its Table times with
 * "Availability & pricing", so it loads from the same Host venue owner.
 */
const LazyVenueAvailabilityModule = React.lazy(async () => {
  return { default: (await loadVenueHostScreens()).VenueAvailabilityModule };
});

/**
 * #4490 — every feature module loads through the ONE Host venue owner
 * (host/venueHostOwner.ts): Spaces and Availability & pricing pull Sheet,
 * pickers and the site plan, none of which the eager shell needs, and one
 * owner keeps what the modules share out of the eager web __common chunk.
 */
const LazyVenueSpacesModule = React.lazy(async () => {
  return { default: (await loadVenueHostScreens()).VenueSpacesModule };
});
const LazyVenueAvailabilityPricingModule = React.lazy(async () => {
  return { default: (await loadVenueHostScreens()).VenueAvailabilityPricingModule };
});
// #4490 P2 — Offers (with the Entry editor), Today, Check-in and the Overview
// day header, each its own host-owned lazy boundary (Sheet, Modal, pickers,
// the QR encoder and the web camera never reach the eager shell).
const LazyVenueOffersModule = React.lazy(async () => {
  return { default: (await loadVenueHostScreens()).VenueOffersModule };
});
const LazyVenueTodayModule = React.lazy(async () => {
  return { default: (await loadVenueHostScreens()).VenueTodayModule };
});
const LazyVenueCheckInModule = React.lazy(async () => {
  return { default: (await loadVenueHostScreens()).VenueCheckInModule };
});
const LazyVenueGuestListModule = React.lazy(async () => {
  return { default: (await loadVenueHostScreens()).VenueGuestListModule };
});
// #4490 P4 — Requests and Calendar (private hire), own lazy boundaries.
const LazyVenueRequestsModule = React.lazy(async () => {
  return { default: (await loadVenueHostScreens()).VenueRequestsModule };
});
const LazyVenueCalendarModule = React.lazy(async () => {
  return { default: (await loadVenueHostScreens()).VenueCalendarModule };
});
// #4490 P6 — Members (plans and the plan editor inside), own lazy boundary.
const LazyVenueMembersModule = React.lazy(async () => {
  return { default: (await loadVenueHostScreens()).VenueMembersModule };
});
const LazyEventsHereCard = React.lazy(async () => {
  return { default: (await loadVenueHostScreens()).EventsHereCard };
});
const LazyVenueTodayOverview = React.lazy(async () => {
  return { default: (await loadVenueHostScreens()).VenueTodayOverview };
});

/** All built features on: scoped staff's loading frame never shows "no pages". */
const PENDING_SCOPED_FEATURES = featureSetFrom(
  Object.fromEntries(VENUE_FEATURE_KEYS.map((key) => [key, true])) as Record<
    VenueFeatureKey,
    boolean
  >,
);

// #4188 post-merge production regression — keep the fail-closed access answer
// referentially stable while the permission RPC is loading or unavailable.
// `visibleModules` is mirrored into the shared suite store below; allocating a
// fresh empty capability array on every render made that store publish forever
// when the parent layout subscribed to it (React #185 / maximum update depth).
const PENDING_VENUE_ACCESS: MyVenueAccess = {
  scoped: true,
  capabilities: [],
  canSell: false,
};

export interface VenueSuiteShellProps {
  brandId: string | null;
  /** META-ORCH-1255 — the venue every module is scoped to. */
  venueId?: string | null;
  focus?: "feedback";
  initialModule?: VenueModule;
  /**
   * #4420 B8 — content that scrolls with the Overview dashboard, at its top
   * (the page's Local reviews panel). Never pinned above the scroll.
   */
  overviewHeader?: React.ReactNode;
  /**
   * #4420 (round-3 item 19) — the page's Mingla Local reviews panel, shown as
   * its own Reviews module (right after Overview). `null` (no verified place)
   * hides the module.
   */
  reviewsPanel?: React.ReactNode;
  /**
   * #4420 (R8 P19) — the one-line Reviews summary at the top of Overview; the
   * shell hands it the handler that opens the Reviews module. Shown only when
   * the Reviews module is.
   */
  renderReviewsSummary?: (openReviews: () => void) => React.ReactNode;
  /** #4490 — `&item=<id>`: open that offer on arrival (with `?module=offers`). */
  initialItemId?: string | null;
  /**
   * #4490 N11: told every time the open module changes after the first
   * paint, so the page can keep `?module=` in the address (reload, Back and a
   * shared link open the same module).
   */
  onModuleChange?: (module: VenueModule) => void;
}

export function VenueSuiteShell({
  brandId,
  venueId = null,
  focus,
  initialModule = "overview",
  overviewHeader = null,
  reviewsPanel = null,
  renderReviewsSummary,
  initialItemId = null,
  onModuleChange,
}: VenueSuiteShellProps): React.ReactElement {
  const { isWideDesktop } = useResponsiveLayout();
  const insets = useSafeAreaInsets();
  // Bottom-nav clearance — the floating BottomNav primitive (64px) + its
  // floating margin + the device home-indicator inset. `insets.bottom + 120`
  // is the shared nav-lock companion-pin pattern used by every Hub tab
  // (app/(tabs)/hub/events.tsx) and by VenueListingContent in tab mode, so the
  // last content row clears the nav on native + web-phone.
  const scrollBottomPad = venueScrollBottomPad(insets.bottom);

  const settingsQuery = useVenueReservationSettings(brandId, venueId);
  const reservationsEnabled = settingsQuery.data?.reservationsEnabled ?? false;
  // #3389 — `data` is `null` for "no settings row" (a resolved OFF) and a
  // settings object once the row loads. It stays `undefined` while loading AND
  // when the first request fails: a failed request is NOT a confirmed OFF, so
  // it must not bounce a `?module=tables` deep link to Overview — otherwise the
  // requested module is lost by the time the retry succeeds. (A refetch that
  // fails after a successful load keeps the last `data`, so that answer holds.)
  const settingsResolved = settingsQuery.data !== undefined;
  const venueAccessQuery = useMyVenueAccess(venueId);
  // #4490 P2 — a brand scanner reads as scoped with venue.check_in (useMyVenueAccess).
  const venueAccess = venueAccessQuery.data ?? PENDING_VENUE_ACCESS;

  // #4490 — the nav derives from venue_features
  // (I-4490-VENUE-FEATURES-GATE-SUITE). Until the features read answers, the venue reads as its backfill
  // (the old reservations switch), so the loading frame shows today's list and
  // never flashes a different workspace.
  const featuresQuery = useVenueFeatures(brandId, venueId);
  const setFeature = useSetVenueFeature(brandId, venueId);
  // #4490 spec 08 O1 — the Till's release switch (fails closed).
  const tillReleased = useTillReleased();
  // A failed features read falls back to the backfill rule (the old
  // reservations switch), which is exactly what the server derives for a
  // venue without stored rows — so it counts as resolved once the settings
  // answer, and the #3389 bounce still works when only the features read fails.
  const featuresResolved =
    featuresQuery.data !== undefined || (featuresQuery.isError && settingsResolved);
  const features = useMemo(
    () =>
      featuresQuery.data?.features ??
      (venueAccess.scoped && !settingsResolved
        ? PENDING_SCOPED_FEATURES
        : backfilledFeatureSet({ reservationsEnabled })),
    [featuresQuery.data, reservationsEnabled, settingsResolved, venueAccess.scoped],
  );
  const tableReservationsOn = features.table_reservations.enabled;
  // #4490 click-test D12 — features, not types: the "Take table reservations"
  // invitation shows only while the feature is off AND the venue's type
  // usually starts with it (restaurant, bar and lounge, club). A play venue
  // is not asked to set tables.
  // Type unknown (the features read failed) keeps the old invitation.
  const featuresCategory = featuresQuery.data?.venueCategory ?? null;
  const showReservationsInvite =
    !tableReservationsOn &&
    (featuresCategory === null ||
      builtPreset(featuresCategory as VenueTypeKey).includes("table_reservations"));
  const requestSpacesInStore = useVenueSuiteStore((s) => s.requestSpaces);
  // #4490 N20/N61: what the add-venue Features step asked for and the server
  // refused (cache only: written by the create call), plus anything switched
  // on that still waits for a space.
  // #4490 fix 2: read from the cache through the context, not useQuery, so a
  // shell mounted without a query client (the module render tests) still
  // renders; the create call writes this before the venue page opens.
  const shellQueryClient = React.useContext(QueryClientContext);
  const startRefusedQuery = {
    data:
      shellQueryClient === undefined
        ? undefined
        : shellQueryClient.getQueryData<SetupRefusal[]>(venueFeatureKeys.startRefused(venueId ?? "")),
  };
  const setupNeeds = useMemo(
    () =>
      featuresQuery.data === undefined
        ? []
        : featureSetupNeeds({
            features: featuresQuery.data.features,
            activeSpaceCount: featuresQuery.data.activeSpaceCount,
            refused: startRefusedQuery.data ?? null,
          }),
    [featuresQuery.data, startRefusedQuery.data],
  );
  const setupNeedsSpace = setupNeeds.some((n) => n.target === "spaces");
  const spacesRequestedVenueId = useVenueSuiteStore((s) => s.spacesRequestedVenueId);
  const navInput = useMemo(
    () => ({
      features,
      activeSpaceCount: featuresQuery.data?.activeSpaceCount ?? 0,
      // #4490 N61/N62: no stored rows → the nav follows the type's preset.
      venueCategory: featuresQuery.data?.venueCategory ?? null,
      noStoredFeatures: featuresQuery.data !== undefined && hasNoStoredFeatures(featuresQuery.data.features),
      spacesRequested:
        (venueId !== null && spacesRequestedVenueId === venueId) ||
        // #4490 N20: a chosen feature waiting for a space opens Spaces.
        setupNeedsSpace ||
        scopedStaffManagesOffers(venueAccess.scoped, venueAccess.capabilities),
      tillReleased: tillReleased && venueId !== null,
    }),
    [
      features,
      featuresQuery.data,
      tillReleased,
      setupNeedsSpace,
      spacesRequestedVenueId,
      venueAccess.capabilities,
      venueAccess.scoped,
      venueId,
    ],
  );
  const usesSpaces = venueUsesSpaces(navInput);
  // #4490 spec 08 O1 — the pad/Till switch (one rule: venueOrderEntry).
  const orderEntry = venueOrderEntry({
    tillReleased: tillReleased && venueId !== null,
    tillFeatureOn: features.till.enabled,
    canSell: venueAccess.canSell === true,
  });

  const hasReviews = reviewsPanel !== null && reviewsPanel !== undefined;
  const visibleModules = useMemo(
    () => withVenueReviewsModule(
      withCloseAccess(
        withStationsAccess(
          withTillAccess(
            filterVenueModulesForCapabilities(
              deriveVenueNav(navInput),
              venueAccess.scoped,
              venueAccess.capabilities,
            ),
            venueAccess.canSell === true,
          ),
          venueAccess.canKitchen === true,
        ),
        venueAccess.canManageMoney === true,
      ),
      hasReviews,
    ),
    [hasReviews, navInput, venueAccess.scoped, venueAccess.capabilities, venueAccess.canSell, venueAccess.canKitchen,
      venueAccess.canManageMoney],
  );

  const [activeModule, setActiveModule] = useState<VenueModule>(initialModule);
  const lastToldModuleRef = useRef<VenueModule>(initialModule);
  useEffect(() => {
    if (lastToldModuleRef.current === activeModule) return;
    lastToldModuleRef.current = activeModule;
    onModuleChange?.(activeModule);
  }, [activeModule, onModuleChange]);
  // #4490 P4 — the Calendar opens a hold or a request in Requests.
  const [requestItem, setRequestItem] = useState<string | null>(null);
  const availabilityRef = useRef<VenueAvailabilityLeaveHandle | null>(null);
  const settingsRef = useRef<VenueSettingsLeaveHandle | null>(null);
  const offersRef = useRef<VenueModuleLeaveHandle | null>(null);
  // #4490 P5 — Spaces holds the floor editor (unsaved layouts guard leaving).
  const spacesRef = useRef<VenueModuleLeaveHandle | null>(null);
  // #4490 P6 — Members holds the plan editor; Offers › Membership opens it on a new plan.
  const membersRef = useRef<VenueModuleLeaveHandle | null>(null);
  const [membersView, setMembersView] = useState<"members" | "plans" | "new_plan">("members");
  useEffect(() => {
    // Opening Members from the rail later starts on the members list again.
    if (activeModule !== "members") setMembersView("members");
  }, [activeModule]);
  const [spacesView, setSpacesView] = useState<"list" | "site" | "tables" | undefined>(
    initialModule === "tables" ? "tables" : undefined,
  );
  const [spacesSpaceId, setSpacesSpaceId] = useState<string | null>(null);
  const leaveHandlesRef = useRef<
    Partial<Record<VenueModule, VenueModuleLeaveHandle>>
  >({});
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveSaving, setLeaveSaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [leaveToast, setLeaveToast] = useState<string | null>(null);
  const pendingLeaveRef = useRef<{
    proceed: () => void;
    restoreFocus: (() => void) | null;
    fromModule: VenueModule;
  } | null>(null);
  /** Set before resumed navigation after leave save/discard so beforeRemove
   * does not open a second prompt while dirty clears on the next paint. */
  const sanctionedExitRef = useRef(false);

  const getLeaveHandle = useCallback(
    (module: VenueModule): VenueModuleLeaveHandle | null => {
      if (leaveHandlesRef.current[module] !== undefined) {
        return leaveHandlesRef.current[module] ?? null;
      }
      if (module === "settings") return settingsRef.current;
      if (module === "offers") return offersRef.current;
      if (module === "spaces") return spacesRef.current;
      if (module === "members") return membersRef.current;
      return null;
    },
    [],
  );

  const selectModule = useCallback(
    (nextModule: VenueModule, restoreFocus?: () => void): void => {
      // #4490 spec 08 O1 — the Till is a full-screen route outside the rail:
      // the rail item opens it; the workspace (and any unsaved edit in it)
      // stays where it was underneath.
      if (nextModule === "till" && venueId !== null) {
        router.push(tillHref(venueId) as never);
        return;
      }
      // #4490 spec 08 O3 — Kitchen and bar is a full-screen route too.
      if (nextModule === "stations" && venueId !== null) {
        router.push(stationHref(venueId) as never);
        return;
      }
      // #4490 spec 08 O5 part B — Close the day is a full-screen route too.
      if (nextModule === "close" && venueId !== null) {
        router.push(closeHref(venueId) as never);
        return;
      }
      if (nextModule === activeModule) return;

      if (activeModule === "availability" && availabilityRef.current !== null) {
        // Availability owns its leave dialog (upgraded to variant=leave).
        availabilityRef.current.requestLeave(
          () => setActiveModule(nextModule),
          restoreFocus,
        );
        return;
      }

      const handle = getLeaveHandle(activeModule);
      if (handle !== null && handle.isDirty()) {
        pendingLeaveRef.current = {
          proceed: () => setActiveModule(nextModule),
          restoreFocus: restoreFocus ?? null,
          fromModule: activeModule,
        };
        setLeaveError(null);
        setLeaveOpen(true);
        return;
      }
      setActiveModule(nextModule);
    },
    [activeModule, getLeaveHandle, venueId],
  );

  // #4490 spec 08 O1 — `?module=till` (a link or a reload) opens the Till
  // itself once it is shown here; the address is replaced so Back from the
  // Till never lands on a page that sends it straight back.
  const tillDeepLinkRef = useRef(initialModule === "till");
  useEffect(() => {
    if (!tillDeepLinkRef.current || venueId === null) return;
    if (!visibleModules.includes("till")) return;
    tillDeepLinkRef.current = false;
    router.replace(tillHref(venueId) as never);
  }, [venueId, visibleModules]);
  // #4490 spec 08 O3 — `?module=stations` opens the station screen the same way.
  const stationsDeepLinkRef = useRef(initialModule === "stations");
  useEffect(() => {
    if (!stationsDeepLinkRef.current || venueId === null) return;
    if (!visibleModules.includes("stations")) return;
    stationsDeepLinkRef.current = false;
    router.replace(stationHref(venueId) as never);
  }, [venueId, visibleModules]);
  // #4490 spec 08 O5 part B — `?module=close` opens Close the day the same way.
  const closeDeepLinkRef = useRef(initialModule === "close");
  useEffect(() => {
    if (!closeDeepLinkRef.current || venueId === null) return;
    if (!visibleModules.includes("close")) return;
    closeDeepLinkRef.current = false;
    router.replace(closeHref(venueId) as never);
  }, [venueId, visibleModules]);

  const leaveSection =
    pendingLeaveRef.current !== null
      ? sectionLabelForModule(pendingLeaveRef.current.fromModule)
      : "venue";
  const leaveHandle =
    pendingLeaveRef.current !== null
      ? getLeaveHandle(pendingLeaveRef.current.fromModule)
      : null;
  const leaveLabels = leaveHandle?.changedLabels() ?? [];
  const leaveValid = leaveHandle?.isValid() ?? true;

  const handleLeaveKeep = useCallback((): void => {
    if (leaveSaving) return;
    const restore = pendingLeaveRef.current?.restoreFocus ?? null;
    pendingLeaveRef.current = null;
    setLeaveOpen(false);
    setLeaveError(null);
    restore?.();
  }, [leaveSaving]);

  const handleLeaveDiscard = useCallback((): void => {
    if (leaveSaving) return;
    const pending = pendingLeaveRef.current;
    if (pending !== null) getLeaveHandle(pending.fromModule)?.discard();
    pendingLeaveRef.current = null;
    setLeaveOpen(false);
    setLeaveError(null);
    // Do NOT arm sanctionedExitRef here — module switches never emit
    // beforeRemove, and a stale flag would bypass the next real route exit.
    // Route resumes arm the flag inside their own proceed callback below.
    pending?.proceed();
  }, [getLeaveHandle, leaveSaving]);

  const handleLeaveSave = useCallback(async (): Promise<void> => {
    const pending = pendingLeaveRef.current;
    if (pending === null) return;
    const handle = getLeaveHandle(pending.fromModule);
    if (handle === null || !handle.isValid()) return;
    setLeaveSaving(true);
    setLeaveError(null);
    try {
      await handle.save();
      const section = sectionLabelForModule(pending.fromModule);
      pendingLeaveRef.current = null;
      setLeaveOpen(false);
      // Same as discard: only route-exit proceed callbacks arm the sanction.
      pending.proceed();
      setLeaveToast(`${section} saved`);
    } catch {
      setLeaveError(
        "Couldn't save your changes. They're still here, so try again.",
      );
    } finally {
      setLeaveSaving(false);
    }
  }, [getLeaveHandle]);

  const requestLeave = useCallback(
    (proceed: () => void, restoreFocus?: () => void): void => {
      if (activeModule === "availability" && availabilityRef.current !== null) {
        availabilityRef.current.requestLeave(proceed, restoreFocus);
        return;
      }
      const handle = getLeaveHandle(activeModule);
      if (handle !== null && handle.isDirty()) {
        pendingLeaveRef.current = {
          proceed,
          restoreFocus: restoreFocus ?? null,
          fromModule: activeModule,
        };
        setLeaveError(null);
        setLeaveOpen(true);
        return;
      }
      proceed();
    },
    [activeModule, getLeaveHandle],
  );

  const navigation = useNavigation();
  useEffect(() => {
    // Availability installs its own beforeRemove; skip double-prompt there.
    if (activeModule === "availability") return;
    const unsubscribe = navigation.addListener(
      "beforeRemove" as never,
      (raw: unknown) => {
        if (sanctionedExitRef.current) {
          sanctionedExitRef.current = false;
          return;
        }
        const handle = getLeaveHandle(activeModule);
        if (handle === null || !handle.isDirty()) return;
        const event = raw as {
          preventDefault: () => void;
          data: { action: unknown };
        };
        event.preventDefault();
        requestLeave(() => {
          sanctionedExitRef.current = true;
          navigation.dispatch(event.data.action as never);
        });
      },
    );
    return unsubscribe;
  }, [activeModule, getLeaveHandle, navigation, requestLeave]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (activeModule === "availability") return;
    const handle = getLeaveHandle(activeModule);
    if (handle === null || !handle.isDirty()) return;
    const guard = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "You have unsaved changes.";
    };
    globalThis.addEventListener?.("beforeunload", guard);
    return (): void => globalThis.removeEventListener?.("beforeunload", guard);
  }, [activeModule, getLeaveHandle]);

  const leaveDialog = (
    <>
      {leaveOpen ? (
        <React.Suspense fallback={null}>
          <LazyConfirmDialog
            visible
            variant="leave"
            title={`Save your ${leaveSection} changes?`}
            description={formatLeaveChangedBody(leaveLabels)}
            onClose={handleLeaveKeep}
            onConfirm={handleLeaveDiscard}
            onSave={handleLeaveSave}
            onDiscard={handleLeaveDiscard}
            saveDisabled={!leaveValid}
            confirmLoading={leaveSaving}
            errorMessage={
              leaveError ??
              (!leaveValid
                ? "These changes can't be saved yet. Keep editing to fix them."
                : null)
            }
            saveTestID="venue-suite-leave-save"
            discardTestID="venue-suite-leave-discard"
            keepTestID="venue-suite-leave-keep"
            testID="venue-suite-leave-dialog"
          />
        </React.Suspense>
      ) : null}
      {leaveToast !== null ? (
        <React.Suspense fallback={null}>
          <LazyToast
            visible
            kind="success"
            message={leaveToast}
            onDismiss={() => setLeaveToast(null)}
            testID="venue-suite-leave-toast"
          />
        </React.Suspense>
      ) : null}
    </>
  );

  // Guard: if a feature flips OFF while its module is open, snap to overview.
  // #3389 — only once the features have loaded, so a `?module=tables` deep
  // link is not bounced on the loading frame of a venue that takes bookings.
  // #4490 — features, not the reservations toggle, decide (shouldLeaveHiddenModule).
  // #4490 P5 (reconciliation 35) — `?module=tables` opens Spaces › Tables once
  // tables live in spaces. Runs before the hidden-module bounce below.
  const tablesAlias = featuresResolved
    ? resolveTablesAlias({ activeModule, usesSpaces, visible: visibleModules })
    : null;
  useEffect(() => {
    if (tablesAlias === null) return;
    setSpacesView("tables");
    setActiveModule(tablesAlias.module);
  }, [tablesAlias]);

  useEffect(() => {
    if (venueAccess.scoped) return; // scoped staff fall to their first module below
    if (tablesAlias !== null) return;
    if (
      shouldLeaveHiddenModule({
        activeModule,
        visible: visibleModules,
        featuresResolved,
      })
    ) {
      selectModule("overview");
    }
  }, [activeModule, featuresResolved, selectModule, tablesAlias, venueAccess.scoped, visibleModules]);

  // #4420 — a `?module=reviews` link to a venue with no reviews panel (not
  // verified, or no place) lands on Overview instead of an empty module.
  useEffect(() => {
    if (activeModule === "reviews" && !hasReviews) setActiveModule("overview");
  }, [activeModule, hasReviews]);

  useEffect(() => {
    if (
      !venueAccess.scoped ||
      !venueAccessQuery.isFetched ||
      visibleModules.includes(activeModule)
    ) {
      return;
    }
    const firstVisible = visibleModules[0];
    if (firstVisible !== undefined) setActiveModule(firstVisible);
  }, [activeModule, venueAccess.scoped, venueAccessQuery.isFetched, visibleModules]);

  // Bridge to the layout's pill row (native/web-phone REPLACE the Hub pills).
  const syncStore = useVenueSuiteStore((s) => s.sync);
  useEffect(() => {
    syncStore({ activeModule, visibleModules, selectModule, requestLeave });
  }, [syncStore, activeModule, visibleModules, selectModule, requestLeave]);

  // #4490 — the Overview card turns on the Table reservations FEATURE (and
  // Waitlist with it, as the old single switch did) through the feature RPC;
  // the server mirrors the legacy reservations column.
  const [turnOnError, setTurnOnError] = useState<string | null>(null);
  const handleTurnOnReservations = useCallback((): void => {
    setTurnOnError(null);
    setFeature.mutate(
      { key: "table_reservations", enabled: true, cascade: true },
      {
        onSuccess: (result) => {
          if (!result.state.features.waitlist.enabled) {
            setFeature.mutate({ key: "waitlist", enabled: true, cascade: true });
          }
          setActiveModule("settings");
        },
        onError: (error) => {
          const e = error instanceof VenueFeatureError ? error : null;
          setTurnOnError(venueWriteErrorCopy("feature", e?.code ?? "unknown", e?.detail ?? null));
        },
      },
    );
  }, [setFeature]);

  // Overview mounts the VenueIntelligenceModule, which OWNS its own ScrollView
  // (with its own `insets.bottom + 120` clearance) — so the shell must NOT wrap
  // it in a second, outer ScrollView (nested same-axis scroll = the "doesn't
  // scroll properly" symptom). Settings + the booking ComingSoon render plain
  // Views, so the shell supplies the scroll container + clearance for them.
  const workspaceSelfScrolls = moduleSelfScrolls(activeModule);

  // Issue #1484 — the shared desktop shell takes `{ key, label }` rows and a
  // string-keyed `onSelect`. Ordering stays venue-owned (band grouping); the
  // select handler resolves the string back through `visibleModules`, so an
  // unknown key can never write a bogus module into state (no `as` cast).
  const dirtyModules = useVenueSuiteStore((s) => s.dirtyModules);
  const railModules = useMemo(
    () => deriveVenueRailModules(visibleModules, dirtyModules),
    [dirtyModules, visibleModules],
  );
  const handleRailSelect = useCallback(
    (key: string, restoreFocus?: () => void): void => {
      const next = visibleModules.find((m) => m === key);
      if (next !== undefined) selectModule(next, restoreFocus);
    },
    [selectModule, visibleModules],
  );

  const renderWorkspace = (): React.ReactElement => {
    // #4490 spec 08 O1 — a Till-only login lands here (never a blank shell).
    if (activeModule === "till" && venueId !== null) {
      return <TillLauncher venueId={venueId} />;
    }
    // #4490 spec 08 O3 — a kitchen-only login lands here (never a blank shell).
    if (activeModule === "stations" && venueId !== null) {
      return <StationsLauncher venueId={venueId} />;
    }
    // #4490 spec 08 O5 part B — never a blank shell for Close the day.
    if (activeModule === "close" && venueId !== null) {
      return <DayCloseLauncher venueId={venueId} />;
    }
    if (activeModule === "overview") {
      // ORCH-1186-B — the Overview slot is now the venue INTELLIGENCE dashboard
      // (the listing recap relocated to Settings by Leg 1). The reservations-
      // activation invitation card is pinned ABOVE the self-scrolling
      // <VenueIntelligenceModule> (which owns its own ScrollView + bottom-nav
      // clearance). Pinning it — rather than nesting it inside a second outer
      // ScrollView — keeps the CTA visible AND avoids the nested same-axis
      // scroll that broke scrolling on native. (`focus` is the venue-claim
      // feedback deep-link, which followed the recap into Settings — it is no
      // longer consumed at the Overview slot.)
      // #4420 B8 + round-3 item 12 — the invitation and the page's Local
      // reviews panel now scroll WITH the dashboard (as its header) instead of
      // being pinned above it, and the invitation is one compact row.
      // #4490 — any selling feature (Entry, group packages, private hire).
      const sellsOffers =
        features.entry.enabled ||
        features.group_packages.enabled ||
        features.private_hire.enabled ||
        features.by_the_hour.enabled ||
        features.memberships.enabled;
      const openSetupTarget = (target: SetupTarget): void => {
        if ((target === "spaces" || target === "tables") && venueId !== null) requestSpacesInStore(venueId);
        selectModule(target);
      };
      const header = (
        <>
          {setupNeeds.length > 0 && !venueAccess.scoped ? (
            <View style={styles.setupNeeds}>
              <FeatureSetupNeedsCard needs={setupNeeds} onOpen={openSetupTarget} />
            </View>
          ) : null}
          {sellsOffers && !venueAccess.scoped ? (
            <React.Suspense fallback={null}>
              <LazyVenueTodayOverview
                brandId={brandId}
                venueId={venueId}
                activeSpaceCount={featuresQuery.data?.activeSpaceCount ?? 0}
                features={features}
                canManageOffers={!venueAccess.scoped || scopedStaffManagesOffers(venueAccess.scoped, venueAccess.capabilities)}
                onOpenModule={(next) => {
                  if (visibleModules.includes(next)) selectModule(next);
                }}
                showRequests={visibleModules.includes("requests")}
              />
            </React.Suspense>
          ) : null}
          {/* #4490 fix 2 (N76) — Events here on: start an event at this venue. */}
          {features.events_here.enabled && !venueAccess.scoped && venueId !== null ? (
            <React.Suspense fallback={null}>
              <View style={styles.setupNeeds}>
                <LazyEventsHereCard
                  venueId={venueId}
                  onOpenCalendar={visibleModules.includes("calendar") ? () => selectModule("calendar") : undefined}
                />
              </View>
            </React.Suspense>
          ) : null}
          {showReservationsInvite ? (
            <GlassCard
              variant="base"
              padding={space[4]}
              style={styles.invitationCard}
              contentStyle={styles.invitationStack}
            >
              <View style={styles.invitationCopy}>
                <Text style={styles.invitationTitle}>
                  Take table reservations on Mingla
                </Text>
                <Text style={styles.invitationBody}>
                  Free to switch on. Manage tables, hours, and bookings in one
                  place.
                </Text>
              </View>
              {/* #4420 (round-3 items 12 and 14) — a compact action sized to
                  its label, not a full-width bar under the copy. */}
              <Button
                label="Turn on Reservations"
                onPress={handleTurnOnReservations}
                variant="primary"
                size="sm"
                loading={setFeature.isPending}
                testID="venue-overview-turn-on-reservations"
              />
              {turnOnError !== null ? (
                <Text
                  style={styles.invitationError}
                  accessibilityLiveRegion="polite"
                  testID="venue-overview-turn-on-error"
                >
                  {turnOnError}
                </Text>
              ) : null}
            </GlassCard>
          ) : null}
          {hasReviews && renderReviewsSummary !== undefined
            ? renderReviewsSummary(() => selectModule("reviews"))
            : null}
          {overviewHeader}
        </>
      );
      return (
        <View style={styles.overviewWrap}>
          {/* META-ORCH-1255(C) D-D: venue-scoped so the RPC resolves THIS
              venue's place signals + timezone (the legacy brand place pointer
              is inert for new venues). */}
          <VenueIntelligenceModule
            brandId={brandId}
            venueId={venueId}
            header={header}
            showReservationMetrics={tableReservationsOn}
          />
        </View>
      );
    }
    // #4420 (round-3 item 19) — Mingla Local reviews, their own module. The
    // panel renders inside the shell's ScrollView
    // (moduleSelfScrolls("reviews") === false), like Menu.
    if (activeModule === "reviews") {
      return <View style={styles.reviewsWrap}>{reviewsPanel}</View>;
    }
    if (activeModule === "settings") {
      return (
        <VenueSettingsModule
          ref={settingsRef}
          brandId={brandId}
          venueId={venueId}
          hoursLiveInAvailability={usesSpaces && visibleModules.includes("availability")}
        />
      );
    }
    // #4490 P2 — Offers (Entry editor inside), Today and Check-in.
    const openModule = (next: VenueModule): void => {
      if (visibleModules.includes(next)) selectModule(next);
    };
    if (activeModule === "offers") {
      return (
        <React.Suspense
          fallback={
            <View style={styles.lazyModuleFallback}>
              <ActivityIndicator />
            </View>
          }
        >
          <LazyVenueOffersModule
            ref={offersRef}
            brandId={brandId}
            venueId={venueId}
            onOpenModule={openModule}
            initialOfferId={initialModule === "offers" ? initialItemId : null}
            onOpenMembers={(view) => {
              setMembersView(view);
              if (visibleModules.includes("members")) selectModule("members");
            }}
          />
        </React.Suspense>
      );
    }
    if (activeModule === "today") {
      return (
        <React.Suspense
          fallback={
            <View style={styles.lazyModuleFallback}>
              <ActivityIndicator />
            </View>
          }
        >
          <LazyVenueTodayModule brandId={brandId} venueId={venueId} onOpenModule={openModule} showRequests={visibleModules.includes("requests")} />
        </React.Suspense>
      );
    }
    if (activeModule === "requests") {
      return (
        <React.Suspense
          fallback={
            <View style={styles.lazyModuleFallback}>
              <ActivityIndicator />
            </View>
          }
        >
          <LazyVenueRequestsModule
            key={requestItem ?? "requests"}
            brandId={brandId}
            venueId={venueId}
            onOpenModule={openModule}
            initialGroupId={requestItem ?? (initialModule === "requests" ? initialItemId : null)}
          />
        </React.Suspense>
      );
    }
    if (activeModule === "calendar") {
      return (
        <React.Suspense
          fallback={
            <View style={styles.lazyModuleFallback}>
              <ActivityIndicator />
            </View>
          }
        >
          <LazyVenueCalendarModule
            brandId={brandId}
            venueId={venueId}
            onOpenRequest={
              visibleModules.includes("requests")
                ? (groupId) => {
                    setRequestItem(groupId);
                    selectModule("requests");
                  }
                : undefined
            }
          />
        </React.Suspense>
      );
    }
    if (activeModule === "checkin") {
      return (
        <React.Suspense
          fallback={
            <View style={styles.lazyModuleFallback}>
              <ActivityIndicator />
            </View>
          }
        >
          <LazyVenueCheckInModule brandId={brandId} venueId={venueId} />
        </React.Suspense>
      );
    }
    if (activeModule === "guestlist") {
      return (
        <React.Suspense
          fallback={
            <View style={styles.lazyModuleFallback}>
              <ActivityIndicator />
            </View>
          }
        >
          <LazyVenueGuestListModule brandId={brandId} venueId={venueId} />
        </React.Suspense>
      );
    }
    // #4490 P6 — Members (plans, the plan editor, one member).
    if (activeModule === "members") {
      return (
        <React.Suspense
          fallback={
            <View style={styles.lazyModuleFallback}>
              <ActivityIndicator />
            </View>
          }
        >
          <LazyVenueMembersModule
            key={membersView}
            ref={membersRef}
            brandId={brandId}
            venueId={venueId}
            initialView={membersView}
            initialMemberId={initialModule === "members" ? initialItemId : null}
            onOpenModule={openModule}
          />
        </React.Suspense>
      );
    }
    // #4490 — Spaces (P1-8).
    if (activeModule === "spaces") {
      return (
        <React.Suspense
          fallback={
            <View style={styles.lazyModuleFallback}>
              <ActivityIndicator />
            </View>
          }
        >
          <LazyVenueSpacesModule
            key={`${spacesView ?? "spaces"}:${spacesSpaceId ?? ""}`}
            ref={spacesRef}
            brandId={brandId}
            venueId={venueId}
            initialView={spacesView}
            initialSpaceId={spacesSpaceId}
            onOpenSettings={visibleModules.includes("settings") ? () => selectModule("settings") : undefined}
          />
        </React.Suspense>
      );
    }
    // ORCH-1186-C — the always-visible command-band DISPLAY-ONLY menu builder
    // (independent of the reservations toggle). Renders inside the shell's
    // ScrollView (moduleSelfScrolls("menu") === false), like Settings.
    if (activeModule === "menu") {
      return <VenueMenuModule brandId={brandId} venueId={venueId} />;
    }
    // Issue #1735 — the combined Insights suite (site check + competitor
    // watch; #1737 adds pricing). Command band, both derivation branches
    // (I-PROPOSED-1735-INSIGHTS-COMMAND-BAND-ADDITIVE). OWNS its ScrollView
    // (moduleSelfScrolls("insights") === true) — the shell must NOT wrap it.
    // Lazy behind the host boundary (see LazyVenueInsightsModule above); the
    // fallback is a centered spinner, never a blank frame.
    if (activeModule === "insights") {
      return (
        <React.Suspense
          fallback={
            <View style={styles.lazyModuleFallback}>
              <ActivityIndicator />
            </View>
          }
        >
          <LazyVenueInsightsModule brandId={brandId} venueId={venueId} />
        </React.Suspense>
      );
    }
    // Issue #1791 — the live Orders queue. Command band, both derivation
    // branches. Renders inside the shell's ScrollView
    // (moduleSelfScrolls("orders") === false), like Settings and Menu. Lazy
    // behind the host boundary (see LazyVenueOrdersModule above); the fallback
    // is a centered spinner, never a blank frame.
    if (activeModule === "orders") {
      return (
        <React.Suspense
          fallback={
            <View style={styles.lazyModuleFallback}>
              <ActivityIndicator />
            </View>
          }
        >
          <LazyVenueOrdersModule brandId={brandId} venueId={venueId} orderEntry={orderEntry} />
        </React.Suspense>
      );
    }
    // 2.1a — Tables + Availability LIVE. 2.1b — Reservations + Waitlist LIVE.
    // The whole booking band is now real operator UI (no ComingSoon left).
    if (activeModule === "tables") {
      // #4490 P5 — wait for the features before choosing the old module or the alias.
      if (!featuresResolved || tablesAlias !== null) {
        return (
          <View style={styles.lazyModuleFallback}>
            <ActivityIndicator />
          </View>
        );
      }
      return <VenueTablesModule brandId={brandId} venueId={venueId} />;
    }
    if (activeModule === "availability") {
      // #4490 — in the feature layout the module is "Availability & pricing":
      // hours with several windows, special days, close a day, and the
      // unchanged Table times (VenueAvailabilityModule) when table
      // reservations are on. The classic layout keeps the old module as-is.
      if (usesSpaces) {
        return (
          <React.Suspense
            fallback={
              <View style={styles.lazyModuleFallback}>
                <ActivityIndicator />
              </View>
            }
          >
            <LazyVenueAvailabilityPricingModule
              ref={availabilityRef}
              brandId={brandId}
              venueId={venueId}
              tableReservationsOn={tableReservationsOn}
              showTableTimes={
                tableReservationsOn &&
                (!venueAccess.scoped ||
                  venueAccess.capabilities.includes("restaurant.manage_reservations"))
              }
              canEditHours={
                !venueAccess.scoped ||
                scopedStaffManagesOffers(venueAccess.scoped, venueAccess.capabilities)
              }
            />
          </React.Suspense>
        );
      }
      return (
        <React.Suspense
          fallback={
            <View style={styles.lazyModuleFallback}>
              <ActivityIndicator />
            </View>
          }
        >
          <LazyVenueAvailabilityModule
            ref={availabilityRef}
            brandId={brandId}
            venueId={venueId}
          />
        </React.Suspense>
      );
    }
    if (activeModule === "reservations") {
      return (
        <VenueReservationsModule
          brandId={brandId}
          venueId={venueId}
          scrollBottomPad={scrollBottomPad}
          floorPlanOn={featuresQuery.data?.features.floor_plan.enabled === true}
          onEditFloor={
            visibleModules.includes("spaces")
              ? (spaceId) => {
                  setSpacesView("tables");
                  setSpacesSpaceId(spaceId);
                  selectModule("spaces");
                }
              : undefined
          }
        />
      );
    }
    // The remaining booking module: waitlist.
    return <VenueWaitlistModule brandId={brandId} venueId={venueId} />;
  };

  if (!venueAccessQuery.isFetched) {
    return (
      <View style={styles.accessState} testID="venue-access-loading">
        <ActivityIndicator />
        <Text style={styles.accessBody}>Checking your venue access…</Text>
      </View>
    );
  }
  if (venueAccessQuery.isError || (venueAccess.scoped && visibleModules.length === 0)) {
    return (
      <View style={styles.accessState} testID="venue-access-unavailable">
        <Text style={styles.accessTitle}>No venue pages assigned</Text>
        <Text style={styles.accessBody}>
          Ask a brand owner or admin to give you access to this venue.
        </Text>
        {venueAccessQuery.isError ? (
          <Button
            label="Try again"
            onPress={() => void venueAccessQuery.refetch()}
            variant="secondary"
            size="md"
          />
        ) : null}
      </View>
    );
  }

  // ----- Web desktop: two-column master rail + workspace. -----
  // Issue #1484 [stay-desktop-shell] — the layout itself now lives in the
  // SHARED `SuiteDesktopShell` (decision D2) so the Stay suite renders the
  // identical rail + full-width workspace instead of its own phone-first
  // template. The rendered output here is UNCHANGED: same `desktopHost` /
  // `desktopCentered` / `desktopRail` / `desktopWorkspace` tree, same
  // `venue-suite-shell-desktop` + `venue-rail-<module>` testIDs, same
  // tablist/tab a11y roles, same width math (NO maxWidth cap — ORCH-1184).
  if (isWideDesktop) {
    return (
      <>
        <SuiteDesktopShell
          modules={railModules}
          activeModule={activeModule}
          onSelect={handleRailSelect}
          workspaceSelfScrolls={workspaceSelfScrolls}
          scrollBottomPad={scrollBottomPad}
          railTestIdPrefix="venue-rail-"
          railLabel="Venue sections"
          testID="venue-suite-shell-desktop"
        >
          {renderWorkspace()}
        </SuiteDesktopShell>
        {leaveDialog}
      </>
    );
  }

  // ----- Web-phone + native: single column. -----
  // On NATIVE, the Hub `_layout.tsx` renders the module pill row in place of the
  // Hub pills (via the store bridge), so the shell does NOT render its own row
  // (avoids a double row). On WEB-phone the same layout swap applies. The shell
  // body is just the workspace.
  return (
    <View style={styles.phoneHost} testID="venue-suite-shell-phone">
      {workspaceSelfScrolls ? (
        // Overview self-scrolls (VenueIntelligenceModule owns the ScrollView +
        // its own bottom-nav clearance) — render it directly, no outer scroll.
        renderWorkspace()
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.phoneScroll,
            { paddingBottom: scrollBottomPad },
          ]}
          showsVerticalScrollIndicator={false}
          testID="venue-suite-shell-phone-scroll"
        >
          {renderWorkspace()}
        </ScrollView>
      )}
      {leaveDialog}
    </View>
  );
}

const styles = StyleSheet.create({
  setupNeeds: { marginBottom: space[4] },
  accessState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space[7],
    gap: space[2],
  },
  accessTitle: { ...type.h1, color: color.text1, textAlign: "center" },
  accessBody: { ...type.small, color: color.text2, textAlign: "center" },
  // phone / native
  phoneHost: {
    flex: 1,
  },
  // #1735 — Suspense fallback while the lazy Insights chunk loads.
  lazyModuleFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: space[9],
  },
  phoneScroll: {
    // paddingBottom supplied inline (insets.bottom + 120) for nav clearance.
  },
  reviewsWrap: {
    paddingHorizontal: space[4],
    paddingTop: space[4],
  },
  // overview + invitation
  overviewWrap: {
    flex: 1,
  },
  invitationCard: {
    marginBottom: space[4],
  },
  invitationStack: {
    alignItems: "flex-start",
    gap: space[3],
  },
  invitationCopy: {
    alignSelf: "stretch",
    gap: space[1],
  },
  invitationTitle: {
    ...type.row,
    color: color.text1,
  },
  invitationBody: {
    ...type.small,
    color: color.text2,
  },
  invitationError: {
    ...type.caption,
    color: color.errorText,
  },
});

export default VenueSuiteShell;
