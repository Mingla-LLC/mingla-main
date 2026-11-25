/**
 * META-ORCH-1148 sub-ORCH 2.0 — Settings module.
 *
 * The canonical home of the Reservations toggle + the optional reservation-fee
 * config + cancel/no-show policy + a read-mostly venue-profile summary + an
 * hours summary + a DISPLAY-ONLY team-roles scaffold. All sections write through
 * `useVenueReservationSettings`. Manager-plus rank gates the mutation controls
 * in the UI (RLS enforces server-side).
 *
 * Hard guards honored here:
 *  - NO buyer billing-address field, NO "Calculate tax" control (extends
 *    orch-1130-no-buyer-tax-form / I-PROPOSED-1148-NO-BUYER-TAX-FORM).
 *  - Paid-fee fail-close (ORCH-1073/1075): enabling a PAID fee is blocked unless
 *    the brand's payout rail is ready; the SAME "finish payout setup" copy +
 *    route as the checkout `stripe_account_not_ready` 409 is shown
 *    (I-PROPOSED-1148-PAID-FEE-REQUIRES-CHARGES-ENABLED).
 *  - Tax stays venue-sourced server-side; the fee preview is display-only (NO
 *    charge in 2.0).
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { loadVenueHostScreens } from "./host/venueHostOwner";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ScrollView } from "../../wrappers/SmartScrollView";

import {
  radius,
  color,
  space,
  materials,
  type,
} from "../../constants/designSystem";
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
import { useVenueListing } from "../../hooks/useVenueListings";
import { useTillReleased } from "../../hooks/useTillReleased";
import { useVenueFeatures } from "../../hooks/useVenueFeatures";
import { tillSettingsHref } from "./close/closeRoute";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import { useBrandHours, useUpsertBrandHours } from "../../hooks/useBrandHours";
import { useBrandPlaceAuthoringContext } from "../../hooks/useBrandPlacePipelineState";
import {
  useUpdateReservationFee,
  useVenueReservationSettings,
} from "../../hooks/useVenueReservationSettings";
import type { BrandHourEntry } from "../../types/brand";
import { BRAND_ROLE_RANK } from "../../utils/brandRole";
import { hoursWeekIssue, sameHoursWeek } from "../../utils/venueBrandHours";
import {
  formatCurrency,
  majorFromMinor,
  minorFromMajor,
  normalizeCurrency,
  currencyCodeOrNull,
} from "../../utils/currency";
import { LazyPayoutCountryInlinePrompt } from "../brand/LazyPayoutCountryInlinePrompt";
import {
  brandStripeOnboardingRoute,
  paidPublishGuardCopy,
} from "../../utils/paidPublishGuards";
import { useVenueSuiteStore } from "../../store/venueSuiteStore";
// #4518 — host-only, so loaded on intent (when the hours step / card shows),
// not in the shared boot payload every buyer page downloads.
const BrandHoursEditor = React.lazy(() =>
  import("./BrandHoursEditor").then((module) => ({ default: module.BrandHoursEditor })),
);
import { BrandSwitch } from "../ui/BrandSwitch";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Input } from "../ui/Input";
import { Tabs } from "../ui/Tabs";
import { SaveCommitBar } from "./SaveCommitBar";
import {
  brandPayoutReadiness,
  canEnablePaidReservationFee,
  paidFeeIsActive,
} from "./venueFeeGate";
import type { VenueModuleLeaveHandle } from "./venueLeaveContract";
import { venueScrollBottomPad } from "./venueShellScroll";
import { VenueDetailsEditor } from "./VenueDetailsEditor";

/**
 * #4490 — Settings › Venue type and features loads on demand (switches,
 * dependency confirms, the type picker): Settings itself is eager in the shell.
 */
const LazyVenueTypeAndFeaturesPanel = React.lazy(async () => {
  return { default: (await loadVenueHostScreens()).VenueTypeAndFeaturesPanel };
});
const LazyBookingTermsSection = React.lazy(async () => {
  return { default: (await loadVenueHostScreens()).BookingTermsSection };
});

/** #4490 — Settings tabs (spec 02 §3 `set`). */
type SettingsTab = "type" | "terms" | "details" | "team";
const SETTINGS_TABS: ReadonlyArray<{ key: SettingsTab; label: string }> = [
  { key: "type", label: "Venue type and features" },
  { key: "terms", label: "Terms and tax" },
  { key: "details", label: "Details and photos" },
  { key: "team", label: "Team" },
];

const ItemDiscountControls = React.lazy(() =>
  import("../discounts/ItemDiscountControls").then((module) => ({
    default: module.ItemDiscountControls,
  })),
);

export type VenueSettingsLeaveHandle = VenueModuleLeaveHandle;

const MANAGER_PLUS_RANK = BRAND_ROLE_RANK.event_manager; // 40

/** VISION §11 role legend (display-only scaffold; mutation deferred). */
const ROLE_LEGEND: readonly { label: string; perms: string }[] = [
  { label: "Owner", perms: "Full control" },
  { label: "Manager", perms: "Tables, hours, reservations, settings" },
  { label: "Host", perms: "Seat guests, run the waitlist" },
  { label: "Server", perms: "View today's bookings" },
  { label: "Marketing", perms: "Campaigns & guest outreach" },
  { label: "Finance", perms: "Payouts & reports" },
  { label: "Scanner", perms: "Check guests in" },
];

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps): React.ReactElement {
  return (
    <GlassCard variant="base" style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </GlassCard>
  );
}

export interface VenueSettingsModuleProps {
  brandId: string | null;
  /** META-ORCH-1255 — the venue this Settings module manages. */
  venueId?: string | null;
  /** Route the operator to payout onboarding when the paid-fee gate blocks. */
  testID?: string;
  /**
   * #4490 — the venue uses the feature layout, where opening hours are edited
   * in Availability & pricing; Settings then links there instead of holding a
   * second editor.
   */
  hoursLiveInAvailability?: boolean;
}

export const VenueSettingsModule = forwardRef<
  VenueSettingsLeaveHandle,
  VenueSettingsModuleProps
>(function VenueSettingsModule(
  { brandId, venueId = null, testID, hoursLiveInAvailability = false },
  forwardedRef,
): React.ReactElement {
  const router = useRouter();
  const [tab, setTab] = useState<SettingsTab>("type");
  const selectModule = useVenueSuiteStore((s) => s.selectModule);
  const brand = useCurrentBrand();
  const { rank } = useCurrentBrandRole(brandId);
  const canMutate = rank >= MANAGER_PLUS_RANK;
  // #4490 spec 08 O5 part B — Settings › Selling in person (brand admins and
  // above, with the Till released and Sell in person on at this venue).
  const tillReleased = useTillReleased();
  const venueFeatures = useVenueFeatures(brandId, venueId);
  const sellingInPerson = tillReleased && venueId !== null && rank >= BRAND_ROLE_RANK.brand_admin
    && venueFeatures.data?.features.till.enabled === true;
  const setDirtyModule = useVenueSuiteStore((s) => s.setDirtyModule);
  // META-ORCH-1255 — the place pointer lives on the VENUE row (one owner per
  // truth); brands.place_pool_id is legacy-inert.
  const venueQuery = useVenueListing(venueId);
  const placePoolId = venueQuery.data?.placePoolId ?? null;

  const settingsQuery = useVenueReservationSettings(brandId, venueId);
  const settings = settingsQuery.data ?? null;
  const reservationsEnabled = settings?.reservationsEnabled ?? false;

  const updateFee = useUpdateReservationFee(brandId, venueId);

  const currency = normalizeCurrency(brand?.defaultCurrency);
  // #3645 — `currency` above is a crash-guard value (pounds) when the brand has
  // none. A brand with no currency is never SHOWN pounds: the amount field is
  // replaced by the payout-country prompt and no amount is previewed.
  const brandHasCurrency = currencyCodeOrNull(brand?.defaultCurrency) !== null;
  const readiness = brandPayoutReadiness({
    stripeStatus: brand?.stripeStatus,
    paystackSubaccountCode: brand?.paystackSubaccountCode ?? null,
  });
  const payoutReady = canEnablePaidReservationFee(readiness);

  // Local block message when the paid-fee gate trips (ORCH-1073/1075 copy).
  const [feeBlocked, setFeeBlocked] = useState<boolean>(false);
  const guardCopy = paidPublishGuardCopy("stripe_charges_disabled");

  const feeEnabled = settings?.feeEnabled ?? false;
  const feeAmountCents = settings?.feeAmountCents ?? 0;

  // Draft amount in MAJOR units (what the operator types). Hydrated from the
  // persisted cents while clean; dirty drafts are not overwritten by refetch.
  const [amountDraft, setAmountDraft] = useState<string>("");
  const [feeDraftBaselineCents, setFeeDraftBaselineCents] = useState<
    number | null
  >(null);

  // Parse the draft → integer cents (currency-aware; zero-decimal safe). A blank
  // / non-numeric / non-positive draft → 0 (= "no amount set").
  const draftCents = useMemo<number>(() => {
    const major = Number.parseFloat(amountDraft.replace(/,/g, ""));
    if (!Number.isFinite(major) || major <= 0) return 0;
    return minorFromMajor(major, currency);
  }, [amountDraft, currency]);

  const feeAmountDirty = useMemo(() => {
    if (!feeEnabled) return false;
    const serverCents = feeAmountCents > 0 ? feeAmountCents : 0;
    return draftCents !== serverCents;
  }, [draftCents, feeAmountCents, feeEnabled]);

  useEffect(() => {
    const serverCents = feeAmountCents > 0 ? feeAmountCents : 0;
    if (feeDraftBaselineCents !== null && feeAmountDirty) return;
    if (feeAmountCents > 0) {
      setAmountDraft(String(majorFromMinor(feeAmountCents, currency)));
    } else {
      setAmountDraft("");
    }
    setFeeDraftBaselineCents(serverCents);
  }, [
    currency,
    feeAmountCents,
    feeAmountDirty,
    feeDraftBaselineCents,
  ]);

  // The fee is a broken "paid but charges nothing" config while ON with no
  // positive amount — surface it and DO NOT treat the fee as active.
  const feeNeedsAmount = feeEnabled && draftCents <= 0;
  const feeActive = paidFeeIsActive(feeEnabled, draftCents);

  const [switchStatus, setSwitchStatus] = useState<
    "idle" | "saving" | "saved" | "failed"
  >("idle");
  const [switchError, setSwitchError] = useState<string | null>(null);

  const handleToggleFee = useCallback(
    (next: boolean): void => {
      if (!canMutate) return;
      // Paid-fee fail-close: cannot turn a paid fee ON without a ready payout rail.
      if (next && !payoutReady) {
        setFeeBlocked(true);
        return;
      }
      setFeeBlocked(false);
      // Turning the fee ON does NOT set an amount — the operator must enter one
      // (feeNeedsAmount surfaces until they do). Turning it OFF clears the amount
      // so it can never settle as a stale paid fee.
      updateFee.mutate({
        feeEnabled: next,
        feeCurrency: next ? currency : null,
        feeAmountCents: next ? undefined : null,
      });
    },
    [canMutate, payoutReady, updateFee, currency],
  );

  const handleNoShowPolicy = useCallback(
    (policy: "forfeit" | "none"): void => {
      if (!canMutate) return;
      setSwitchStatus("saving");
      setSwitchError(null);
      updateFee.mutate(
        { noShowFeePolicy: policy },
        {
          onSuccess: () => {
            setSwitchStatus("saved");
            setTimeout(() => setSwitchStatus("idle"), 1500);
          },
          onError: () => {
            setSwitchStatus("failed");
            setSwitchError("Couldn't save that policy. Try again.");
          },
        },
      );
    },
    [canMutate, updateFee],
  );

  const goToPayoutOnboarding = useCallback((): void => {
    if (brandId === null) return;
    router.push(brandStripeOnboardingRoute(brandId) as never);
  }, [brandId, router]);

  const goToTeam = useCallback((): void => {
    if (brandId === null) return;
    const venueQuery = venueId ? `?venueId=${encodeURIComponent(venueId)}` : "";
    router.push(`/brand/${brandId}/team${venueQuery}` as never);
  }, [brandId, router, venueId]);

  const feePreview = useMemo(() => {
    if (!feeActive) return null;
    return formatCurrency(draftCents, currency, true);
  }, [feeActive, draftCents, currency]);

  // ----- ORCH-1186-A: Opening hours editor (single owner = brand_hours) -------
  const hoursQuery = useBrandHours(brandId, venueId);
  const upsertHours = useUpsertBrandHours(brandId, venueId);
  const [hoursDraft, setHoursDraft] = useState<BrandHourEntry[] | null>(null);
  const [hoursSaved, setHoursSaved] = useState<boolean>(false);
  const [hoursError, setHoursError] = useState<boolean>(false);

  // Hydrate the local draft from server data; re-sync when server data changes
  // (and the user has no in-flight edits).
  const serverHours = hoursQuery.data ?? null;
  // #4490 click-test E1 — the draft follows every server read until the host
  // edits here. Before, it copied the FIRST read only: hours saved elsewhere
  // (Availability & pricing, from its leave dialog) landed after Settings had
  // mounted on the stale cache, and Settings then showed "1 unsaved change ·
  // Opening hours" for hours that were already saved.
  const hoursEditedRef = useRef(false);
  useEffect(() => {
    if (serverHours === null) return;
    if (hoursDraft === null || (!hoursEditedRef.current && !sameHoursWeek(hoursDraft, serverHours))) {
      setHoursDraft(serverHours);
    }
  }, [serverHours, hoursDraft]);

  const hoursDirty = useMemo<boolean>(() => {
    // In the feature layout hours are edited in Availability & pricing only.
    if (hoursLiveInAvailability) return false;
    if (hoursDraft === null || serverHours === null) return false;
    return !sameHoursWeek(hoursDraft, serverHours);
  }, [hoursDraft, hoursLiveInAvailability, serverHours]);

  const hoursInvalid = useMemo<boolean>(() => {
    if (hoursDraft === null) return false;
    for (const h of hoursDraft) {
      if (h.isClosed) continue;
      const o = h.openTime ?? "";
      const c = h.closeTime ?? "";
      if (o.length === 0 || c.length === 0) return true;
      // ORCH-1263 D-D (I-PROPOSED-1263-OVERNIGHT-HOURS-VALID): close < open is
      // a VALID overnight span (22:00→02:00) — only equality is invalid, so a
      // claimed late-night venue can SAVE its real hours post-approve.
      if (o === c) return true;
    }
    // #4490 — extra windows must be complete and must not overlap.
    return hoursWeekIssue(hoursDraft) !== null;
  }, [hoursDraft]);

  const handleHoursChange = useCallback((next: BrandHourEntry[]): void => {
    hoursEditedRef.current = true;
    setHoursDraft(next);
    setHoursSaved(false);
    setHoursError(false);
  }, []);

  const settingsChangedLabels = useMemo((): string[] => {
    const labels: string[] = [];
    if (hoursDirty) labels.push("Opening hours");
    if (feeAmountDirty) labels.push("Fee");
    return labels;
  }, [feeAmountDirty, hoursDirty]);

  const settingsDirty = settingsChangedLabels.length > 0;
  const settingsValid = !hoursInvalid && !(feeEnabled && feeNeedsAmount);

  const [settingsSaveFailed, setSettingsSaveFailed] = useState(false);

  const handleSaveSettings = useCallback((): Promise<void> => {
    if (!canMutate || !settingsDirty || !settingsValid) {
      return Promise.reject(new Error("invalid"));
    }
    setHoursError(false);
    setSettingsSaveFailed(false);
    const tasks: Promise<void>[] = [];
    if (hoursDirty && hoursDraft !== null) {
      tasks.push(
        new Promise((resolve, reject) => {
          upsertHours.mutate(hoursDraft, {
            onSuccess: () => {
              hoursEditedRef.current = false;
              setHoursDraft(null);
              resolve();
            },
            onError: () => {
              setHoursError(true);
              reject(new Error("hours"));
            },
          });
        }),
      );
    }
    if (feeAmountDirty && feeEnabled) {
      tasks.push(
        new Promise((resolve, reject) => {
          updateFee.mutate(
            {
              feeAmountCents: draftCents > 0 ? draftCents : null,
              feeCurrency: currency,
            },
            {
              onSuccess: () => {
                setFeeDraftBaselineCents(draftCents > 0 ? draftCents : 0);
                resolve();
              },
              onError: () => reject(new Error("fee")),
            },
          );
        }),
      );
    }
    return Promise.all(tasks)
      .then(() => {
        setHoursSaved(true);
        setSettingsSaveFailed(false);
      })
      .catch((error: unknown) => {
        setSettingsSaveFailed(true);
        setHoursSaved(false);
        throw error;
      });
  }, [
    canMutate,
    currency,
    draftCents,
    feeAmountDirty,
    feeEnabled,
    hoursDirty,
    hoursDraft,
    settingsDirty,
    settingsValid,
    updateFee,
    upsertHours,
  ]);

  useEffect(() => {
    setDirtyModule("settings", settingsDirty);
    return (): void => setDirtyModule("settings", false);
  }, [setDirtyModule, settingsDirty]);

  useImperativeHandle(
    forwardedRef,
    (): VenueSettingsLeaveHandle => ({
      isDirty: () => settingsDirty,
      changedLabels: () => settingsChangedLabels,
      isValid: () => settingsValid,
      save: handleSaveSettings,
      discard: () => {
        hoursEditedRef.current = false;
        setHoursDraft(serverHours);
        setHoursError(false);
        if (feeAmountCents > 0) {
          setAmountDraft(String(majorFromMinor(feeAmountCents, currency)));
        } else {
          setAmountDraft("");
        }
      },
    }),
    [
      currency,
      feeAmountCents,
      handleSaveSettings,
      serverHours,
      settingsChangedLabels,
      settingsDirty,
      settingsValid,
    ],
  );

  // Auto-dismiss the success line.
  useEffect(() => {
    if (!hoursSaved) return;
    const t = setTimeout(() => setHoursSaved(false), 2500);
    return () => clearTimeout(t);
  }, [hoursSaved]);

  // ----- ORCH-1186-A: AI / photos / vibes read-only readout + entry point -----
  const authoringCtx = useBrandPlaceAuthoringContext(
    brandId,
    placePoolId,
    venueId,
  );
  const galleryCount = authoringCtx.data?.gallery_urls?.length ?? 0;
  const scoreRows = useMemo(() => {
    const scores = authoringCtx.data?.ai_signal_scores ?? null;
    if (scores === null) return [];
    return Object.entries(scores)
      .filter(([, v]) => v.inappropriate_for !== true)
      .map(([id, v]) => ({ id, score: v.score_0_to_100 }))
      .sort((a, b) => b.score - a.score);
  }, [authoringCtx.data]);
  // ORCH-1304 — the client edit-cap readout is retired (the DB column stays,
  // dead-but-harmless). No edit-cap copy or disabled tie here.

  const goToDeckReadiness = useCallback((): void => {
    if (brandId === null || placePoolId === null || venueId === null) return;
    router.push(
      // #3385 — `from=venue` so Save returns here instead of leaving the venue.
      `/venue/deck-readiness?brand_id=${brandId}&place_pool_id=${placePoolId}&venue_id=${venueId}&focus=review&fix=review_pipeline&from=venue` as never,
    );
  }, [brandId, placePoolId, venueId, router]);

  const insets = useSafeAreaInsets();

  // ORCH-1190 #1 — full-width parity. The Settings module previously capped its
  // content column at `venueSettingsMaxWidth` on wide desktop, so it did NOT fill
  // the workspace like Overview/Tables/Reservations/Waitlist/Menu (all of which
  // render edge-to-edge in the ORCH-1184 full-width workspace). Drop the cap so
  // every venue-suite module shares the SAME full-width container. The readable
  // line measure is preserved by the cards' own content widths + the inner
  // controls, not a hard column cap.
  // #3655 — own the ScrollView so the Save bar stays sticky outside scroll content.
  return (
    <View style={styles.shell} testID={testID ?? "venue-settings-module"}>
      <ScrollView
        contentContainerStyle={[
          styles.host,
          { paddingBottom: venueScrollBottomPad(insets.bottom) + 96 },
        ]}
        showsVerticalScrollIndicator={false}
        testID="venue-settings-scroll"
      >
      {/* #4490 — Settings tabs. The old "Take table reservations" switch is
          now the Table reservations feature (Venue type and features). */}
      <Tabs
        items={SETTINGS_TABS}
        value={tab}
        onChange={setTab}
        testID="venue-settings-tabs"
      />

      {tab === "type" ? (
        <React.Suspense fallback={<ActivityIndicator color={color.accent} />}>
          <LazyVenueTypeAndFeaturesPanel brandId={brandId} venueId={venueId} />
        </React.Suspense>
      ) : null}
      {tab === "type" && sellingInPerson && venueId !== null ? (
        <Section title="Selling in person">
          <Text style={styles.rowSub}>
            Tips, paper for printing, station screens and target times, auto-lock and the receipt footer for the Till.
          </Text>
          <Button
            label="Open Selling in person"
            onPress={() => router.push(tillSettingsHref(venueId) as never)}
            variant="secondary"
            size="sm"
            style={styles.inlineBtn}
            testID="venue-settings-selling-in-person"
          />
        </Section>
      ) : null}

      {/* #4490 P2-4 — venue-level terms every offer uses (VAT, hold, horizon, pause). */}
      {tab === "terms" ? (
        <React.Suspense fallback={null}>
          <LazyBookingTermsSection brandId={brandId} venueId={venueId} canEdit={canMutate} />
        </React.Suspense>
      ) : null}

      {tab === "terms" && !reservationsEnabled ? (
        <Section title="Table reservations">
          <Text style={styles.rowSub}>
            Fees and cancellation terms for table bookings show here when Table
            reservations is on.
          </Text>
          <Button
            label="Go to Venue type and features"
            onPress={() => setTab("type")}
            variant="secondary"
            size="sm"
            style={styles.inlineBtn}
            testID="venue-settings-terms-go-features"
          />
        </Section>
      ) : null}

      {tab === "terms" && reservationsEnabled ? (
        <Text style={styles.bandCaption}>TABLE RESERVATIONS</Text>
      ) : null}

      {tab === "terms" && reservationsEnabled ? (
        <>
          {/* 2 — Reservation fee (optional; free default). NO billing/tax form. */}
          <Section title="Reservation fee">
            <View style={styles.rowBetween}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>Charge a reservation fee</Text>
                <Text style={styles.rowSub}>
                  Optional. Most venues keep this free. Tax and fees are handled
                  automatically — guests see one all-in price.
                </Text>
              </View>
              <BrandSwitch
                value={feeEnabled}
                onValueChange={handleToggleFee}
                disabled={!canMutate || updateFee.isPending}
                accessibilityLabel="Reservation fee toggle"
                testID="venue-settings-fee-toggle"
              />
            </View>

            {feeBlocked ? (
              <View
                style={styles.blockCard}
                testID="venue-settings-fee-payout-block"
              >
                <Text style={styles.blockTitle}>{guardCopy.title}</Text>
                <Text style={styles.blockBody}>{guardCopy.body}</Text>
                <Button
                  label={guardCopy.actionLabel}
                  onPress={goToPayoutOnboarding}
                  variant="primary"
                  size="md"
                  fullWidth
                  testID="venue-settings-fee-payout-cta"
                />
              </View>
            ) : null}

            {feeEnabled && !feeBlocked && !brandHasCurrency ? (
              <LazyPayoutCountryInlinePrompt
                brand={brand}
                priced
                reason="A reservation fee needs a currency. Pick the country your bank account is in and we'll use its currency for this brand."
                testID="venue-settings-fee-payout-country"
              />
            ) : null}

            {feeEnabled && !feeBlocked && brandHasCurrency ? (
              <View style={styles.amountBlock}>
                <Text style={styles.fieldLabel}>
                  Fee amount ({normalizeCurrency(currency)})
                </Text>
                <Input
                  value={amountDraft}
                  onChangeText={setAmountDraft}
                  variant="number"
                  placeholder="0.00"
                  disabled={!canMutate}
                  accessibilityLabel="Reservation fee amount"
                  testID="venue-settings-fee-amount"
                />
                {feeNeedsAmount ? (
                  <Text
                    style={styles.amountWarn}
                    accessibilityLabel="Set a fee amount above zero to charge guests"
                    testID="venue-settings-fee-needs-amount"
                  >
                    Set an amount above 0 to charge guests. Until you do, this
                    fee stays free.
                  </Text>
                ) : null}
              </View>
            ) : null}

            {feeActive && feePreview !== null && brandHasCurrency ? (
              <Text
                style={styles.feePreview}
                testID="venue-settings-fee-preview"
              >
                Guests pay {feePreview} all-in at booking.
              </Text>
            ) : null}

            {feeEnabled &&
            draftCents > 0 &&
            brandHasCurrency &&
            brandId !== null &&
            venueId !== null &&
            rank >= BRAND_ROLE_RANK.finance_manager ? (
              <React.Suspense fallback={null}>
                <View style={styles.discountControls}>
                  <ItemDiscountControls
                    brandId={brandId}
                    itemId={venueId}
                    itemKind="venue_deposit"
                    listingKind="reservation_deposit"
                    itemLabel="Reservation deposit"
                    currency={currency}
                    listUnitCents={draftCents}
                    allowLabel="Allow discounts on deposits"
                    saleLabel="Deposit sale price"
                    testID="venue-deposit-discount-controls"
                  />
                </View>
              </React.Suspense>
            ) : null}
          </Section>

          {/* 6 — Cancellation / no-show policy (single source = settings row). */}
          <Section title="Cancellation & no-show">
            <Text style={styles.rowSub}>
              Cancellation cutoff: {settings?.cancelCutoffHours ?? 24} hours
              before the reservation.
            </Text>
            <View style={styles.segment}>
              {(["forfeit", "none"] as const).map((policy) => {
                const active =
                  (settings?.noShowFeePolicy ?? "forfeit") === policy;
                return (
                  <Pressable
                    key={policy}
                    onPress={() => handleNoShowPolicy(policy)}
                    disabled={!canMutate}
                    accessibilityRole="button"
                    accessibilityLabel={
                      policy === "forfeit"
                        ? "Forfeit fee on no-show"
                        : "No penalty on no-show"
                    }
                    accessibilityState={{ selected: active }}
                    style={[
                      styles.segmentItem,
                      active ? styles.segmentItemActive : null,
                    ]}
                    testID={`venue-settings-noshow-${policy}`}
                  >
                    <Text
                      style={[
                        styles.segmentLabel,
                        active ? styles.segmentLabelActive : null,
                      ]}
                    >
                      {policy === "forfeit"
                        ? "Forfeit fee on no-show"
                        : "No penalty"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Section>
        </>
      ) : null}

      {/* ── Band 2 — VENUE PROFILE (the editable home, ORCH-1186-A). ───────── */}
      {tab === "details" ? (
      <>

      {/* 4 — Opening hours (real editor; brand_hours is the single owner). */}
      <Section title="Opening hours">
        <Text style={styles.rowSub}>
          These are the hours guests see — and the baseline for reservation
          slots.
        </Text>
        {hoursLiveInAvailability ? (
          <Button
            label="Edit in Availability & pricing"
            onPress={() => selectModule?.("availability")}
            variant="secondary"
            size="sm"
            style={styles.inlineBtn}
            testID="venue-settings-hours-in-availability"
          />
        ) : hoursQuery.isError ? (
          <Text style={styles.hoursError} testID="venue-settings-hours-error">
            Couldn&apos;t load your hours. Pull to refresh and try again.
          </Text>
        ) : hoursDraft === null ? (
          <View style={styles.hoursLoading}>
            <ActivityIndicator color={color.accent} />
          </View>
        ) : (
          <View
            style={
              !canMutate || upsertHours.isPending ? styles.editorLocked : null
            }
            pointerEvents={
              !canMutate || upsertHours.isPending ? "none" : "auto"
            }
          >
            <React.Suspense fallback={null}>
              <BrandHoursEditor
                hours={hoursDraft}
                onChange={handleHoursChange}
                showErrors={hoursDirty}
                disabled={!canMutate || upsertHours.isPending}
                allowWindows
              />
            </React.Suspense>
          </View>
        )}
        {hoursError ? (
          <Text
            style={styles.hoursError}
            testID="venue-settings-hours-save-error"
          >
            Couldn&apos;t save hours. Tap Save settings to try again.
          </Text>
        ) : null}
      </Section>

      {/* 5 — Venue details. #3386: a real editor. Contact is saved directly;
          name, address and category are saved directly while the venue is in
          review and sent to Mingla once it is live. "Request a change" (the
          #3404 email) remains only where nothing else fits. */}
      <Section title="Venue details">
        {/* ORCH-1186-A T9c: the details stay reachable from Settings under the
            same testID; it now holds the editor, never a brand-page button. */}
        <View testID="venue-settings-edit-details">
          <VenueDetailsEditor
            brandId={brandId}
            venueId={venueId}
            canMutate={canMutate}
            brandCountryCode={brand?.countryCode ?? null}
          />
        </View>
        <Text style={styles.rowSub} testID="venue-settings-details-self-serve">
          You can change opening hours above, and photos, cover, website and
          price in Edit photos &amp; details.
        </Text>
      </Section>

      {/* 6 — Photos & vibes & AI (read-only readout + working entry point). */}
      {placePoolId !== null ? (
        <Section title="Photos & vibes & AI">
          <Text style={styles.rowSub}>
            {galleryCount} photo{galleryCount === 1 ? "" : "s"} on your listing.
          </Text>
          {scoreRows.length > 0 ? (
            <Text style={styles.rowSub}>
              How you match Mingla moments — {scoreRows.length} signal
              {scoreRows.length === 1 ? "" : "s"} scored.
            </Text>
          ) : (
            <Text style={styles.rowSub}>
              Your pitch and match scores are written when Mingla approves your
              venue.
            </Text>
          )}
          {/* ORCH-1306 — ONE edit affordance into the deck-readiness inputs
              surface (photos, hero cover/video, website, price, vibes). The old
              second "rerun-recommend" button was a redundant duplicate that
              navigated to the exact same place (goToDeckReadiness); consolidated
              to a single primary CTA. The pitch + match scores are still written
              by Mingla at approve (ORCH-1304). */}
          {canMutate ? (
            <Button
              label="Edit photos & details"
              onPress={goToDeckReadiness}
              variant="primary"
              size="md"
              style={styles.inlineBtn}
              testID="venue-settings-edit-photos"
            />
          ) : null}
        </Section>
      ) : null}

      </>
      ) : null}

      {tab === "team" ? (
      <Section title="Team & permissions">
        <Text style={styles.rowSub}>
          Choose exactly who can open this venue and which operational pages
          they can use. This link opens Team preselected to this venue.
        </Text>
        <View style={styles.legend}>
          {ROLE_LEGEND.map((r) => (
            <View key={r.label} style={styles.legendRow}>
              <Text style={styles.legendRole}>{r.label}</Text>
              <Text style={styles.legendPerms}>{r.perms}</Text>
            </View>
          ))}
        </View>
        <Button
          label="Manage team"
          onPress={goToTeam}
          variant="secondary"
          size="sm"
          style={styles.inlineBtn}
        />
      </Section>
      ) : null}

      {/* ORCH-1190 #7 — the "Reach your guests / Message your guests" blast entry
          (ORCH-1186-D Leg 4) MOVED OUT of Settings to a top-of-Overview button
          (VenueIntelligenceModule). Same reuse-only deep-link (the EXISTING
          composer with the brand audience pre-selected); only the placement
          changed. I-PROPOSED-1186-D-BLAST-REUSE-ONLY still holds. */}

      {!canMutate ? (
        <Text style={styles.readOnlyNote}>
          You can view these settings. Ask a manager or owner to make changes.
        </Text>
      ) : null}
      </ScrollView>

      {/* #4490 — the Save bar belongs to the tabs that hold drafts (Terms and
          tax, Details and photos); feature switches save on their own. It also
          stays while anything is unsaved, so a draft is never stranded. */}
      {canMutate && (tab === "terms" || tab === "details" || settingsDirty) ? (
        <View style={styles.saveBar} testID="venue-settings-save-bar">
          <SaveCommitBar
            label="Save settings"
            changedLabels={settingsChangedLabels}
            captionState={
              hoursError || settingsSaveFailed
                ? "failed"
                : upsertHours.isPending || updateFee.isPending
                  ? "saving"
                  : hoursSaved
                    ? "saved"
                    : !settingsValid && settingsDirty
                      ? "invalid"
                      : settingsDirty
                        ? "dirty"
                        : "clean"
            }
            captionOverride={
              !settingsValid && feeNeedsAmount
                ? "Set a fee amount above zero to save"
                : hoursInvalid
                  ? "Fix opening hours to save"
                  : settingsSaveFailed
                    ? "Couldn't save. Your changes are still here."
                    : null
            }
            onPress={() => {
              void handleSaveSettings().catch(() => undefined);
            }}
            loading={upsertHours.isPending || updateFee.isPending}
            testID="venue-settings-save"
          />
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  host: {
    paddingHorizontal: space[4],
    paddingTop: space[4],
    gap: space[4],
  },
  saveBar: {
    paddingHorizontal: space[4],
    paddingTop: space[2],
    paddingBottom: space[6],
    backgroundColor: materials.pane.solidFill,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.lineStrong,
  },
  section: {
    gap: space[2],
  },
  sectionTitle: {
    ...type.label,
    color: color.text3,
  },
  bandCaption: {
    ...type.label,
    color: color.text3,
    marginTop: space[2],
  },
  saveBtn: {
    marginTop: space[4],
  },
  hoursLoading: {
    paddingVertical: space[6],
    alignItems: "center",
  },
  hoursSaved: {
    ...type.small,
    color: color.success,
    marginTop: space[2],
  },
  hoursError: {
    ...type.small,
    color: color.danger,
    marginTop: space[2],
  },
  editorLocked: {
    opacity: 0.6,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[4],
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    ...type.row,
    color: color.text1,
  },
  rowSub: {
    ...type.small,
    color: color.text2,
  },
  feePreview: {
    ...type.small,
    color: color.success,
    marginTop: space[1],
  },
  amountBlock: {
    marginTop: space[2],
    gap: space[1],
  },
  fieldLabel: {
    ...type.small,
    color: color.text2,
  },
  amountWarn: {
    ...type.small,
    color: color.warning,
  },
  discountControls: {
    marginTop: space[4],
  },
  blockCard: {
    marginTop: space[2],
    padding: space[4],
    borderRadius: radius.md,
    backgroundColor: color.warningTint,
    gap: space[2],
  },
  blockTitle: {
    ...type.row,
    color: color.text1,
  },
  blockBody: {
    ...type.small,
    color: color.text2,
  },
  segment: {
    flexDirection: "row",
    gap: space[2],
    marginTop: space[1],
  },
  segmentItem: {
    flex: 1,
    paddingVertical: space[2],
    paddingHorizontal: space[4],
    borderRadius: radius.full,
    backgroundColor: color.fill.inset,
    alignItems: "center",
  },
  segmentItemActive: {
    backgroundColor: color.accent,
  },
  segmentLabel: {
    ...type.small,
    color: color.text2,
    fontWeight: "600",
  },
  segmentLabelActive: {
    color: color.ink,
  },
  legend: {
    marginTop: space[1],
    gap: space[1],
  },
  legendRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: space[4],
  },
  legendRole: {
    ...type.small,
    color: color.text1,
    fontWeight: "600",
  },
  legendPerms: {
    ...type.small,
    color: color.text3,
    flex: 1,
    textAlign: "right",
  },
  inlineBtn: {
    marginTop: space[1],
    alignSelf: "flex-start",
  },
  readOnlyNote: {
    ...type.caption,
    color: color.text3,
    textAlign: "center",
    paddingBottom: space[4],
  },
});

export default VenueSettingsModule;
