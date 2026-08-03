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

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import {
  Accessibility,
  BedDouble,
  CalendarDays,
  Check,
  ChevronRight,
  Circle,
  CreditCard,
  FileCheck2,
  Home,
  Settings,
  Utensils,
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";

import { ScrollView } from "../../wrappers/SmartScrollView";
import {
  accent,
  canvas,
  glass,
  radius,
  semantic,
  spacing,
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
import { VenueMenuModule } from "../venue/VenueMenuModule";
import { StayInventoryManager } from "./StayInventoryManager";
import { StayReservationsModule } from "./StayReservationsModule";
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

const MODULES: readonly {
  id: StayModule;
  label: string;
  icon: LucideIcon;
}[] = [
  { id: "overview", label: "Overview", icon: Home },
  { id: "rooms_places", label: "Rooms & Places", icon: BedDouble },
  {
    id: "availability_pricing",
    label: "Availability & pricing",
    icon: CalendarDays,
  },
  { id: "reservations", label: "Reservations", icon: FileCheck2 },
  { id: "menu", label: "Menus", icon: Utensils },
  { id: "settings", label: "Settings", icon: Settings },
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
  icon: LucideIcon;
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
  icon: RowIcon,
  testID,
  wide = false,
}: ChecklistRowProps): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
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
        <RowIcon size={18} color={textTokens.secondary} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDetail}>{detail}</Text>
      </View>
      {optional ? (
        <Text style={styles.optional}>Optional</Text>
      ) : complete ? (
        <Check size={19} color={semantic.success} />
      ) : (
        <Circle size={18} color={textTokens.tertiary} />
      )}
      <ChevronRight size={18} color={textTokens.tertiary} />
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

  return (
    <ScrollView
      contentContainerStyle={[
        styles.page,
        isWideDesktop ? styles.pageWide : null,
      ]}
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

      {/* #1484 — on wide desktop the readiness card becomes a wrapping row so
          the seven readiness rows reflow into a multi-column grid (the card is
          now as wide as the workspace); the head + progress bar stay full
          width. Phone/native keep the single stacked column exactly as-is. */}
      <GlassCard
        variant="elevated"
        style={[
          styles.readinessCard,
          isWideDesktop ? styles.readinessCardDesktop : null,
        ]}
      >
        <View
          style={[
            styles.readinessHead,
            isWideDesktop ? styles.gridFullRow : null,
          ]}
        >
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
        <View
          style={[
            styles.progressTrack,
            isWideDesktop ? styles.gridFullRow : null,
          ]}
        >
          <View
            style={[
              styles.progressFill,
              { width: `${(completeCount / mandatoryChecks.length) * 100}%` },
            ]}
          />
        </View>

        <ChecklistRow
          title="Stay basics"
          detail={
            basicsReady
              ? "Summary, local time and arrival times saved"
              : "Add a summary, timezone and arrival times"
          }
          complete={basicsReady}
          onPress={() => onSelect("settings")}
          icon={Home}
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
          icon={Accessibility}
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
          icon={BedDouble}
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
          icon={CalendarDays}
          testID="stay-check-availability"
          wide={isWideDesktop}
        />
        <ChecklistRow
          title="Menus"
          detail="Add display menus for dining and guest information"
          complete={false}
          optional
          onPress={() => onSelect("menu")}
          icon={Utensils}
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
          icon={CreditCard}
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
          icon={FileCheck2}
          testID="stay-check-review"
          wide={isWideDesktop}
        />
      </GlassCard>

      <Button
        label={isActive ? "Stay is live" : "Publish Stay"}
        onPress={() => {
          if (settings !== null) {
            publish.mutate({ expectedVersion: settings.version });
          }
        }}
        disabled={isActive || publishBlocked}
        loading={publish.isPending}
        fullWidth
        size="lg"
        testID="stay-publish"
      />
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
    </ScrollView>
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
    // #1484 — Settings is an EDITABLE FORM, so on wide desktop it keeps a
    // readable-measure cap (`suiteFormMaxWidth`) instead of stretching to the
    // full workspace width — but LEFT-anchored, flush with the rail seam.
    <ScrollView
      contentContainerStyle={[
        styles.page,
        isWideDesktop ? styles.pageForm : null,
      ]}
    >
      <Text style={styles.pageTitle}>Stay settings</Text>
      <Text style={styles.helper}>
        These are property-level details. Each Room and Place keeps its own
        description, photos, amenities, price, fees and policy.
      </Text>

      <GlassCard variant="base" style={styles.formCard}>
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

        <Field
          label="Stay summary"
          value={summary}
          onChangeText={setSummary}
          placeholder="What makes this property worth staying at?"
          multiline
          testID="stay-settings-summary"
        />
        <Text style={styles.fieldHint}>Minimum 20 characters.</Text>
        <Field
          label="IANA timezone"
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
              style={[styles.modeCard, mode === value && styles.modeCardActive]}
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

        <Field
          label="Property amenities"
          value={amenities}
          onChangeText={setAmenities}
          placeholder="Pool, Wi-Fi, breakfast, gym"
          testID="stay-settings-amenities"
        />
        <Text style={styles.fieldHint}>Separate items with commas.</Text>
        <Field
          label="Accessibility"
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

      <Button
        label={saved ? "Saved" : "Save Stay settings"}
        onPress={submit}
        disabled={!valid}
        loading={save.isPending}
        fullWidth
        size="lg"
        testID="stay-settings-save"
      />
      {save.isError ? (
        <Text style={styles.error}>
          We couldn’t save these settings. Reload and try again.
        </Text>
      ) : null}
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  testID: string;
}): React.ReactElement {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={textTokens.tertiary}
        multiline={multiline}
        accessibilityLabel={label}
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
          contentContainerStyle={[
            styles.page,
            isWideDesktop ? styles.pageWide : null,
          ]}
        >
          <VenueMenuModule brandId={brandId} venueId={venueId} />
        </ScrollView>
      );
    }
    if (activeModule === "reservations") {
      return <StayReservationsModule venueId={venueId} />;
    }
    return (
      <StayInventoryManager
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

  // ----- Web-phone + native: UNCHANGED single column (pills above workspace).
  return (
    <View style={styles.root} testID="stay-suite-shell">
      <View style={styles.moduleNav}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.moduleNavContent}
        >
          {MODULES.map((module) => {
            const selected = activeModule === module.id;
            const ModuleIcon = module.icon;
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
                <ModuleIcon
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
        </ScrollView>
      </View>
      <View style={styles.workspace}>{renderWorkspace()}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: canvas.discover },
  workspace: { flex: 1 },
  moduleNav: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.profileBase,
  },
  moduleNavContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
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
  page: {
    padding: spacing.md,
    paddingBottom: spacing.xxl * 3,
    gap: spacing.md,
    // Phone / web-phone readable measure (unchanged; now tokenised).
    maxWidth: stayPageMaxWidth,
    width: "100%",
    alignSelf: "center",
  },
  // #1484 — WIDE DESKTOP ONLY. Applied AFTER `page` in a style array. The
  // shared SuiteDesktopShell workspace already supplies the gutters and the
  // left anchor, so the phone readable-measure cap is RELEASED and the content
  // fills the workspace, flush with the rail seam. Re-introducing a numeric cap
  // here would restore the dead right-side canvas ORCH-1184 removed.
  pageWide: {
    maxWidth: undefined,
    alignSelf: "flex-start",
  },
  // #1484 — WIDE DESKTOP ONLY, for the Settings EDITABLE FORM. Uncapped form
  // fields on a wide monitor stretch to an unreadable line length, so the form
  // column keeps a readable measure — left-anchored, not centred.
  pageForm: {
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
  readinessCard: { gap: spacing.sm },
  // #1484 — WIDE DESKTOP ONLY. The readiness card is now as wide as the
  // workspace, so its rows reflow into a multi-column grid (`flexWrap`) instead
  // of one very wide, very tall single column. This reuses the EXISTING
  // `checkRow` card-row pattern — no new grid system.
  readinessCardDesktop: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    columnGap: spacing.lg,
  },
  // Children that must still span the whole card inside that wrapping row.
  gridFullRow: { width: "100%" },
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
  // #1484 — WIDE DESKTOP ONLY grid cell: two-up at typical laptop widths, more
  // columns on very wide monitors, collapsing back to one column below
  // `stayOverviewRowMinWidth`.
  checkRowDesktop: {
    flexGrow: 1,
    flexBasis: stayOverviewRowMinWidth,
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
  formCard: { gap: spacing.md },
  field: { gap: spacing.xs, marginTop: spacing.md },
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
  twoCol: { flexDirection: "row", gap: spacing.sm },
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
