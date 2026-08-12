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
 * re-caps itself. On wide desktop Overview / Menus / Reservations / Rooms &
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
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { ScrollView } from "../../wrappers/SmartScrollView";
import {
  accent,
  canvas,
  glass,
  radius,
  semantic,
  spacing,
  stayOverviewGridBasis,
  stayOverviewRowMinWidth,
  stayPageMaxWidth,
  suiteFormMaxWidth,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { useBrandDiscoveryCurrency } from "../../hooks/useBrandDiscoveryCurrency";
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
import type { SuiteDesktopModule } from "../suite/SuiteDesktopShell";
import { SuiteDesktopShell } from "../suite/SuiteDesktopShell";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import { VenueMenuModule } from "../venue/VenueMenuModule";
import { StayActionBar } from "./StayActionBar";
import { StayInventoryManager } from "./StayInventoryManager";
import { StayReservationsModule } from "./StayReservationsModule";
import {
  STAY_PAGE_BOTTOM_PAD,
  STAY_SPACING,
} from "./stayLayoutContracts";
import {
  isStaySettingsComplete,
  isStaySettingsFormValid,
} from "./staySettingsReadiness";

export type StayModule =
  | "overview"
  | "rooms_places"
  | "availability_pricing"
  | "reservations"
  | "menu"
  | "settings";

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
 *
 * `Utensils` -> `list` is also a category fix, not just a bundle one: a cutlery
 * glyph on a hotel's Menus tab is the same restaurant-blindness as "Reserve a
 * table" on a Stay. A menu is a list whatever the venue serves.
 */
const MODULES: readonly {
  id: StayModule;
  label: string;
  icon: IconName;
}[] = [
  { id: "overview", label: "Overview", icon: "home" },
  { id: "rooms_places", label: "Rooms & Places", icon: "grid" },
  {
    id: "availability_pricing",
    label: "Availability & pricing",
    icon: "calendar",
  },
  { id: "reservations", label: "Reservations", icon: "notebook" },
  { id: "menu", label: "Menus", icon: "list" },
  { id: "settings", label: "Settings", icon: "settings" },
];

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

function publishErrorCopy(error: Error | null): string | null {
  if (error === null) return null;
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
        <Icon name={icon} size={18} color={textTokens.secondary} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDetail}>{detail}</Text>
      </View>
      {optional ? (
        <Text style={styles.optional}>Optional</Text>
      ) : complete ? (
        <Icon name="check" size={19} color={semantic.success} />
      ) : (
        // The incomplete marker is a plain outline ring. `Icon` has no bare
        // circle and registering a lucide `Circle` for it would put an eager
        // glyph back in `__common` for one decorative dot.
        <View style={styles.pendingDot} accessibilityElementsHidden />
      )}
      <Icon name="chevR" size={18} color={textTokens.tertiary} />
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
        <Icon name={icon} size={18} color={textTokens.secondary} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDetail}>{detail}</Text>
      </View>
      <Icon name="chevR" size={18} color={textTokens.tertiary} />
    </Pressable>
  );
}

interface StayOverviewProps {
  brandId: string;
  venueId: string;
  venueName: string;
  venueApproved: boolean;
  onSelect: (module: StayModule) => void;
}

function StayOverview({
  brandId,
  venueId,
  venueName,
  venueApproved,
  onSelect,
}: StayOverviewProps): React.ReactElement {
  const router = useRouter();
  // #1484 — desktop gate ONLY via the canonical hook (I-DESKTOP-GATE-VIA-HOOK).
  const { isWideDesktop } = useResponsiveLayout();
  const inventory = useStayInventory(venueId);
  const currency = useBrandDiscoveryCurrency(brandId);
  const publish = usePublishStay(venueId);
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

  if (inventory.isLoading || currency.isLoading) {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator color={accent.warm} />
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
        title="Menus"
        detail="Add display menus for dining and guest information"
        complete={false}
        optional
        onPress={() => onSelect("menu")}
        icon="list"
        testID="stay-check-menus"
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
          <Text style={styles.pageTitle}>Stay overview</Text>
          <Text style={styles.helper}>{venueName}</Text>
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

      {isActive ? (
        <GlassCard
          variant="elevated"
          contentStyle={styles.readinessCard}
          testID="stay-live-management"
        >
          <View style={styles.readinessHead}>
            <View style={styles.titleCopy}>
              <Text style={styles.cardTitle}>Manage your live Stay</Text>
              <Text style={styles.helper}>
                Keep availability, reservations and property details up to date.
              </Text>
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
        <Text style={styles.error}>{publishErrorCopy(publish.error)}</Text>
      ) : null}
      {!isActive && isWideDesktop ? (
        <Button
          label="Publish Stay"
          onPress={() => {
            if (settings !== null) {
              publish.mutate({ expectedVersion: settings.version });
            }
          }}
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
        onPress={() => {
          if (settings !== null) {
            publish.mutate({ expectedVersion: settings.version });
          }
        }}
        disabled={publishBlocked}
        loading={publish.isPending}
        fullWidth
        size="lg"
        testID="stay-publish"
      />
    </StayActionBar>
    ) : null}
    </View>
  );
}

interface StaySettingsProps {
  venueId: string;
}

function StaySettings({ venueId }: StaySettingsProps): React.ReactElement {
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
        <ActivityIndicator color={accent.warm} />
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
        placeholderTextColor={textTokens.tertiary}
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
}

export function StaySuiteShell({
  brandId,
  venueId,
  venueName,
  venueApproved,
}: StaySuiteShellProps): React.ReactElement {
  const [activeModule, setActiveModule] = useState<StayModule>("overview");
  // #1484 — desktop gate ONLY via the canonical hook (I-DESKTOP-GATE-VIA-HOOK).
  const { isWideDesktop } = useResponsiveLayout();

  const railModules = useMemo<SuiteDesktopModule[]>(
    () => MODULES.map((module) => ({ key: module.id, label: module.label })),
    [],
  );
  // The shared shell is string-keyed; resolve back through MODULES so an
  // unknown key can never write a bogus module into state (no `as` cast).
  const handleRailSelect = useCallback((key: string): void => {
    const next = MODULES.find((module) => module.id === key);
    if (next !== undefined) setActiveModule(next.id);
  }, []);

  const renderWorkspace = (): React.ReactElement => {
    if (activeModule === "overview") {
      return (
        <StayOverview
          brandId={brandId}
          venueId={venueId}
          venueName={venueName}
          venueApproved={venueApproved}
          onSelect={setActiveModule}
        />
      );
    }
    if (activeModule === "settings") {
      return <StaySettings venueId={venueId} />;
    }
    if (activeModule === "menu") {
      return (
        <ScrollView
          contentContainerStyle={
            isWideDesktop ? styles.pageDesktop : styles.page
          }
          keyboardShouldPersistTaps="handled"
          testID="stay-menu-scroll"
        >
          {/* #1532 §5.6 — the module promised "Guests see your menu on your
              public page" while `PublicVenuePage.tsx:179` hard-codes
              `hasMenu = !isStay`, so for a hotel that promise was simply
              false. Seth's decision is that Stays get a menu of their own
              (#1536); until it exists, the operator gets the truth instead of
              a promise nothing can keep. */}
          <VenueMenuModule
            brandId={brandId}
            venueId={venueId}
            publicVisibility="not_yet"
          />
        </ScrollView>
      );
    }
    if (activeModule === "reservations") {
      return <StayReservationsModule venueId={venueId} />;
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

  // ----- Web desktop (>=1024px): shared two-column rail + workspace. -----
  // Every Stay module OWNS its own ScrollView (Overview, Settings, the Menu
  // wrapper, Reservations, the Inventory manager), so the shell must NOT wrap
  // them in a second same-axis scroll container — `workspaceSelfScrolls` is
  // always true here and `scrollBottomPad` is therefore unused (0).
  if (isWideDesktop) {
    return (
      <View style={styles.root} testID="stay-suite-shell">
        <SuiteDesktopShell
          modules={railModules}
          activeModule={activeModule}
          onSelect={handleRailSelect}
          workspaceSelfScrolls
          scrollBottomPad={0}
          railTestIdPrefix="stay-rail-"
          testID="stay-suite-shell-desktop"
        >
          {renderWorkspace()}
        </SuiteDesktopShell>
      </View>
    );
  }

  // ----- Web-phone + native: single column, WRAPPED pills above the workspace.
  return (
    <View style={styles.root} testID="stay-suite-shell">
      {/*
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

        (2) THE HIDDEN DESTINATIONS. Only 3 of the 6 pills were reachable at
        rest at 440pt, and a horizontal scroller offers no affordance that more
        exists — Menus and Settings were simply undiscoverable. Wrapping shows
        ALL SIX at every width, which was the requirement and is met.

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
      */}
      <View style={styles.moduleNav} testID="stay-modules-band">
        <View style={styles.moduleNavContent}>
          {MODULES.map((module) => {
            const selected = activeModule === module.id;
            return (
              <Pressable
                key={module.id}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={`${module.label} Stay module`}
                onPress={() => setActiveModule(module.id)}
                style={[styles.modulePill, selected && styles.modulePillActive]}
                testID={`stay-module-${module.id}`}
              >
                <Icon
                  name={module.icon}
                  size={16}
                  color={selected ? "#0c0e12" : textTokens.secondary}
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
      <View style={styles.workspace}>{renderWorkspace()}</View>
    </View>
  );
}

/**
 * Geometry shared by every Stay page measure. Kept OUTSIDE `StyleSheet.create`
 * so each measure below can be a COMPLETE object (see the note on `page`).
 */
const PAGE_BASE = {
  padding: spacing.md,
  // #1532 §4 — was `spacing.xxl * 3` (144pt) of dead scroll sized for a bottom
  // nav that `/venue/[venueId]` does not render (it lives OUTSIDE `app/(tabs)/`).
  // Now exactly what the PINNED action bar occupies, plus one gutter.
  paddingBottom: STAY_PAGE_BOTTOM_PAD,
  // #1532 §4 — section -> section is the widest boundary on the page (32),
  // so the six sections read as six things rather than one wall.
  gap: STAY_SPACING.sectionToSection,
  width: "100%",
} as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: canvas.discover },
  workspace: { flex: 1 },
  // #1532 D5 — a module is a scroller PLUS a pinned bar, so it needs a
  // positioning host. `flex: 1` so the scroller still fills the workspace.
  moduleRoot: { flex: 1 },
  moduleNav: {
    // #1532 defect 4 — chrome does not react to the keyboard. `flexShrink: 0`
    // is belt-and-braces (a bare RN View already defaults to it); what actually
    // fixed the collapse is that this band no longer contains a ScrollView at
    // all, so no keyboard spacer can be injected into it.
    flexShrink: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.profileBase,
  },
  // ROW-ONLY (I-AXIS-SCOPED-FLEX): declares its own `flexDirection`, so every
  // other key here is read against that one axis. `alignItems: "flex-start"` is
  // LOAD-BEARING — RN's default `stretch` is what let one tall sibling drag
  // every pill to its height, which is exactly how 36.7pt became 323.7pt.
  moduleNavContent: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    columnGap: spacing.sm,
    rowGap: spacing.sm,
  },
  modulePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  modulePillActive: {
    backgroundColor: accent.warm,
    borderColor: accent.warm,
  },
  moduleLabel: {
    ...typography.bodySm,
    color: textTokens.secondary,
    fontWeight: "600",
  },
  moduleLabelActive: { color: "#0c0e12" },
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
    gap: spacing.md,
  },
  titleCopy: { flex: 1 },
  pageTitle: { ...typography.h2, color: textTokens.primary },
  helper: { ...typography.bodySm, color: textTokens.secondary },
  statePill: {
    borderRadius: radius.full,
    backgroundColor: semantic.warningTint,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  statePillLive: { backgroundColor: semantic.successTint },
  statePillText: {
    ...typography.caption,
    color: textTokens.primary,
    fontWeight: "700",
  },
  statePillTextLive: { color: semantic.success },
  // CONTENT-node measures (#1532 §4). These are passed as `contentStyle`, so
  // they land on the View that actually parents the children. On `style` they
  // reached `GlassChrome`'s outer node — one in-flow child — and rendered 0.
  readinessCard: { gap: spacing.sm },
  // #1484 P1-2 — WIDE DESKTOP ONLY, applied to the wrapper that DIRECTLY
  // parents the readiness rows (see the comment at the call site). Because this
  // element is the rows' real flex parent, `checkRowDesktop`'s `flexBasis`
  // resolves against the ROW main axis (a width) and row height stays
  // content-driven.
  readinessGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    columnGap: spacing.lg,
  },
  readinessHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  cardTitle: { ...typography.h3, color: textTokens.primary },
  readinessCount: {
    ...typography.h3,
    color: accent.warm,
    fontWeight: "700",
  },
  progressTrack: {
    height: 6,
    borderRadius: radius.full,
    overflow: "hidden",
    backgroundColor: glass.tint.profileBase,
    marginVertical: spacing.sm,
  },
  progressFill: {
    height: "100%",
    borderRadius: radius.full,
    backgroundColor: accent.warm,
  },
  checkRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileBase,
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
    backgroundColor: glass.tint.profileBase,
  },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "600",
  },
  rowDetail: { ...typography.caption, color: textTokens.secondary },
  optional: { ...typography.caption, color: textTokens.tertiary },
  blocker: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: semantic.warning,
    backgroundColor: semantic.warningTint,
    padding: spacing.md,
    gap: spacing.xs,
  },
  blockerTitle: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "700",
  },
  blockerBody: { ...typography.bodySm, color: textTokens.secondary },
  error: { ...typography.bodySm, color: semantic.error },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.lg,
  },
  stateTitle: { ...typography.h3, color: textTokens.primary },
  formCard: { gap: STAY_SPACING.fieldToFieldStacked },
  // STACK measure (I-AXIS-SCOPED-FLEX): no flex-axis key at all. The
  // `marginTop: spacing.md` this used to carry was a WORKAROUND for the dead
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
    borderColor: textTokens.tertiary,
  },
  fieldLabel: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "600",
  },
  fieldHint: { ...typography.caption, color: textTokens.tertiary },
  input: {
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    color: textTokens.primary,
  },
  inputMultiline: { minHeight: 96, textAlignVertical: "top" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  choiceChip: {
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  choiceChipActive: {
    backgroundColor: accent.warm,
    borderColor: accent.warm,
  },
  choiceText: { ...typography.bodySm, color: textTokens.secondary },
  choiceTextActive: { color: "#0c0e12", fontWeight: "700" },
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
    borderColor: glass.border.profileBase,
    padding: spacing.md,
    gap: spacing.xs,
  },
  modeCardActive: {
    borderColor: accent.warm,
    backgroundColor: "rgba(235,120,37,0.10)",
  },
  placeholderCard: {
    minHeight: 220,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
});

export default StaySuiteShell;
