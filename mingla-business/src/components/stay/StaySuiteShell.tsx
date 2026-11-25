/**
 * The Hotel / Stay SUITE SHELL — the offering manager mounted by
 * `app/venue/[venueId]/index.tsx` when `venue.venueCategory === "stay"`.
 *
 * Issue #1484 [stay-desktop-shell] — RESPONSIVE SHELL:
 *  - web desktop (`isWideDesktop`, >=1024px): the SHARED `SuiteDesktopShell` —
 *    the same two-column master rail + full-width workspace the Restaurant
 *    suite has had since ORCH-1184. The horizontal module pill row does NOT
 *    render at this width (the rail replaces it).
 *  - web-phone + native: UNCHANGED from #1446/#1448/#1449 — the horizontal pill
 *    row above a stacked workspace, with the existing readable-measure caps.
 *
 * The desktop branch is gated ONLY through `useResponsiveLayout()` (invariant
 * I-DESKTOP-GATE-VIA-HOOK). Re-deriving the breakpoint inline from the platform
 * and the viewport width is forbidden and is policed by the strict-grep gate
 * `orch-0885-a-no-bottomnav-on-wide-desktop.mjs`.
 *
 * PER-MODULE WIDTH RULES (desktop only — phone keeps today's caps exactly):
 * releasing the shell's cap alone is not enough, because every Stay module
 * re-caps itself. On wide desktop Overview / Reservations / Rooms &
 * Places / Availability & pricing run UNCAPPED and left-anchored (the shared
 * workspace owns the gutters), while Settings — an editable form — keeps a
 * readable-measure cap (`suiteFormMaxWidth`), left-anchored.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { loadVenueHostScreens } from "../venue/host/venueHostOwner";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router as appRouter, useRouter } from "expo-router";

import { ScrollView } from "../../wrappers/SmartScrollView";
import {
  radius,
  stayOverviewGridBasis,
  stayOverviewRowMinWidth,
  stayPageMaxWidth,
  suiteFormMaxWidth,
  color,
  space,
  type,
} from "../../constants/designSystem";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { useVenueSuiteStore } from "../../store/venueSuiteStore";
import { useTillReleased } from "../../hooks/useTillReleased";
import { tillHref, TillLauncher } from "../venue/till/TillLauncher";
import { stationHref, StationsLauncher } from "../venue/station/StationsLauncher";
import { closeHref, DayCloseLauncher } from "../venue/close/DayCloseLauncher";
import { unsavedWork } from "../../hooks/useUnsavedChangesGuard";
import { useMyVenueAccess } from "../../hooks/useMyVenueAccess";
import { useVenueFeatures } from "../../hooks/useVenueFeatures";
import { useBrandDiscoveryCurrency } from "../../hooks/useBrandDiscoveryCurrency";
import {
  ORGANISER_TERMS_PUBLISH_RETRY_TOAST,
  useOrganiserTermsPublishGate,
} from "../../hooks/useOrganiserTermsPublishGate";
import {
  usePublishStay,
  useSaveStaySettings,
  useStayInventory,
} from "../../hooks/useStayInventory";
import type {
  StayBookingMode,
  StayPropertyKind,
  StaySettingsInput,
} from "../../types/stayInventory";
import {
  isOrganiserTermsRefusalMessage,
  organiserTermsUnresolvedCopy,
} from "../../utils/paidPublishGuards";
import type { SuiteDesktopModule } from "../suite/SuiteDesktopShell";
import { SuiteDesktopShell } from "../suite/SuiteDesktopShell";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import { Tabs } from "../ui/Tabs";
import { Toast } from "../ui/Toast";
import { StayActionBar } from "./StayActionBar";
import { StayInventoryManager } from "./StayInventoryManager";
import { StayReservationsModule } from "./StayReservationsModule";
import { StayStaffAvailabilityModule } from "./StayStaffAvailabilityModule";
/*
 * #4490 07-J fix 5 — BUNDLE: these three venue screens are imported
 * STATICALLY on purpose, and React.lazy here would be the regression.
 *
 * The venue route `app/venue/[venueId]/index.tsx` is one async web chunk that
 * statically imports BOTH shells. `VenueSuiteShell` already imports Menu,
 * Reservations and Waitlist statically, so they are inside that route chunk
 * whatever this file does. Expo's web serializer (serializeChunks.js) moves
 * every module that two async chunks share into the EAGER `__common` chunk,
 * and a `React.lazy(import(...))` makes the target its own async chunk. A lazy
 * Menu here therefore shared Menu's whole closure between the route chunk and
 * the new chunk: +58,157 B raw / +10,055 B brotli on every Host web boot
 * (fix round 4 measurement). A static import adds nothing: the route chunk
 * already holds these modules. Rule: load a venue module here the SAME way
 * the ordinary shell loads it (static there → static here; lazy there → lazy
 * here with the same path, which reuses its existing chunk). Policed by the
 * #1424 gate.
 */
import { VenueMenuModule } from "../venue/VenueMenuModule";
import { VenueReservationsModule } from "../venue/VenueReservationsModule";
import { VenueWaitlistModule } from "../venue/VenueWaitlistModule";
import type { VenueAvailabilityLeaveHandle } from "../venue/VenueAvailabilityModule";
import {
  filterVenueModulesForCapabilities,
  withCloseAccess,
  withStationsAccess,
  withTillAccess,
  scopedStaffManagesOffers,
} from "../venue/venueCapabilityGate";
import {
  deriveVenueNav,
  hasNoStoredFeatures,
  venueOrderEntry,
  VENUE_MODULES,
} from "../venue/venueModules";
import {
  formatLeaveChangedBody,
  type VenueModuleLeaveHandle,
} from "../venue/venueLeaveContract";
import { moduleSelfScrolls } from "../venue/venueShellScroll";
import { featureSetupNeeds } from "../venue/features/featureSetupModel";
import type { VenueModule } from "../../types/venueReservation";
import {
  STAY_PAGE_BOTTOM_PAD,
  STAY_SPACING,
} from "./stayLayoutContracts";
import {
  isStaySettingsComplete,
  isStaySettingsFormValid,
} from "./staySettingsReadiness";

export type StayCoreModule =
  | "overview"
  | "rooms_places"
  | "availability_pricing"
  | "reservations"
  | "settings";

/**
 * #4490 07 §13 — `table_reservations` is the Stay key (and `?module=` value)
 * for the venue `reservations` screen: the Stay workspace already uses
 * `reservations` for its own room and place bookings.
 */
export type StayFeatureModule =
  | Extract<
      VenueModule,
      | "offers"
      | "spaces"
      | "today"
      | "calendar"
      | "requests"
      | "waitlist"
      | "members"
      | "till"
      | "stations"
      | "close"
      | "checkin"
      | "menu"
      | "orders"
      | "guestlist"
    >
  | "table_reservations";

export type StayModule = StayCoreModule | StayFeatureModule;

const LazyVenueSpacesModule = React.lazy(async () => {
  return { default: (await loadVenueHostScreens()).VenueSpacesModule };
});
const LazyVenueOffersModule = React.lazy(async () => {
  return { default: (await loadVenueHostScreens()).VenueOffersModule };
});
const LazyVenueTodayModule = React.lazy(async () => {
  return { default: (await loadVenueHostScreens()).VenueTodayModule };
});
const LazyVenueCalendarModule = React.lazy(async () => {
  return { default: (await loadVenueHostScreens()).VenueCalendarModule };
});
const LazyVenueRequestsModule = React.lazy(async () => {
  return { default: (await loadVenueHostScreens()).VenueRequestsModule };
});
const LazyVenueMembersModule = React.lazy(async () => {
  return { default: (await loadVenueHostScreens()).VenueMembersModule };
});
const LazyVenueCheckInModule = React.lazy(async () => {
  return { default: (await loadVenueHostScreens()).VenueCheckInModule };
});
const LazyVenueOrdersModule = React.lazy(async () => {
  return { default: (await loadVenueHostScreens()).VenueOrdersModule };
});
// Table times and booking rules: the ordinary shell's "Availability &
// pricing" screen (opening hours that feed the table service periods, plus
// Table times). Same path as VenueSuiteShell's lazy import, so it reuses that
// existing chunk and adds nothing to the boot payload.
const LazyVenueAvailabilityPricingModule = React.lazy(async () => {
  return { default: (await loadVenueHostScreens()).VenueAvailabilityPricingModule };
});
const LazyVenueGuestListModule = React.lazy(async () => {
  return { default: (await loadVenueHostScreens()).VenueGuestListModule };
});
const LazyVenueTypeAndFeaturesPanel = React.lazy(async () => {
  return { default: (await loadVenueHostScreens()).VenueTypeAndFeaturesPanel };
});
const LazyConfirmDialog = React.lazy(async () => {
  const mod = await import("../ui/ConfirmDialog");
  return { default: mod.ConfirmDialog };
});

/**
 * #1532 §6 — every glyph here comes from the IN-APP `Icon` roster, NOT from
 * `lucide-react-native`, and that is a BUNDLE requirement rather than a taste.
 *
 * On web the lucide shim's `USED_ICONS` (`src/shims/lucideReactNativeWebStub.js`)
 * is a GLOBAL EAGER registry: it deep-`require`s every registered glyph at
 * module scope and lands in Metro's eager `__common` chunk. So a glyph
 * registered for THIS screen is downloaded by every business-web visitor before
 * anything renders, even though the Stay manager is behind a lazy route.
 * #1501 measured that at +8,746 B for ten glyphs and it breached the ORCH-1083
 * budget. `Icon`'s SVG roster is already in `__common` (Button depends on it),
 * so these cost zero — and moving this file off lucide entirely DELETES six
 * registrations, because `Accessibility`, `Circle`, `CreditCard`, `FileCheck2`,
 * `Home` and `Utensils` were imported by no other file in the app.
 */
type StayModuleMeta = {
  id: StayModule;
  label: string;
  icon: IconName;
};

const CORE_MODULES: readonly StayModuleMeta[] = [
  { id: "overview", label: "Overview", icon: "home" },
  { id: "rooms_places", label: "Rooms & Places", icon: "grid" },
  {
    id: "availability_pricing",
    label: "Availability & pricing",
    icon: "calendar",
  },
  { id: "reservations", label: "Reservations", icon: "notebook" },
  { id: "settings", label: "Settings", icon: "settings" },
];

/**
 * #4490 06-J — feature work is additive to the five Stay destinations. The
 * order is a product contract: the Stay workspace stays familiar, then gains
 * the shared venue tools in this exact sequence.
 */
export const STAY_FEATURE_MODULE_ORDER: readonly StayFeatureModule[] = [
  "offers",
  "spaces",
  "today",
  "calendar",
  "requests",
  "table_reservations",
  "waitlist",
  "members",
  // #4490 spec 08 O1 — the Till, first of the floor tools (floor design rail:
  // Till leads Operations, before Check-in, Menu and Orders). Selecting it
  // opens the full-screen Till route, as in the ordinary venue shell.
  "till",
  // #4490 spec 08 O3 — Kitchen and bar, right after the Till (floor design
  // rail: Till, Kitchen and bar, then Check-in, Menu and Orders).
  "stations",
  // #4490 spec 08 O5 part B — Close the day, right after Kitchen and bar.
  "close",
  "checkin",
  "menu",
  "orders",
  "guestlist",
];

/**
 * The venue module each Stay feature destination shows. Visibility and staff
 * capabilities are decided on these venue keys by `deriveVenueNav` and
 * `filterVenueModulesForCapabilities`, exactly as in the ordinary venue shell.
 */
export const STAY_FEATURE_VENUE_MODULE: Readonly<
  Record<StayFeatureModule, VenueModule>
> = {
  offers: "offers",
  spaces: "spaces",
  today: "today",
  calendar: "calendar",
  requests: "requests",
  table_reservations: "reservations",
  waitlist: "waitlist",
  members: "members",
  till: "till",
  stations: "stations",
  close: "close",
  checkin: "checkin",
  menu: "menu",
  orders: "orders",
  guestlist: "guestlist",
};

/** Stay labels that differ from the venue module's own label. */
const STAY_FEATURE_LABELS: Readonly<Partial<Record<StayFeatureModule, string>>> = {
  // §13: the feature's own name; "Reservations" is the Stay's room bookings.
  table_reservations: "Table reservations",
};

const FEATURE_ICONS: Readonly<Record<StayFeatureModule, IconName>> = {
  offers: "ticket",
  spaces: "grid",
  today: "clock",
  calendar: "calendar",
  requests: "inbox",
  table_reservations: "calendar",
  waitlist: "clock",
  members: "users",
  till: "cash",
  stations: "list",
  close: "cash",
  checkin: "scan",
  menu: "list",
  orders: "receipt",
  guestlist: "notebook",
};

const FEATURE_MODULES: readonly (StayModuleMeta & {
  id: StayFeatureModule;
})[] = STAY_FEATURE_MODULE_ORDER.map(
  (id) => ({
    id,
    label:
      STAY_FEATURE_LABELS[id] ??
      VENUE_MODULES[STAY_FEATURE_VENUE_MODULE[id]].label,
    icon: FEATURE_ICONS[id],
  }),
);

/** The label a Stay destination shows (rail, pills, leave dialog). */
function stayModuleLabel(module: StayModule): string {
  return (
    [...CORE_MODULES, ...FEATURE_MODULES].find((meta) => meta.id === module)
      ?.label ?? ""
  );
}

/**
 * Where a shared venue module's "open X" link lands in the Stay workspace.
 * `availability` (table times and hours) opens the Table reservations
 * destination on its "Table times and rules" view. Null: the Stay shell has
 * no such destination (the caller's tap is then not offered, see below).
 */
export function stayTargetForVenueModule(
  next: VenueModule,
): { module: StayModule; tableView?: "bookings" | "times" } | null {
  if (next === "settings") return { module: "settings" };
  if (next === "availability") {
    return { module: "table_reservations", tableView: "times" };
  }
  if (next === "reservations") {
    return { module: "table_reservations", tableView: "bookings" };
  }
  const feature = STAY_FEATURE_MODULE_ORDER.find(
    (module) => STAY_FEATURE_VENUE_MODULE[module] === next,
  );
  return feature === undefined ? null : { module: feature };
}

const PROPERTY_KINDS: readonly {
  id: StayPropertyKind;
  label: string;
}[] = [
  { id: "hotel", label: "Hotel" },
  { id: "resort", label: "Resort" },
  { id: "guest_house", label: "Guest house" },
  { id: "lodge", label: "Lodge" },
  { id: "serviced_apartment", label: "Serviced apartment" },
  { id: "short_stay_apartment", label: "Short-stay apartment" },
  { id: "other", label: "Other" },
];

const splitTags = (value: string): string[] =>
  [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].slice(0, 50);

const joinTags = (value: string[] | undefined): string =>
  (value ?? []).join(", ");

function publishErrorCopy(
  error: Error | null,
  termsUnresolved: string | null = null,
): string | null {
  if (error === null) return null;
  // #3645 — the server asks for the Organiser Terms. The acceptance sheet
  // opens for this (see handlePublishStay); the line under the button says the
  // same thing in plain words, never the server's code. When the sheet has
  // nothing to offer (the terms already read as accepted, or could not be
  // read) the line says that instead of asking for something already done.
  if (isOrganiserTermsRefusalMessage(error.message)) {
    return termsUnresolved ?? "Accept the Organiser Terms to publish this Stay.";
  }
  if (error.message.includes("stay_authoring_disabled")) {
    return "Stay publishing is not active yet.";
  }
  if (error.message.includes("paid_currency_not_ready")) {
    return "Connect a compatible bank for this brand before publishing.";
  }
  if (error.message.includes("stay_publish_incomplete")) {
    return "At least one Room or Place still needs photos, pricing, policy, and open availability.";
  }
  if (error.message.includes("stay_venue_not_approved")) {
    return "Mingla must approve the venue listing before Reserve can go live.";
  }
  return "We couldn’t publish this Stay. Review the blockers and try again.";
}

interface ChecklistRowProps {
  title: string;
  detail: string;
  complete: boolean;
  optional?: boolean;
  onPress: () => void;
  icon: IconName;
  testID: string;
  /** #1484 — wide-desktop grid cell (multi-column reflow). */
  wide?: boolean;
}

function ChecklistRow({
  title,
  detail,
  complete,
  optional = false,
  onPress,
  icon,
  testID,
  wide = false,
}: ChecklistRowProps): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      // #1532 — the state was carried ONLY by a tick-or-circle glyph, which a
      // screen reader announces as "check mark" / "white circle", i.e. as
      // nothing. Say it in words.
      accessibilityLabel={`${title}. ${detail}. ${
        optional ? "Optional" : complete ? "Done" : "Still to do"
      }`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.checkRow,
        // #1484 — on wide desktop the readiness rows reflow into a
        // multi-column grid instead of one very wide, very tall column.
        wide ? styles.checkRowDesktop : null,
        pressed && styles.pressed,
      ]}
      testID={testID}
    >
      <View style={styles.rowIcon}>
        <Icon name={icon} size={18} color={color.text2} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDetail}>{detail}</Text>
      </View>
      {optional ? (
        <Text style={styles.optional}>Optional</Text>
      ) : complete ? (
        <Icon name="check" size={19} color={color.success} />
      ) : (
        // The incomplete marker is a plain outline ring. `Icon` has no bare
        // circle and registering a lucide `Circle` for it would put an eager
        // glyph back in `__common` for one decorative dot.
        <View style={styles.pendingDot} accessibilityElementsHidden />
      )}
      <Icon name="chevR" size={18} color={color.text3} />
    </Pressable>
  );
}

interface ManagementRowProps {
  title: string;
  detail: string;
  onPress: () => void;
  icon: IconName;
  testID: string;
  wide?: boolean;
}

function ManagementRow({
  title,
  detail,
  onPress,
  icon,
  testID,
  wide = false,
}: ManagementRowProps): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.checkRow,
        wide ? styles.checkRowDesktop : null,
        pressed && styles.pressed,
      ]}
      testID={testID}
    >
      <View style={styles.rowIcon}>
        <Icon name={icon} size={18} color={color.text2} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDetail}>{detail}</Text>
      </View>
      <Icon name="chevR" size={18} color={color.text3} />
    </Pressable>
  );
}

interface StayOverviewProps {
  brandId: string;
  venueId: string;
  venueApproved: boolean;
  onSelect: (module: StayModule) => void;
  /** #4420 B8 — the page's Local reviews panel, scrolling with Overview. */
  header?: React.ReactNode;
}

function StayOverview({
  brandId,
  venueId,
  venueApproved,
  onSelect,
  header = null,
}: StayOverviewProps): React.ReactElement {
  const router = useRouter();
  // #1484 — desktop gate ONLY via the canonical hook (I-DESKTOP-GATE-VIA-HOOK).
  const { isWideDesktop } = useResponsiveLayout();
  const inventory = useStayInventory(venueId);
  const currency = useBrandDiscoveryCurrency(brandId);
  const publish = usePublishStay(venueId);
  // #3645 PR11c — stays that can publish always have a current price (paid).
  const {
    blockPaidPublishUntilAccepted,
    acceptTermsAfterServerRefusal,
    gateElement: organiserTermsGateElement,
  } = useOrganiserTermsPublishGate(brandId);
  const [organiserTermsToast, setOrganiserTermsToast] = useState(false);
  // #3645 — set when the server refused for the terms and the sheet could not
  // help; cleared by the next press of Publish.
  const [termsUnresolved, setTermsUnresolved] = useState<string | null>(null);
  const snapshot = inventory.data ?? null;
  const settings = snapshot?.settings ?? null;
  const offerings = snapshot?.offerings ?? [];
  const basicsReady = isStaySettingsComplete(settings);
  const detailsReady =
    (settings?.amenities?.length ?? 0) > 0 ||
    (settings?.accessibility_features?.length ?? 0) > 0;
  const supplyReady = offerings.length > 0;
  const availabilityReady = offerings.some(
    (offering) =>
      offering.hasOpenAvailability === true &&
      offering.currentPrice !== null &&
      offering.currentPrice !== undefined &&
      offering.currentPolicy !== null &&
      offering.currentPolicy !== undefined &&
      (offering.media ?? []).some(
        (media) => media.is_cover === true && media.status === "ready",
      ),
  );
  const liveSupply = offerings.some((offering) => offering.status === "live");
  const bankReady =
    currency.data?.authority === "settlement" &&
    currency.data.canAcceptPaidReservations;
  const mandatoryChecks = [
    basicsReady,
    supplyReady,
    availabilityReady,
    bankReady,
    venueApproved,
  ];
  const completeCount = mandatoryChecks.filter(Boolean).length;
  const isActive = settings?.booking_state === "active" && liveSupply;
  const publishBlocked =
    !basicsReady ||
    !supplyReady ||
    !availabilityReady ||
    !bankReady ||
    !venueApproved ||
    settings === null;

  // #3645 — accepting the Organiser Terms continues the publish that opened
  // them. The ref holds the latest handler so the resumed run reads current
  // settings.
  const resumePublishStayRef = React.useRef<() => void>(() => undefined);
  const handlePublishStay = useCallback((): void => {
    if (settings === null) return;
    // Stay publish requires a current price → always paid for Organiser Terms.
    if (
      blockPaidPublishUntilAccepted(true, () => {
        setOrganiserTermsToast(false);
        resumePublishStayRef.current();
      })
    ) {
      setOrganiserTermsToast(true);
      return;
    }
    setTermsUnresolved(null);
    publish.mutate(
      { expectedVersion: settings.version },
      {
        // #3645 — the server refused for want of the Organiser Terms although
        // the app thought they were accepted. Open the acceptance sheet and
        // publish again once accepted.
        onError: (error) => {
          if (!isOrganiserTermsRefusalMessage(error.message)) return;
          acceptTermsAfterServerRefusal(
            () => resumePublishStayRef.current(),
            (reason) => setTermsUnresolved(organiserTermsUnresolvedCopy(reason)),
          );
        },
      },
    );
  }, [
    settings,
    blockPaidPublishUntilAccepted,
    acceptTermsAfterServerRefusal,
    publish,
  ]);
  React.useEffect(() => {
    resumePublishStayRef.current = handlePublishStay;
  }, [handlePublishStay]);

  if (inventory.isLoading || currency.isLoading) {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator color={color.accent} />
        <Text style={styles.helper}>Checking Stay readiness…</Text>
      </View>
    );
  }

  if (inventory.isError || currency.isError || snapshot === null) {
    return (
      <View style={styles.centerState}>
        <Text style={styles.stateTitle}>Stay setup could not load</Text>
        <Text style={styles.helper}>
          Check your connection, then reload. Nothing has been changed.
        </Text>
        <Button
          label="Try again"
          onPress={() => {
            void inventory.refetch();
            void currency.refetch();
          }}
          variant="secondary"
          size="md"
        />
      </View>
    );
  }

  // Declared ONCE and rendered by both branches, so the desktop grid and the
  // phone column can never drift apart.
  const readinessRows = (
    <>
      <ChecklistRow
        title="Stay basics"
        detail={
          basicsReady
            ? "Summary, local time and arrival times saved"
            : "Add a summary, timezone and arrival times"
        }
        complete={basicsReady}
        onPress={() => onSelect("settings")}
        icon="home"
        testID="stay-check-basics"
        wide={isWideDesktop}
      />
      <ChecklistRow
        title="Amenities & accessibility"
        detail={
          detailsReady
            ? "Property-level guest details added"
            : "Describe amenities and accessibility"
        }
        complete={detailsReady}
        optional
        onPress={() => onSelect("settings")}
        icon="sparkle"
        testID="stay-check-amenities"
        wide={isWideDesktop}
      />
      <ChecklistRow
        title="Rooms & Places"
        detail={
          supplyReady
            ? `${offerings.length} offering${offerings.length === 1 ? "" : "s"} added`
            : "Add at least one Room or reservable Place"
        }
        complete={supplyReady}
        onPress={() => onSelect("rooms_places")}
        icon="grid"
        testID="stay-check-inventory"
        wide={isWideDesktop}
      />
      <ChecklistRow
        title="Availability & pricing"
        detail={
          availabilityReady
            ? "At least one offering has a cover, policy, price and open inventory"
            : "Open dates or Place windows and finish pricing"
        }
        complete={availabilityReady}
        onPress={() => onSelect("availability_pricing")}
        icon="calendar"
        testID="stay-check-availability"
        wide={isWideDesktop}
      />
      <ChecklistRow
        title="Bank & currency"
        detail={
          bankReady
            ? `${currency.data?.currencyCode ?? ""} is fixed by the connected payout account`
            : currency.data?.authority === "provisional"
              ? `${currency.data.currencyCode ?? ""} is provisional · connect a bank to accept reservations`
              : "Connect a compatible bank to accept paid reservations"
        }
        complete={bankReady}
        onPress={() => router.push(`/brand/${brandId}/payments` as never)}
        icon="bank"
        testID="stay-check-bank"
        wide={isWideDesktop}
      />
      <ChecklistRow
        title="Venue review"
        detail={
          venueApproved
            ? "Mingla has approved this venue listing"
            : "Venue verification is still pending"
        }
        complete={venueApproved}
        onPress={() => onSelect("settings")}
        icon="shield"
        testID="stay-check-review"
        wide={isWideDesktop}
      />
    </>
  );

  const managementRows = (
    <>
      <ManagementRow
        title="Rooms & Places"
        detail="Manage what guests can reserve"
        onPress={() => onSelect("rooms_places")}
        icon="grid"
        testID="stay-manage-inventory"
        wide={isWideDesktop}
      />
      <ManagementRow
        title="Availability & pricing"
        detail="Keep dates, prices and policies current"
        onPress={() => onSelect("availability_pricing")}
        icon="calendar"
        testID="stay-manage-availability"
        wide={isWideDesktop}
      />
      <ManagementRow
        title="Reservations"
        detail="Review and manage guest bookings"
        onPress={() => onSelect("reservations")}
        icon="notebook"
        testID="stay-manage-reservations"
        wide={isWideDesktop}
      />
      <ManagementRow
        title="Stay settings"
        detail="Update property details and guest information"
        onPress={() => onSelect("settings")}
        icon="settings"
        testID="stay-manage-settings"
        wide={isWideDesktop}
      />
    </>
  );

  return (
    <View style={styles.moduleRoot}>
    <ScrollView
      contentContainerStyle={isWideDesktop ? styles.pageDesktop : styles.page}
      // #1532 §2 — missing from EVERY Stay scroller. Without it the FIRST tap
      // on any control while a keyboard is open only dismisses the keyboard
      // (Constitution #1 dead tap).
      keyboardShouldPersistTaps="handled"
      testID="stay-overview-scroll"
    >
      <View style={styles.titleRow}>
        <View style={styles.titleCopy}>
          {/* #4420 — the venue name already heads the page right above. */}
          <Text style={styles.pageTitle}>Stay overview</Text>
        </View>
        <View style={[styles.statePill, isActive && styles.statePillLive]}>
          <Text
            style={[styles.statePillText, isActive && styles.statePillTextLive]}
          >
            {isActive
              ? "Live"
              : settings?.booking_state === "review"
                ? "In review"
                : "Not live"}
          </Text>
        </View>
      </View>
      {header}

      {isActive ? (
        <GlassCard
          variant="elevated"
          contentStyle={styles.readinessCard}
          testID="stay-live-management"
        >
          <View style={styles.readinessHead}>
            <View style={styles.titleCopy}>
              <Text style={styles.cardTitle}>Manage your live Stay</Text>
            </View>
          </View>
          {isWideDesktop ? (
            <View style={styles.readinessGrid} testID="stay-management-grid">
              {managementRows}
            </View>
          ) : (
            managementRows
          )}
        </GlassCard>
      ) : (
      <GlassCard variant="elevated" contentStyle={styles.readinessCard}>
        <View style={styles.readinessHead}>
          <View>
            <Text style={styles.cardTitle}>Ready to publish</Text>
            <Text style={styles.helper}>
              {completeCount} of {mandatoryChecks.length} required checks
              complete
            </Text>
          </View>
          <Text style={styles.readinessCount}>
            {Math.round((completeCount / mandatoryChecks.length) * 100)}%
          </Text>
        </View>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${(completeCount / mandatoryChecks.length) * 100}%` },
            ]}
          />
        </View>

        {/* #1484 P1-2 — the readiness rows reflow into a multi-column grid on
            wide desktop. The grid style MUST sit on the element that directly
            PARENTS the rows: `GlassCard` renders its children inside its own
            inner padding View, so `flexDirection: "row"` passed as the card's
            `style` lands on the OUTER card and never reaches the rows. That
            left `flexBasis` resolving against a COLUMN main axis — i.e. as a
            HEIGHT — stretching every row to 320px tall and the card to ~2,340px.
            The wrapper below is the real parent. It renders ONLY on desktop;
            the phone branch emits the rows as a bare fragment (no host node),
            so the phone/native host tree stays byte-identical to today. */}
        {isWideDesktop ? (
          <View style={styles.readinessGrid} testID="stay-readiness-grid">
            {readinessRows}
          </View>
        ) : (
          readinessRows
        )}
      </GlassCard>
      )}

      {publishBlocked && !isActive ? (
        <View style={styles.blocker}>
          <Text style={styles.blockerTitle}>Publishing is safely blocked</Text>
          <Text style={styles.blockerBody}>
            Complete every required row above. Reserve stays unavailable until
            this exact brand has a compatible bank and bookable supply.
          </Text>
        </View>
      ) : null}
      {publish.isError ? (
        <Text style={styles.error}>
          {publishErrorCopy(publish.error, termsUnresolved)}
        </Text>
      ) : null}
      {!isActive && isWideDesktop ? (
        <Button
          label="Publish Stay"
          onPress={handlePublishStay}
          disabled={publishBlocked}
          loading={publish.isPending}
          fullWidth
          size="lg"
          testID="stay-publish"
        />
      ) : null}
    </ScrollView>
    {/* #1532 D5 — the module's primary action is PINNED, not buried at the
        bottom of a scroll under 144pt of dead padding. Hidden while the
        keyboard is up (Overview has no fields, but the rule is one rule). */}
    {!isActive && !isWideDesktop ? (
    <StayActionBar testID="stay-overview-action-bar">
      <Button
        label="Publish Stay"
        onPress={handlePublishStay}
        disabled={publishBlocked}
        loading={publish.isPending}
        fullWidth
        size="lg"
        testID="stay-publish"
      />
    </StayActionBar>
    ) : null}
    {organiserTermsGateElement}
    {organiserTermsToast ? (
      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible
          kind="info"
          message={ORGANISER_TERMS_PUBLISH_RETRY_TOAST}
          onDismiss={() => setOrganiserTermsToast(false)}
        />
      </View>
    ) : null}
    </View>
  );
}

interface StaySettingsProps {
  brandId: string;
  venueId: string;
  onOpenSpaces: () => void;
}

function StaySettings({
  brandId,
  venueId,
  onOpenSpaces,
}: StaySettingsProps): React.ReactElement {
  // #1484 — desktop gate ONLY via the canonical hook (I-DESKTOP-GATE-VIA-HOOK).
  const { isWideDesktop } = useResponsiveLayout();
  const inventory = useStayInventory(venueId);
  const save = useSaveStaySettings(venueId);
  const settings = inventory.data?.settings ?? null;
  /**
   * #1532 §3 — THE SILENT OVERWRITE, and the sharpest of the seven state-loss
   * paths because it needs NO user action at all.
   *
   * The seeding effect below used to depend on the `settings` OBJECT. React
   * Query hands back a NEW object identity on every refetch — a window focus, a
   * reconnect, a background poll — so an operator typing into these ten fields
   * had their work replaced by the server snapshot mid-sentence, with nothing
   * on screen to explain it.
   *
   * The row carries a monotonic `version`, which is the actual identity of "the
   * server state changed". Seeding once per version means a refetch that
   * returns the SAME row is a no-op, while a genuinely newer row still seeds.
   */
  const seededVersionRef = useRef<number | null>(null);
  const [propertyKind, setPropertyKind] = useState<StayPropertyKind | null>(
    null,
  );
  const [summary, setSummary] = useState("");
  const [timezone, setTimezone] = useState("");
  const [checkIn, setCheckIn] = useState("15:00");
  const [checkOut, setCheckOut] = useState("11:00");
  const [mode, setMode] = useState<StayBookingMode>("request");
  const [amenities, setAmenities] = useState("");
  const [accessibility, setAccessibility] = useState("");
  const [arrival, setArrival] = useState("");
  const [houseRules, setHouseRules] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings === null) return;
    if (seededVersionRef.current === settings.version) return;
    seededVersionRef.current = settings.version;
    setPropertyKind(settings.property_kind);
    setSummary(settings.summary ?? "");
    setTimezone(settings.timezone);
    setCheckIn(settings.check_in_time.slice(0, 5));
    setCheckOut(settings.check_out_time.slice(0, 5));
    setMode(settings.default_booking_mode);
    setAmenities(joinTags(settings.amenities));
    setAccessibility(joinTags(settings.accessibility_features));
    setArrival(settings.arrival_instructions ?? "");
    setHouseRules(settings.house_rules ?? "");
  }, [settings]);

  const valid = isStaySettingsFormValid({
    summary,
    timezone,
    checkIn,
    checkOut,
  });

  const submit = (): void => {
    if (!valid) return;
    setSaved(false);
    const input: StaySettingsInput = {
      propertyKind,
      summary: summary.trim(),
      timezone: timezone.trim(),
      checkInTime: checkIn,
      checkOutTime: checkOut,
      defaultBookingMode: mode,
      amenities: splitTags(amenities),
      accessibilityFeatures: splitTags(accessibility),
      arrivalInstructions: arrival.trim() || null,
      houseRules: houseRules.trim() || null,
      bookingState: settings?.booking_state === "active" ? "active" : "review",
    };
    save.mutate(
      { settings: input, expectedVersion: settings?.version ?? null },
      { onSuccess: () => setSaved(true) },
    );
  };

  if (inventory.isLoading) {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator color={color.accent} />
        <Text style={styles.helper}>Loading Stay settings…</Text>
      </View>
    );
  }

  return (
    <View style={styles.moduleRoot}>
    {/* #1484 — Settings is an EDITABLE FORM, so on wide desktop it keeps a
        readable-measure cap (`suiteFormMaxWidth`) instead of stretching to the
        full workspace width — but LEFT-anchored, flush with the rail seam. */}
    <ScrollView
      contentContainerStyle={isWideDesktop ? styles.pageForm : styles.page}
      keyboardShouldPersistTaps="handled"
      testID="stay-settings-scroll"
    >
      <View style={styles.sectionHead}>
        <Text style={styles.pageTitle}>Stay settings</Text>
        <Text style={styles.helper}>
          These are property-level details. Each Room and Place keeps its own
          description, photos, amenities, price, fees and policy.
        </Text>
      </View>

      {/* #1532 §4 — `contentStyle`. On `style` this 16pt gap reached a node
          with one in-flow child and rendered as 0, which is why every field
          here needed a `marginTop` hack to look separated at all. */}
      <GlassCard variant="base" contentStyle={styles.formCard}>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Property type (optional)</Text>
          <View style={styles.chipWrap}>
            {PROPERTY_KINDS.map((kind) => (
              <Pressable
                key={kind.id}
                accessibilityRole="radio"
                accessibilityLabel={kind.label}
                accessibilityState={{ checked: propertyKind === kind.id }}
                onPress={() => setPropertyKind(kind.id)}
                style={[
                  styles.choiceChip,
                  propertyKind === kind.id && styles.choiceChipActive,
                ]}
              >
                <Text
                  style={[
                    styles.choiceText,
                    propertyKind === kind.id && styles.choiceTextActive,
                  ]}
                >
                  {kind.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Field
          label="Stay summary"
          // #1532 §4 — the hint used to be a SIBLING rendered AFTER the input,
          // so it sat between one field's box and the next field's label and
          // read as belonging to either. Helpers go between the label and the
          // input, always (the #1501 field anatomy, now applied here too).
          helper="At least 20 characters. Guests read this first."
          value={summary}
          onChangeText={setSummary}
          placeholder="What makes this property worth staying at?"
          multiline
          testID="stay-settings-summary"
        />
        <Field
          label="Local time zone"
          helper="The zone your front desk works in — arrival times are read against it."
          value={timezone}
          onChangeText={setTimezone}
          placeholder="Africa/Lagos"
          testID="stay-settings-timezone"
        />
        <View style={styles.twoCol}>
          <View style={styles.flexOne}>
            <Field
              label="Check-in"
              value={checkIn}
              onChangeText={setCheckIn}
              placeholder="15:00"
              testID="stay-settings-checkin"
            />
          </View>
          <View style={styles.flexOne}>
            <Field
              label="Check-out"
              value={checkOut}
              onChangeText={setCheckOut}
              placeholder="11:00"
              testID="stay-settings-checkout"
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Default confirmation</Text>
          <View style={styles.twoCol}>
            {(["instant", "request"] as const).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityLabel={
                  value === "instant"
                    ? "Instant confirmation"
                    : "Request confirmation"
                }
                accessibilityState={{ checked: mode === value }}
                onPress={() => setMode(value)}
                style={[
                  styles.modeCard,
                  mode === value && styles.modeCardActive,
                ]}
              >
                <Text style={styles.rowTitle}>
                  {value === "instant" ? "Instant" : "Request"}
                </Text>
                <Text style={styles.rowDetail}>
                  {value === "instant"
                    ? "Confirm after payment"
                    : "Staff approves before payment"}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Field
          label="Property amenities"
          helper="Separate each one with a comma."
          value={amenities}
          onChangeText={setAmenities}
          placeholder="Pool, Wi-Fi, breakfast, gym"
          testID="stay-settings-amenities"
        />
        <Field
          label="Accessibility"
          helper="Separate each one with a comma."
          value={accessibility}
          onChangeText={setAccessibility}
          placeholder="Step-free entrance, lift, accessible bathroom"
          testID="stay-settings-accessibility"
        />
        <Field
          label="Arrival instructions"
          value={arrival}
          onChangeText={setArrival}
          placeholder="Where guests check in and what they should bring"
          multiline
          testID="stay-settings-arrival"
        />
        <Field
          label="House rules"
          value={houseRules}
          onChangeText={setHouseRules}
          placeholder="Quiet hours, visitors, smoking and other rules"
          multiline
          testID="stay-settings-rules"
        />
      </GlassCard>

      {/* #4490 J fix 2 (R4J-N2): this section sits INSIDE the settings
          scroller, so it and its fallback take their natural height (no
          `flex: 1`). The page's `STAY_PAGE_BOTTOM_PAD` then clears the pinned
          Save bar below the last switch and the Spaces card. */}
      <View
        style={styles.featureSettingsSection}
        testID="stay-settings-features-section"
      >
        <View style={styles.sectionHead}>
          <Text style={styles.pageTitle}>Venue type and features</Text>
          <Text style={styles.helper}>
            Add the other things guests can buy and your team can run here.
          </Text>
        </View>
        <React.Suspense
          fallback={
            <View style={styles.featureSettingsFallback}>
              <ActivityIndicator color={color.accent} />
            </View>
          }
        >
          <LazyVenueTypeAndFeaturesPanel
            brandId={brandId}
            venueId={venueId}
            onOpenSpaces={onOpenSpaces}
            layout="stacked"
          />
        </React.Suspense>
      </View>

      {save.isError ? (
        <Text style={styles.error}>
          We couldn’t save these settings. Reload and try again.
        </Text>
      ) : null}
      {isWideDesktop ? (
        <Button
          label={saved ? "Saved" : "Save Stay settings"}
          onPress={submit}
          disabled={!valid}
          loading={save.isPending}
          fullWidth
          size="lg"
          testID="stay-settings-save"
        />
      ) : null}
    </ScrollView>
    {/* #1532 D5 — pinned, and HIDDEN while the keyboard is up: the
        `KeyboardToolbar` already owns the band above the keyboard, and two
        stacked bars would eat ~160pt of a ~470pt visible band. */}
    {!isWideDesktop ? (
    <StayActionBar testID="stay-settings-action-bar">
      <Button
        label={saved ? "Saved" : "Save Stay settings"}
        onPress={submit}
        disabled={!valid}
        loading={save.isPending}
        fullWidth
        size="lg"
        testID="stay-settings-save"
      />
    </StayActionBar>
    ) : null}
    </View>
  );
}

function Field({
  label,
  helper,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  testID,
}: {
  label: string;
  /** #1532 §4 — sits between the label and the input, never after it. */
  helper?: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  testID: string;
}): React.ReactElement {
  return (
    <View style={styles.field} testID={`${testID}-field`}>
      {/* #1532 §4 — label and helper are ONE unit at 2pt; the 8pt below this
          block is what separates them from the input. That difference is the
          whole grouping: the eye reads two things, not three. */}
      <View style={styles.fieldLabelBlock}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {helper !== undefined ? (
          <Text style={styles.fieldHint}>{helper}</Text>
        ) : null}
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={color.text3}
        multiline={multiline}
        accessibilityLabel={label}
        accessibilityHint={helper}
        style={[styles.input, multiline && styles.inputMultiline]}
        testID={testID}
      />
    </View>
  );
}

export interface StaySuiteShellProps {
  brandId: string;
  venueId: string;
  venueName: string;
  venueApproved: boolean;
  /**
   * #4420 B8 — content that scrolls with the Overview module (the venue page's
   * Local reviews panel). Never pinned above the suite's scroll.
   */
  overviewHeader?: React.ReactNode;
  initialModule?: VenueModule;
  initialItemId?: string | null;
  /** Raw `?module=` value, so a refused deep link can be corrected in the address. */
  requestedModule?: string | null;
  onModuleChange?: (module: StayModule) => void;
}

export function StaySuiteShell({
  brandId,
  venueId,
  venueApproved,
  overviewHeader = null,
  initialModule = "overview",
  initialItemId = null,
  requestedModule = null,
  onModuleChange,
}: StaySuiteShellProps): React.ReactElement {
  // R4J-N8 — the route's parser only knows venue modules, so the two Stay-only
  // keys arrive as overview. Resolve the raw `?module=` first, through the
  // shell's own lists, then fall back to what the route passed.
  const resolveStayModule = (raw: string | null | undefined): StayModule | null => {
    if (raw === null || raw === undefined || raw.length === 0) return null;
    if (raw === "availability") return "availability_pricing";
    const found = [...CORE_MODULES, ...FEATURE_MODULES].find(
      (module) => module.id === raw,
    );
    return found === undefined ? null : found.id;
  };
  const initialStayModule: StayModule =
    resolveStayModule(requestedModule) ??
    resolveStayModule(initialModule) ??
    "overview";
  const [activeModule, setActiveModule] = useState<StayModule>(initialStayModule);
  const lastToldModuleRef = useRef<StayModule>(initialStayModule);
  const [requestItem, setRequestItem] = useState<string | null>(null);
  const [membersView, setMembersView] = useState<
    "members" | "plans" | "new_plan"
  >("members");
  const offersRef = useRef<VenueModuleLeaveHandle | null>(null);
  const spacesRef = useRef<VenueModuleLeaveHandle | null>(null);
  const membersRef = useRef<VenueModuleLeaveHandle | null>(null);
  // §13 — Table reservations shows the bookings or the table times and rules
  // (hours + Table times). The times view owns its leave dialog, exactly as
  // "Availability & pricing" does in the ordinary shell.
  const [tableView, setTableView] = useState<"bookings" | "times">("bookings");
  const tableTimesRef = useRef<VenueAvailabilityLeaveHandle | null>(null);
  // Reservations › "Edit floor" opens Spaces on that space's tables; Table
  // times › "Open tables" opens Spaces › Tables with no space chosen.
  const [spacesTarget, setSpacesTarget] = useState<{
    view: "tables";
    spaceId: string | null;
  } | null>(null);
  const [pendingLeave, setPendingLeave] = useState<{
    from: StayModule;
    proceed: () => void;
    restoreFocus: (() => void) | null;
  } | null>(null);
  const [leaveSaving, setLeaveSaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  // #1484 — desktop gate ONLY via the canonical hook (I-DESKTOP-GATE-VIA-HOOK).
  const { isWideDesktop } = useResponsiveLayout();
  const venueAccessQuery = useMyVenueAccess(venueId);
  const venueAccess = venueAccessQuery.data ?? {
    scoped: true,
    capabilities: [],
    canSell: false,
  };
  const featuresQuery = useVenueFeatures(brandId, venueId);
  // #4490 spec 08 O1 — the Till's release switch (fails closed).
  const tillReleased = useTillReleased();
  const coreModules = useMemo(() => {
    if (!venueAccess.scoped) return CORE_MODULES;
    const scoped: StayModuleMeta[] = [];
    if (venueAccess.capabilities.includes("stay.view_availability")) {
      const availability = CORE_MODULES.find(
        (module) => module.id === "availability_pricing",
      );
      if (availability) scoped.push(availability);
    }
    if (
      venueAccess.capabilities.includes("stay.view_reservations") ||
      venueAccess.capabilities.includes("stay.create_reservations") ||
      venueAccess.capabilities.includes("stay.manage_reservations")
    ) {
      const reservations = CORE_MODULES.find(
        (module) => module.id === "reservations",
      );
      if (reservations) scoped.push(reservations);
    }
    return scoped;
  }, [venueAccess.capabilities, venueAccess.scoped]);

  // R4J-N23 — the ordinary shell keeps Spaces reachable when the host asked
  // for it (Settings › "Add spaces"), when a switched-on feature still waits
  // for a space, and for staff who manage offers. The Stay workspace asks the
  // same shared rule the same way. It has no classic Tables destination
  // (§13's twelve), so a feature waiting for TABLES also asks for Spaces:
  // Spaces › Tables is where a Stay adds them.
  const spacesRequestedVenueId = useVenueSuiteStore(
    (s) => s.spacesRequestedVenueId,
  );
  // The venue modules the ordinary shell would show this person here.
  const allowedVenueModules = useMemo((): ReadonlySet<VenueModule> => {
    if (featuresQuery.data === undefined) return new Set();
    const setupNeedsSpaces = featureSetupNeeds({
      features: featuresQuery.data.features,
      activeSpaceCount: featuresQuery.data.activeSpaceCount,
    }).some((need) => need.target === "spaces" || need.target === "tables");
    const derived = deriveVenueNav({
      features: featuresQuery.data.features,
      activeSpaceCount: featuresQuery.data.activeSpaceCount,
      venueCategory: "stay",
      noStoredFeatures: hasNoStoredFeatures(featuresQuery.data.features),
      spacesRequested:
        spacesRequestedVenueId === venueId ||
        setupNeedsSpaces ||
        scopedStaffManagesOffers(venueAccess.scoped, venueAccess.capabilities),
      tillReleased,
    });
    return new Set(
      withCloseAccess(
        withStationsAccess(
          withTillAccess(
            filterVenueModulesForCapabilities(
              derived,
              venueAccess.scoped,
              venueAccess.capabilities,
            ),
            venueAccess.canSell === true,
          ),
          venueAccess.canKitchen === true,
        ),
        venueAccess.canManageMoney === true,
      ),
    );
  }, [
    featuresQuery.data,
    tillReleased,
    venueAccess.canSell,
    venueAccess.canKitchen,
    venueAccess.canManageMoney,
    spacesRequestedVenueId,
    venueAccess.capabilities,
    venueAccess.scoped,
    venueId,
  ]);

  const featureModules = useMemo(
    () =>
      FEATURE_MODULES.filter((module) =>
        allowedVenueModules.has(STAY_FEATURE_VENUE_MODULE[module.id]),
      ),
    [allowedVenueModules],
  );
  // Table times and rules: the ordinary shell's "availability" rules, and its
  // Table times only for those who manage reservations.
  const showTableTimesView =
    featuresQuery.data?.features.table_reservations.enabled === true &&
    allowedVenueModules.has("availability");

  const visibleModules = useMemo(() => {
    return [...coreModules, ...featureModules];
  }, [coreModules, featureModules]);

  useEffect(() => {
    if (lastToldModuleRef.current === activeModule) return;
    lastToldModuleRef.current = activeModule;
    onModuleChange?.(activeModule);
  }, [activeModule, onModuleChange]);

  // #4490 D2 — a deep link the Stay shell cannot show (`?module=bogus`,
  // `?module=waitlist`) opens Overview; once access and features have settled,
  // tell the route once so the address names what is shown.
  const addressCheckedRef = useRef(false);
  const addressSettled =
    venueAccessQuery.isFetched &&
    (featuresQuery.data !== undefined || featuresQuery.isError);
  useEffect(() => {
    if (addressCheckedRef.current || !addressSettled) return;
    addressCheckedRef.current = true;
    if (requestedModule === null || requestedModule.length === 0) return;
    if (requestedModule === activeModule) return;
    lastToldModuleRef.current = activeModule;
    onModuleChange?.(activeModule);
  }, [activeModule, addressSettled, onModuleChange, requestedModule, venueAccessQuery.isFetched]);

  const getLeaveHandle = useCallback(
    (module: StayModule): VenueModuleLeaveHandle | null => {
      if (module === "offers") return offersRef.current;
      if (module === "spaces") return spacesRef.current;
      if (module === "members") return membersRef.current;
      return null;
    },
    [],
  );
  // The table times view (hours + Table times) is open: it owns its leave
  // dialog, as "Availability & pricing" does in the ordinary venue shell.
  const tableTimesOpen =
    activeModule === "table_reservations" && tableView === "times";
  const requestLeave = useCallback(
    (proceed: () => void, restoreFocus?: () => void): void => {
      if (tableTimesOpen && tableTimesRef.current !== null) {
        tableTimesRef.current.requestLeave(proceed, restoreFocus);
        return;
      }
      const handle = getLeaveHandle(activeModule);
      if (handle !== null && handle.isDirty()) {
        setLeaveError(null);
        setPendingLeave({
          from: activeModule,
          proceed,
          restoreFocus: restoreFocus ?? null,
        });
        return;
      }
      proceed();
    },
    [activeModule, getLeaveHandle, tableTimesOpen],
  );
  const selectModule = useCallback(
    (next: StayModule): void => {
      // #4490 spec 08 O1 — the Till is a full-screen route: the rail opens it
      // and this workspace (with any unsaved edit) stays underneath.
      if (next === "till") {
        appRouter.push(tillHref(venueId) as never);
        return;
      }
      // #4490 spec 08 O3 — Kitchen and bar is a full-screen route too.
      if (next === "stations") {
        appRouter.push(stationHref(venueId) as never);
        return;
      }
      // #4490 spec 08 O5 part B — Close the day is a full-screen route too.
      if (next === "close") {
        appRouter.push(closeHref(venueId) as never);
        return;
      }
      if (next === activeModule) return;
      requestLeave(() => {
        setActiveModule(next);
        // Table reservations opens on its bookings next time.
        setTableView("bookings");
      });
    },
    [activeModule, requestLeave, venueId],
  );
  // #4490 spec 08 O1 — `?module=till` (a link or a reload) opens the Till
  // itself once it is shown here, replacing the address so Back from the
  // Till never bounces straight back into it.
  const tillDeepLinkRef = useRef(initialStayModule === "till");
  useEffect(() => {
    if (!tillDeepLinkRef.current) return;
    if (!visibleModules.some((module) => module.id === "till")) return;
    tillDeepLinkRef.current = false;
    appRouter.replace(tillHref(venueId) as never);
  }, [venueId, visibleModules]);
  // #4490 spec 08 O3 — `?module=stations` opens the station screen the same way.
  const stationsDeepLinkRef = useRef(initialStayModule === "stations");
  useEffect(() => {
    if (!stationsDeepLinkRef.current) return;
    if (!visibleModules.some((module) => module.id === "stations")) return;
    stationsDeepLinkRef.current = false;
    appRouter.replace(stationHref(venueId) as never);
  }, [venueId, visibleModules]);
  // #4490 spec 08 O5 part B — `?module=close` opens Close the day the same way.
  const closeDeepLinkRef = useRef(initialStayModule === "close");
  useEffect(() => {
    if (!closeDeepLinkRef.current) return;
    if (!visibleModules.some((module) => module.id === "close")) return;
    closeDeepLinkRef.current = false;
    appRouter.replace(closeHref(venueId) as never);
  }, [venueId, visibleModules]);
  // "Edit floor" targets one space's tables once; Spaces opened later from the
  // rail starts on its list again.
  useEffect(() => {
    if (activeModule !== "spaces" && spacesTarget !== null) setSpacesTarget(null);
  }, [activeModule, spacesTarget]);
  // Bookings ↔ Table times and rules, through the same leave gate.
  const selectTableView = useCallback(
    (next: "bookings" | "times"): void => {
      if (next === tableView) return;
      requestLeave(() => setTableView(next));
    },
    [requestLeave, tableView],
  );

  // #4490 D3 — page exits (header Back) go through the route's store gate.
  const setRequestLeave = useVenueSuiteStore((s) => s.setRequestLeave);
  useEffect(() => {
    setRequestLeave(requestLeave);
    return (): void => setRequestLeave(null);
  }, [requestLeave, setRequestLeave]);

  // The times view reports unsaved hours or table rules through the store
  // (its handle only exposes requestLeave).
  const tableTimesDirty = useVenueSuiteStore((s) =>
    s.dirtyModules.has("availability"),
  );
  const tableTimesUnsaved = tableTimesOpen && tableTimesDirty;

  // Brand switch and browser close ask at the moment they happen, so a draft
  // typed after the module opened is still caught.
  useEffect(() => {
    const isDirtyNow = (): boolean =>
      tableTimesUnsaved ||
      (getLeaveHandle(activeModule)?.isDirty() ?? false);
    const flusher = async (): Promise<boolean> => !isDirtyNow();
    const flushers = (unsavedWork.flushers ??= new Set());
    flushers.add(flusher);
    const guard = (event: BeforeUnloadEvent): void => {
      if (!isDirtyNow()) return;
      event.preventDefault();
      event.returnValue = "You have unsaved changes.";
    };
    globalThis.addEventListener?.("beforeunload", guard);
    return (): void => {
      flushers.delete(flusher);
      globalThis.removeEventListener?.("beforeunload", guard);
    };
  }, [activeModule, getLeaveHandle, tableTimesUnsaved]);

  const handleLeaveKeep = useCallback((): void => {
    const restore = pendingLeave?.restoreFocus ?? null;
    setPendingLeave(null);
    setLeaveError(null);
    restore?.();
  }, [pendingLeave]);
  const handleLeaveDiscard = useCallback((): void => {
    if (pendingLeave === null) return;
    getLeaveHandle(pendingLeave.from)?.discard();
    const { proceed } = pendingLeave;
    setPendingLeave(null);
    setLeaveError(null);
    proceed();
  }, [getLeaveHandle, pendingLeave]);
  const handleLeaveSave = useCallback(async (): Promise<void> => {
    if (pendingLeave === null) return;
    const handle = getLeaveHandle(pendingLeave.from);
    if (handle === null || !handle.isValid()) return;
    setLeaveSaving(true);
    setLeaveError(null);
    try {
      await handle.save();
      const { proceed } = pendingLeave;
      setPendingLeave(null);
      proceed();
    } catch {
      setLeaveError(
        "Couldn't save your changes. They're still here, so try again.",
      );
    } finally {
      setLeaveSaving(false);
    }
  }, [getLeaveHandle, pendingLeave]);

  const railModules = useMemo<SuiteDesktopModule[]>(
    () => visibleModules.map((module) => ({ key: module.id, label: module.label })),
    [visibleModules],
  );
  // The shared shell is string-keyed; resolve through visible modules so an
  // unknown key can never write a bogus module into state (no `as` cast).
  const handleRailSelect = useCallback((key: string): void => {
    const next = visibleModules.find((module) => module.id === key);
    if (next !== undefined) selectModule(next.id);
  }, [selectModule, visibleModules]);

  useEffect(() => {
    if (
      !venueAccessQuery.isFetched ||
      (featuresQuery.data === undefined && !featuresQuery.isError) ||
      visibleModules.some((module) => module.id === activeModule)
    ) {
      return;
    }
    const first = visibleModules[0];
    if (first) setActiveModule(first.id);
  }, [
    activeModule,
    featuresQuery.data,
    featuresQuery.isError,
    venueAccessQuery.isFetched,
    visibleModules,
  ]);

  const renderWorkspace = (): React.ReactElement => {
    // R4J-N25 — on a Stay the venue reservations screen is "Table
    // reservations"; its heading and the waitlist's "seated" note say so.
    const tableReservationsLabel = stayModuleLabel("table_reservations");
    const lazyFallback = (
      <View style={styles.lazyModuleFallback}>
        <ActivityIndicator color={color.accent} />
      </View>
    );
    // A shared module's "open X" link: map the venue key to the Stay
    // destination (venue `reservations` → `table_reservations`) and open it
    // only when this person can see it here, like the ordinary shell does.
    const openFeatureModule = (next: VenueModule): void => {
      const target = stayTargetForVenueModule(next);
      if (target === null) return;
      if (!visibleModules.some((module) => module.id === target.module)) return;
      if (target.tableView === "times" && !showTableTimesView) return;
      const view = target.tableView;
      if (target.module === activeModule) {
        if (view !== undefined) selectTableView(view);
        return;
      }
      requestLeave(() => {
        setActiveModule(target.module);
        setTableView(view ?? "bookings");
      });
    };
    if (
      featuresQuery.data === undefined &&
      STAY_FEATURE_MODULE_ORDER.some((module) => module === activeModule)
    ) {
      return lazyFallback;
    }
    // R4J-N20 — scroll ownership follows the ordinary venue shell's rule
    // (`moduleSelfScrolls`). A venue screen that owns its scroll renders
    // straight into the workspace; every other one sits in the shell's page
    // ScrollView there, and the Stay workspace has no shell scroll, so it gets
    // the same page scroll here (with the Stay page's bottom clearance).
    // Without it Spaces, Today, Check-in, Menu, Orders and Guest list could
    // not scroll on a Stay at any width.
    const featurePage = (
      module: StayFeatureModule,
      body: React.ReactElement,
    ): React.ReactElement =>
      moduleSelfScrolls(STAY_FEATURE_VENUE_MODULE[module]) ? (
        body
      ) : (
        <ScrollView
          style={styles.flexOne}
          contentContainerStyle={styles.featurePage}
          keyboardShouldPersistTaps="handled"
          testID={`stay-feature-scroll-${module}`}
        >
          {body}
        </ScrollView>
      );
    if (activeModule === "overview") {
      return (
        <StayOverview
          brandId={brandId}
          venueId={venueId}
          venueApproved={venueApproved}
          onSelect={selectModule}
          header={overviewHeader}
        />
      );
    }
    if (activeModule === "settings") {
      return (
        <StaySettings
          brandId={brandId}
          venueId={venueId}
          // R4J-N23 — the panel has just asked the store for Spaces
          // (`requestSpaces`), so Spaces shows on this render even before a
          // space exists; open it without waiting for the old visible list.
          onOpenSpaces={() =>
            requestLeave(() => {
              setSpacesTarget(null);
              setActiveModule("spaces");
            })
          }
        />
      );
    }
    if (activeModule === "reservations") {
      return <StayReservationsModule venueId={venueId} />;
    }
    if (activeModule === "availability_pricing" && venueAccess.scoped) {
      return <StayStaffAvailabilityModule venueId={venueId} />;
    }
    if (activeModule === "offers") {
      return (
        <React.Suspense fallback={lazyFallback}>
          <LazyVenueOffersModule
            ref={offersRef}
            brandId={brandId}
            venueId={venueId}
            onOpenModule={openFeatureModule}
            initialOfferId={initialModule === "offers" ? initialItemId : null}
            onOpenMembers={(view) => {
              setMembersView(view);
              openFeatureModule("members");
            }}
          />
        </React.Suspense>
      );
    }
    if (activeModule === "spaces") {
      return featurePage(
        "spaces",
        <React.Suspense fallback={lazyFallback}>
          <LazyVenueSpacesModule
            key={
              spacesTarget === null
                ? "spaces"
                : `tables:${spacesTarget.spaceId ?? "any"}`
            }
            ref={spacesRef}
            brandId={brandId}
            venueId={venueId}
            initialView={spacesTarget?.view}
            initialSpaceId={spacesTarget?.spaceId ?? null}
            onOpenSettings={() => selectModule("settings")}
          />
        </React.Suspense>,
      );
    }
    if (activeModule === "today") {
      return featurePage(
        "today",
        <React.Suspense fallback={lazyFallback}>
          <LazyVenueTodayModule
            brandId={brandId}
            venueId={venueId}
            onOpenModule={openFeatureModule}
            showRequests={visibleModules.some(
              (module) => module.id === "requests",
            )}
          />
        </React.Suspense>,
      );
    }
    if (activeModule === "calendar") {
      return (
        <React.Suspense fallback={lazyFallback}>
          <LazyVenueCalendarModule
            brandId={brandId}
            venueId={venueId}
            onOpenRequest={
              visibleModules.some((module) => module.id === "requests")
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
    if (activeModule === "requests") {
      return (
        <React.Suspense fallback={lazyFallback}>
          <LazyVenueRequestsModule
            key={requestItem ?? "requests"}
            brandId={brandId}
            venueId={venueId}
            onOpenModule={openFeatureModule}
            initialGroupId={
              requestItem ??
              (initialModule === "requests" ? initialItemId : null)
            }
          />
        </React.Suspense>
      );
    }
    if (activeModule === "members") {
      return (
        <React.Suspense fallback={lazyFallback}>
          <LazyVenueMembersModule
            key={membersView}
            ref={membersRef}
            brandId={brandId}
            venueId={venueId}
            initialView={membersView}
            initialMemberId={initialModule === "members" ? initialItemId : null}
            onOpenModule={openFeatureModule}
          />
        </React.Suspense>
      );
    }
    // #4490 spec 08 O1 — a Till-only login lands here (never a blank shell).
    if (activeModule === "till") {
      return featurePage("till", <TillLauncher venueId={venueId} />);
    }
    // #4490 spec 08 O3 — a kitchen-only login lands here (never a blank shell).
    if (activeModule === "stations") {
      return featurePage("stations", <StationsLauncher venueId={venueId} />);
    }
    // #4490 spec 08 O5 part B — never a blank shell for Close the day.
    if (activeModule === "close") {
      return featurePage("close", <DayCloseLauncher venueId={venueId} />);
    }
    if (activeModule === "checkin") {
      return featurePage(
        "checkin",
        <React.Suspense fallback={lazyFallback}>
          <LazyVenueCheckInModule brandId={brandId} venueId={venueId} />
        </React.Suspense>,
      );
    }
    if (activeModule === "table_reservations") {
      const tabs = showTableTimesView ? (
        <Tabs
          items={[
            { key: "bookings", label: "Bookings", testID: "stay-table-view-bookings" },
            {
              key: "times",
              label: "Table times and rules",
              testID: "stay-table-view-times",
            },
          ]}
          value={tableView}
          onChange={selectTableView}
          style={styles.tableTabs}
          testID="stay-table-view-tabs"
        />
      ) : null;
      if (tableView === "times" && showTableTimesView) {
        return (
          <View style={styles.moduleRoot} testID="stay-table-times">
            {tabs}
            <ScrollView
              style={styles.flexOne}
              contentContainerStyle={styles.featurePage}
              keyboardShouldPersistTaps="handled"
              testID="stay-table-times-scroll"
            >
              <React.Suspense fallback={lazyFallback}>
                <LazyVenueAvailabilityPricingModule
                  ref={tableTimesRef}
                  brandId={brandId}
                  venueId={venueId}
                  tableReservationsOn
                  // R4J-N23 — "Open tables" lands on Spaces › Tables, where a
                  // Stay adds its tables (Spaces shows while tables are needed).
                  onOpenTables={
                    visibleModules.some((module) => module.id === "spaces")
                      ? () => {
                          requestLeave(() => {
                            setSpacesTarget({ view: "tables", spaceId: null });
                            setActiveModule("spaces");
                            setTableView("bookings");
                          });
                        }
                      : undefined
                  }
                  showTableTimes={
                    !venueAccess.scoped ||
                    venueAccess.capabilities.includes("restaurant.manage_reservations")
                  }
                  canEditHours={
                    !venueAccess.scoped ||
                    scopedStaffManagesOffers(venueAccess.scoped, venueAccess.capabilities)
                  }
                />
              </React.Suspense>
            </ScrollView>
          </View>
        );
      }
      return (
        <View style={styles.moduleRoot} testID="stay-table-bookings">
          {tabs}
          <VenueReservationsModule
            brandId={brandId}
            venueId={venueId}
            title={tableReservationsLabel}
            // R4J-N20 — on the stacked (phone / tablet) layout the Stay pill
            // band and venue header leave this screen too little height for
            // a fixed heading + toolbar above its list (the list measured 0
            // px at 390x844), so they scroll with the list inside its one
            // scroll owner. Desktop keeps the ordinary layout.
            chromeScrollsWithList={!isWideDesktop}
            scrollBottomPad={STAY_PAGE_BOTTOM_PAD}
            floorPlanOn={featuresQuery.data?.features.floor_plan.enabled === true}
            onEditFloor={
              visibleModules.some((module) => module.id === "spaces")
                ? (spaceId) => {
                    requestLeave(() => {
                      setSpacesTarget({ view: "tables", spaceId });
                      setActiveModule("spaces");
                    });
                  }
                : undefined
            }
          />
        </View>
      );
    }
    if (activeModule === "waitlist") {
      return featurePage(
        "waitlist",
        <VenueWaitlistModule
          brandId={brandId}
          venueId={venueId}
          reservationsLabel={tableReservationsLabel}
        />,
      );
    }
    if (activeModule === "menu") {
      return featurePage(
        "menu",
        <VenueMenuModule brandId={brandId} venueId={venueId} />,
      );
    }
    if (activeModule === "orders") {
      return featurePage(
        "orders",
        <React.Suspense fallback={lazyFallback}>
          <LazyVenueOrdersModule
            brandId={brandId}
            venueId={venueId}
            orderEntry={venueOrderEntry({
              tillReleased,
              tillFeatureOn: featuresQuery.data?.features.till.enabled === true,
              canSell: venueAccess.canSell === true,
            })}
          />
        </React.Suspense>,
      );
    }
    if (activeModule === "guestlist") {
      return featurePage(
        "guestlist",
        <React.Suspense fallback={lazyFallback}>
          <LazyVenueGuestListModule brandId={brandId} venueId={venueId} />
        </React.Suspense>,
      );
    }
    return (
      /**
       * #1532 defect 3 — `key` is the whole fix for the LYING TAB.
       *
       * Rooms & Places and Availability & pricing render the SAME component
       * type at the SAME tree position, distinguished only by `mode`. With no
       * key React reconciled them as one element and PRESERVED the instance —
       * so switching tab turned the pill orange while the open editor kept
       * rendering (its `if (editor !== null)` early-return fires before the
       * `mode` branch is ever read). The operator was told they were on
       * Availability & pricing while looking at the Add form: not a dead tap,
       * a lying one, and harder to recover from because nothing signals it.
       *
       * Keying on the module also stops scroll offset, `filter` and `search`
       * bleeding between the two — which is why Availability used to open
       * mid-form with its heading already scrolled off screen.
       */
      <StayInventoryManager
        key={activeModule}
        brandId={brandId}
        venueId={venueId}
        mode={activeModule === "rooms_places" ? "inventory" : "availability"}
      />
    );
  };

  const leaveHandle =
    pendingLeave === null ? null : getLeaveHandle(pendingLeave.from);
  const leaveDialog =
    pendingLeave === null ? null : (
      <React.Suspense fallback={null}>
        <LazyConfirmDialog
          visible
          variant="leave"
          title={`Save your ${stayModuleLabel(pendingLeave.from)} changes?`}
          description={formatLeaveChangedBody(
            leaveHandle?.changedLabels() ?? [],
          )}
          onClose={handleLeaveKeep}
          onConfirm={handleLeaveDiscard}
          onSave={() => void handleLeaveSave()}
          onDiscard={handleLeaveDiscard}
          saveDisabled={leaveHandle !== null && !leaveHandle.isValid()}
          confirmLoading={leaveSaving}
          errorMessage={
            leaveError ??
            (leaveHandle !== null && !leaveHandle.isValid()
              ? "These changes can't be saved yet. Keep editing to fix them."
              : null)
          }
          saveTestID="stay-suite-leave-save"
          discardTestID="stay-suite-leave-discard"
          keepTestID="stay-suite-leave-keep"
          testID="stay-suite-leave-dialog"
        />
      </React.Suspense>
    );

  if (
    !venueAccessQuery.isFetched ||
    (venueAccess.scoped && coreModules.length === 0 && featuresQuery.isLoading)
  ) {
    return (
      <View style={styles.accessState} testID="stay-access-loading">
        <ActivityIndicator color={color.accent} />
        <Text style={styles.helper}>Checking your Stay access…</Text>
      </View>
    );
  }
  if (venueAccessQuery.isError || (venueAccess.scoped && visibleModules.length === 0)) {
    return (
      <View style={styles.accessState} testID="stay-access-unavailable">
        <Text style={styles.pageTitle}>No Stay pages assigned</Text>
        <Text style={styles.helper}>
          Ask a brand owner or admin to assign the Stay or venue feature pages you need.
        </Text>
        {venueAccessQuery.isError || featuresQuery.isError ? (
          <Button
            label="Try again"
            onPress={() => {
              void venueAccessQuery.refetch();
              void featuresQuery.refetch();
            }}
            variant="secondary"
            size="md"
          />
        ) : null}
      </View>
    );
  }

  // ----- ONE tree at every width (#4490 J fix 2, R4J-N4). -----
  // Web desktop (>=1024px) shows the shared two-column rail; web-phone and
  // native show the WRAPPED pill band above the workspace. Both render through
  // the SAME `SuiteDesktopShell` element (`stackedHeader` selects the phone
  // presentation), so the workspace keeps one element path and crossing the
  // breakpoint swaps only the chrome: the open module stays mounted and an
  // unsaved draft, and the leave dialog's list of changes, survive the resize.
  // Every Stay module OWNS its own ScrollView (Overview, Settings,
  // Reservations, Availability, and the Inventory manager), so the shell must
  // NOT wrap them in a second same-axis scroll container —
  // `workspaceSelfScrolls` is always true here and `scrollBottomPad` is
  // therefore unused (0).
  /*
      #1532 D3 + defect 4 — THE PILL ROW IS NO LONGER A SCROLLER.

      Two separate defects died here.

      (1) THE KEYBOARD COLLAPSE. This row used to be a `ScrollView` from the
      `SmartScrollView` wrapper, which on native IS `KeyboardAwareScrollView`.
      That component appends a spacer sibling whose padding animates to the
      keyboard height. In a vertical scroller that is bottom padding and it is
      the entire point of the wrapper; in a HORIZONTAL one it is a row item,
      so it became a ~324pt-TALL child — and with no cross-axis alignment
      declared, RN's default `stretch` dragged every pill up to match it. The
      active pill measured 36.7pt closed and 323.7pt open, an 8.8x inflation
      that squeezed the workspace to ~0pt. A plain `View` receives no
      keyboard frames at all, so there is nothing left to inflate.

      (2) THE HIDDEN DESTINATIONS. Only 3 of the 5 pills were reachable at
      rest at 440pt, and a horizontal scroller offers no affordance that more
      exists — Settings was simply undiscoverable. Wrapping shows every
      module at every width, which was the requirement and is met.

      WHAT IT COSTS — measured on device (#1532 tester, iPhone 17 Pro Max),
      NOT the design's arithmetic, which was wrong:

        designed  2 rows /  96pt   <- assumed a pill width the labels do not
                                      have
        MEASURED  3 rows / 142.0pt <- the pills are content-sized and total
                                      ~813pt, so they wrap to THREE rows at
                                      440, 402, 390 AND 360

      So the band goes 53pt -> 142.0pt (+89pt), and the 144 -> 100pt page
      padding gives back 44pt: NET -45pt of workspace, not the "fully repaid"
      this comment used to claim. That claim never rendered.

      Deliberately NOT redesigned here: shrinking the pills would either
      truncate approved labels or push touch targets under the accessibility
      floor. The band cost is Seth's call, routed separately. See
      `STAY_PAGE_BOTTOM_PAD`.
  */
  const pillBand = isWideDesktop ? undefined : (
    <View style={styles.moduleNav} testID="stay-modules-band">
      <View style={styles.moduleNavContent}>
        {visibleModules.map((module) => {
          const selected = activeModule === module.id;
          return (
            <Pressable
              key={module.id}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={`${module.label} Stay module`}
              onPress={() => selectModule(module.id)}
              style={[styles.modulePill, selected && styles.modulePillActive]}
              testID={`stay-module-${module.id}`}
            >
              <Icon
                name={module.icon}
                size={16}
                color={selected ? color.canvas : color.text2}
              />
              <Text
                style={[
                  styles.moduleLabel,
                  selected && styles.moduleLabelActive,
                ]}
              >
                {module.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
  return (
    <>
      <View style={styles.root} testID="stay-suite-shell">
        <SuiteDesktopShell
          modules={railModules}
          activeModule={activeModule}
          onSelect={handleRailSelect}
          workspaceSelfScrolls
          scrollBottomPad={0}
          railTestIdPrefix="stay-rail-"
          testID={isWideDesktop ? "stay-suite-shell-desktop" : undefined}
          stackedHeader={pillBand}
        >
          {renderWorkspace()}
        </SuiteDesktopShell>
      </View>
      {leaveDialog}
    </>
  );
}

/**
 * Geometry shared by every Stay page measure. Kept OUTSIDE `StyleSheet.create`
 * so each measure below can be a COMPLETE object (see the note on `page`).
 */
const PAGE_BASE = {
  padding: space[4],
  // #1532 §4 — was `space[9] * 3` (144pt) of dead scroll sized for a bottom
  // nav that `/venue/[venueId]` does not render (it lives OUTSIDE `app/(tabs)/`).
  // Now exactly what the PINNED action bar occupies, plus one gutter.
  paddingBottom: STAY_PAGE_BOTTOM_PAD,
  // #1532 §4 — section -> section is the widest boundary on the page (32),
  // so the six sections read as six things rather than one wall.
  gap: STAY_SPACING.sectionToSection,
  width: "100%",
} as const;

const styles = StyleSheet.create({
  accessState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space[7],
    gap: space[2],
  },
  root: { flex: 1, backgroundColor: color.canvas },
  lazyModuleFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 160,
  },
  featureSettingsSection: { gap: space[4] },
  featureSettingsFallback: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 160,
  },
  // #1532 D5 — a module is a scroller PLUS a pinned bar, so it needs a
  // positioning host. `flex: 1` so the scroller still fills the workspace.
  moduleRoot: { flex: 1, minHeight: 0 },
  // §13 — Bookings / Table times and rules, above the Table reservations view.
  tableTabs: { paddingHorizontal: space[4], flexShrink: 0 },
  // The page scroll for venue screens that do not own one (R4J-N20): the
  // ordinary venue shell gives them its shell ScrollView; the Stay workspace
  // has none, so `featurePage` and the table times view use this.
  featurePage: { paddingBottom: STAY_PAGE_BOTTOM_PAD },
  moduleNav: {
    // #1532 defect 4 — chrome does not react to the keyboard. `flexShrink: 0`
    // is belt-and-braces (a bare RN View already defaults to it); what actually
    // fixed the collapse is that this band no longer contains a ScrollView at
    // all, so no keyboard spacer can be injected into it.
    flexShrink: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  // ROW-ONLY (I-AXIS-SCOPED-FLEX): declares its own `flexDirection`, so every
  // other key here is read against that one axis. `alignItems: "flex-start"` is
  // LOAD-BEARING — RN's default `stretch` is what let one tall sibling drag
  // every pill to its height, which is exactly how 36.7pt became 323.7pt.
  moduleNavContent: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    columnGap: space[2],
    rowGap: space[2],
  },
  modulePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
  },
  modulePillActive: {
    backgroundColor: color.accent,
    borderColor: color.accent,
  },
  moduleLabel: {
    ...type.small,
    color: color.text2,
    fontWeight: "600",
  },
  moduleLabelActive: { color: color.ink },
  // #1484 — the three page measures are COMPLETE, MUTUALLY EXCLUSIVE objects
  // and exactly ONE is selected (`isWideDesktop ? … : …`). They are NEVER
  // layered as `[page, <override setting maxWidth to undefined>]`: on
  // react-native-web such an override does NOT clear the base declaration — the
  // base's atomic `r-maxWidth-*` class survives into the DOM and the cap
  // silently persists, which is exactly how the desktop uncap shipped broken
  // the first time (#1484 P1-1). Omitting the KEY is the only thing the web
  // resolver honours, so `pageDesktop` simply does not declare `maxWidth` at
  // all. (ORCH-1184 did the same for `desktopCentered` — it DELETED the
  // property — which is why the venue suite was never affected.)
  page: {
    ...PAGE_BASE,
    // Phone / web-phone readable measure (unchanged; tokenised).
    maxWidth: stayPageMaxWidth,
    alignSelf: "center",
  },
  // WIDE DESKTOP: no `maxWidth` key AT ALL — the shared SuiteDesktopShell
  // workspace owns the gutters and the left anchor, so the content fills the
  // workspace flush with the rail seam.
  pageDesktop: {
    ...PAGE_BASE,
    alignSelf: "flex-start",
  },
  // WIDE DESKTOP, Settings EDITABLE FORM: uncapped fields on a wide monitor
  // stretch to an unreadable line length, so the form column keeps a readable
  // measure — left-anchored, not centred.
  pageForm: {
    ...PAGE_BASE,
    maxWidth: suiteFormMaxWidth,
    alignSelf: "flex-start",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[4],
  },
  titleCopy: { flex: 1 },
  pageTitle: { ...type.h1, color: color.text1 },
  helper: { ...type.small, color: color.text2 },
  statePill: {
    borderRadius: radius.full,
    backgroundColor: color.warningTint,
    paddingHorizontal: space[4],
    paddingVertical: space[1],
  },
  statePillLive: { backgroundColor: color.successTint },
  statePillText: {
    ...type.caption,
    color: color.text1,
    fontWeight: "700",
  },
  statePillTextLive: { color: color.success },
  // CONTENT-node measures (#1532 §4). These are passed as `contentStyle`, so
  // they land on the View that actually parents the children. On `style` they
  // reached `GlassChrome`'s outer node — one in-flow child — and rendered 0.
  readinessCard: { gap: space[2] },
  // #1484 P1-2 — WIDE DESKTOP ONLY, applied to the wrapper that DIRECTLY
  // parents the readiness rows (see the comment at the call site). Because this
  // element is the rows' real flex parent, `checkRowDesktop`'s `flexBasis`
  // resolves against the ROW main axis (a width) and row height stays
  // content-driven.
  readinessGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    columnGap: space[6],
  },
  readinessHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[4],
  },
  cardTitle: { ...type.h1, color: color.text1 },
  readinessCount: {
    ...type.h1,
    color: color.accent,
    fontWeight: "700",
  },
  progressTrack: {
    height: 6,
    borderRadius: radius.full,
    overflow: "hidden",
    backgroundColor: color.fill.inset,
    marginVertical: space[2],
  },
  progressFill: {
    height: "100%",
    borderRadius: radius.full,
    backgroundColor: color.accent,
  },
  checkRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingVertical: space[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
  },
  // #1484 — WIDE DESKTOP ONLY grid cell. The PERCENTAGE basis caps the grid at
  // a MAXIMUM OF 3 COLUMNS at every width (the approved design says "2–3
  // column grid"); the earlier fixed 320px basis let SIX columns pack in at
  // 2560px, which squeezed the labels onto three lines. `minWidth` collapses
  // the grid back to 2 columns as the workspace narrows. See
  // `stayOverviewGridBasis` for the wrap arithmetic.
  checkRowDesktop: {
    flexGrow: 1,
    flexBasis: stayOverviewGridBasis,
    minWidth: stayOverviewRowMinWidth,
  },
  pressed: { opacity: 0.78 },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.fill.inset,
  },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: {
    ...type.body,
    color: color.text1,
    fontWeight: "600",
  },
  rowDetail: { ...type.caption, color: color.text2 },
  optional: { ...type.caption, color: color.text3 },
  blocker: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.warning,
    backgroundColor: color.warningTint,
    padding: space[4],
    gap: space[1],
  },
  blockerTitle: {
    ...type.body,
    color: color.text1,
    fontWeight: "700",
  },
  blockerBody: { ...type.small, color: color.text2 },
  error: { ...type.small, color: color.danger },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space[4],
    padding: space[6],
  },
  stateTitle: { ...type.h1, color: color.text1 },
  formCard: { gap: STAY_SPACING.fieldToFieldStacked },
  // STACK measure (I-AXIS-SCOPED-FLEX): no flex-axis key at all. The
  // `marginTop: space[4]` this used to carry was a WORKAROUND for the dead
  // card gap — with `contentStyle` live, the card owns field-to-field spacing
  // and the field owns only its own internals.
  field: { gap: STAY_SPACING.helperToInput },
  /** label + its helper are ONE unit; 2pt is what makes them read as one. */
  fieldLabelBlock: { gap: STAY_SPACING.labelToHelper },
  /** section title + its caption, same 2pt rule. */
  sectionHead: { gap: STAY_SPACING.sectionTitleToCaption },
  /** The incomplete-checklist marker: an outline ring, no eager glyph. */
  pendingDot: {
    width: 18,
    height: 18,
    borderRadius: radius.full,
    borderWidth: 1.75,
    borderColor: color.text3,
  },
  fieldLabel: {
    ...type.small,
    color: color.text1,
    fontWeight: "600",
  },
  fieldHint: { ...type.caption, color: color.text3 },
  input: {
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    ...type.body,
    color: color.text1,
  },
  inputMultiline: { minHeight: 96, textAlignVertical: "top" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  choiceChip: {
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
  },
  choiceChipActive: {
    backgroundColor: color.accent,
    borderColor: color.accent,
  },
  choiceText: { ...type.small, color: color.text2 },
  choiceTextActive: { color: color.ink, fontWeight: "700" },
  // ROW-ONLY (I-AXIS-SCOPED-FLEX). 16pt is the side-by-side field boundary.
  twoCol: {
    flexDirection: "row",
    alignItems: "flex-start",
    columnGap: STAY_SPACING.fieldToFieldInRow,
    rowGap: STAY_SPACING.fieldToFieldInRow,
    flexWrap: "wrap",
  },
  flexOne: { flex: 1 },
  modeCard: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    padding: space[4],
    gap: space[1],
  },
  modeCardActive: {
    borderColor: color.accent,
    backgroundColor: color.accentTint,
  },
  placeholderCard: {
    minHeight: 220,
    alignItems: "center",
    justifyContent: "center",
    gap: space[4],
  },
  toastWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    paddingTop: space[6],
    paddingHorizontal: space[4],
  },
});

export default StaySuiteShell;
