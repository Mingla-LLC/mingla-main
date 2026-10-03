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
  useState,
} from "react";
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
  accent,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
import { useVenueListing } from "../../hooks/useVenueListings";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import { useBrandHours, useUpsertBrandHours } from "../../hooks/useBrandHours";
import { useBrandPlaceAuthoringContext } from "../../hooks/useBrandPlacePipelineState";
import {
  useSetReservationsEnabled,
  useUpdateReservationFee,
  useVenueReservationSettings,
} from "../../hooks/useVenueReservationSettings";
import type { BrandHourEntry } from "../../types/brand";
import { BRAND_ROLE_RANK } from "../../utils/brandRole";
import {
  formatCurrency,
  majorFromMinor,
  minorFromMajor,
  normalizeCurrency,
} from "../../utils/currency";
import {
  brandStripeOnboardingRoute,
  paidPublishGuardCopy,
} from "../../utils/paidPublishGuards";
import { useVenueSuiteStore } from "../../store/venueSuiteStore";
import { BrandHoursEditor } from "./BrandHoursEditor";
import { BrandSwitch } from "../ui/BrandSwitch";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Input } from "../ui/Input";
import { SaveCommitBar } from "./SaveCommitBar";
import {
  brandPayoutReadiness,
  canEnablePaidReservationFee,
  paidFeeIsActive,
} from "./venueFeeGate";
import type { VenueModuleLeaveHandle } from "./venueLeaveContract";
import { venueScrollBottomPad } from "./venueShellScroll";
import { VenueDetailsEditor } from "./VenueDetailsEditor";

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
}

export const VenueSettingsModule = forwardRef<
  VenueSettingsLeaveHandle,
  VenueSettingsModuleProps
>(function VenueSettingsModule(
  { brandId, venueId = null, testID },
  forwardedRef,
): React.ReactElement {
  const router = useRouter();
  const brand = useCurrentBrand();
  const { rank } = useCurrentBrandRole(brandId);
  const canMutate = rank >= MANAGER_PLUS_RANK;
  const setDirtyModule = useVenueSuiteStore((s) => s.setDirtyModule);
  // META-ORCH-1255 — the place pointer lives on the VENUE row (one owner per
  // truth); brands.place_pool_id is legacy-inert.
  const venueQuery = useVenueListing(venueId);
  const placePoolId = venueQuery.data?.placePoolId ?? null;

  const settingsQuery = useVenueReservationSettings(brandId, venueId);
  const settings = settingsQuery.data ?? null;
  const reservationsEnabled = settings?.reservationsEnabled ?? false;

  const setEnabled = useSetReservationsEnabled(brandId, venueId);
  const updateFee = useUpdateReservationFee(brandId, venueId);

  const currency = normalizeCurrency(brand?.defaultCurrency);
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

  const handleToggleReservations = useCallback(
    (next: boolean): void => {
      if (!canMutate) return;
      setSwitchStatus("saving");
      setSwitchError(null);
      setEnabled.mutate(next, {
        onSuccess: () => {
          setSwitchStatus("saved");
          setTimeout(() => setSwitchStatus("idle"), 1500);
        },
        onError: () => {
          setSwitchStatus("failed");
          setSwitchError("Couldn't turn this on. Try again.");
        },
      });
    },
    [canMutate, setEnabled],
  );

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
    router.push(`/brand/${brandId}/team` as never);
  }, [brandId, router]);

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
  useEffect(() => {
    if (serverHours !== null && hoursDraft === null) {
      setHoursDraft(serverHours);
    }
  }, [serverHours, hoursDraft]);

  const hoursDirty = useMemo<boolean>(() => {
    if (hoursDraft === null || serverHours === null) return false;
    return JSON.stringify(hoursDraft) !== JSON.stringify(serverHours);
  }, [hoursDraft, serverHours]);

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
    return false;
  }, [hoursDraft]);

  const handleHoursChange = useCallback((next: BrandHourEntry[]): void => {
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
      {/* 1 — Reservations (canonical toggle home). */}
      <Section title="Reservations">
        <View style={styles.rowBetween}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Take table reservations</Text>
            <Text style={styles.rowSub}>
              Turn on the reservation suite for this venue. Free to switch on.
            </Text>
          </View>
          <BrandSwitch
            value={reservationsEnabled}
            onValueChange={handleToggleReservations}
            disabled={!canMutate || setEnabled.isPending}
            accessibilityLabel="Reservations toggle"
            testID="venue-settings-reservations-toggle"
          />
        </View>
        {switchStatus === "saving" ? (
          <Text style={styles.rowSub} accessibilityLiveRegion="polite">
            Saving…
          </Text>
        ) : null}
        {switchStatus === "saved" ? (
          <Text
            style={styles.hoursSaved}
            accessibilityLiveRegion="polite"
            testID="venue-settings-switch-saved"
          >
            Saved
          </Text>
        ) : null}
        {switchStatus === "failed" && switchError !== null ? (
          <Text
            style={styles.hoursError}
            accessibilityLiveRegion="polite"
            testID="venue-settings-switch-error"
          >
            {switchError}
          </Text>
        ) : null}
      </Section>

      {reservationsEnabled ? (
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

            {feeEnabled && !feeBlocked ? (
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

            {feeActive && feePreview !== null ? (
              <Text
                style={styles.feePreview}
                testID="venue-settings-fee-preview"
              >
                Guests pay {feePreview} all-in at booking.
              </Text>
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
      <Text style={styles.bandCaption}>VENUE PROFILE</Text>

      {/* 4 — Opening hours (real editor; brand_hours is the single owner). */}
      <Section title="Opening hours">
        <Text style={styles.rowSub}>
          These are the hours guests see — and the baseline for reservation
          slots.
        </Text>
        {hoursQuery.isError ? (
          <Text style={styles.hoursError} testID="venue-settings-hours-error">
            Couldn&apos;t load your hours. Pull to refresh and try again.
          </Text>
        ) : hoursDraft === null ? (
          <View style={styles.hoursLoading}>
            <ActivityIndicator color={accent.warm} />
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
            <BrandHoursEditor
              hours={hoursDraft}
              onChange={handleHoursChange}
              showErrors={hoursDirty}
              disabled={!canMutate || upsertHours.isPending}
            />
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

      {/* 7 — Team roles scaffold (DISPLAY ONLY; mutation reuses the Team surface). */}
      <Section title="Team roles">
        <Text style={styles.rowSub}>
          Who can manage reservations at this venue. Role assignment lives in
          your team settings — more venue-specific roles are coming.
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

      {canMutate ? (
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
              void handleSaveSettings();
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
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  saveBar: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    backgroundColor: "rgba(12,14,18,.96)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,.12)",
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  bandCaption: {
    ...typography.labelCap,
    color: textTokens.tertiary,
    marginTop: spacing.sm,
  },
  saveBtn: {
    marginTop: spacing.md,
  },
  hoursLoading: {
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  hoursSaved: {
    ...typography.bodySm,
    color: semantic.success,
    marginTop: spacing.sm,
  },
  hoursError: {
    ...typography.bodySm,
    color: semantic.error,
    marginTop: spacing.sm,
  },
  editorLocked: {
    opacity: 0.6,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  rowText: {
    flex: 1,
    gap: spacing.xxs,
  },
  rowTitle: {
    ...typography.bodyLg,
    color: textTokens.primary,
  },
  rowSub: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  feePreview: {
    ...typography.bodySm,
    color: semantic.success,
    marginTop: spacing.xs,
  },
  amountBlock: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  fieldLabel: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  amountWarn: {
    ...typography.bodySm,
    color: semantic.warning,
  },
  blockCard: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: semantic.warningTint,
    gap: spacing.sm,
  },
  blockTitle: {
    ...typography.bodyLg,
    color: textTokens.primary,
  },
  blockBody: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  segment: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
  },
  segmentItemActive: {
    backgroundColor: accent.warm,
  },
  segmentLabel: {
    ...typography.bodySm,
    color: textTokens.secondary,
    fontWeight: "600",
  },
  segmentLabelActive: {
    color: "#0c0e12",
  },
  legend: {
    marginTop: spacing.xs,
    gap: spacing.xs,
  },
  legendRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  legendRole: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "600",
  },
  legendPerms: {
    ...typography.bodySm,
    color: textTokens.tertiary,
    flex: 1,
    textAlign: "right",
  },
  inlineBtn: {
    marginTop: spacing.xs,
    alignSelf: "flex-start",
  },
  readOnlyNote: {
    ...typography.caption,
    color: textTokens.tertiary,
    textAlign: "center",
    paddingBottom: spacing.md,
  },
});

export default VenueSettingsModule;
