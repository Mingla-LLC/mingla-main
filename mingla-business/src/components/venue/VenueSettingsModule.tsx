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

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";

import {
  accent,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
  venueSettingsMaxWidth,
} from "../../constants/designSystem";
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
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
import { BrandHoursEditor } from "./BrandHoursEditor";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Input } from "../ui/Input";
import {
  brandPayoutReadiness,
  canEnablePaidReservationFee,
  paidFeeIsActive,
} from "./venueFeeGate";

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

/** ORCH-1186-A — human label for the venue category summary row. */
const CATEGORY_LABEL: Record<string, string> = {
  restaurant: "Restaurant",
  play: "Play",
  creative_and_arts: "Creative & Arts",
};

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
  /** Route the operator to payout onboarding when the paid-fee gate blocks. */
  testID?: string;
}

export function VenueSettingsModule({
  brandId,
  testID,
}: VenueSettingsModuleProps): React.ReactElement {
  const router = useRouter();
  const brand = useCurrentBrand();
  const { rank } = useCurrentBrandRole(brandId);
  const canMutate = rank >= MANAGER_PLUS_RANK;
  const { isWideDesktop } = useResponsiveLayout();
  const placePoolId = brand?.placePoolId ?? null;

  const settingsQuery = useVenueReservationSettings(brandId);
  const settings = settingsQuery.data ?? null;
  const reservationsEnabled = settings?.reservationsEnabled ?? false;

  const setEnabled = useSetReservationsEnabled(brandId);
  const updateFee = useUpdateReservationFee(brandId);

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
  // persisted cents; mirrors the table-sheet's string-input pattern. Kept in
  // sync when the server value changes (e.g. after a successful save / refetch).
  const [amountDraft, setAmountDraft] = useState<string>("");
  useEffect(() => {
    if (feeAmountCents > 0) {
      setAmountDraft(String(majorFromMinor(feeAmountCents, currency)));
    } else {
      setAmountDraft("");
    }
  }, [feeAmountCents, currency]);

  // Parse the draft → integer cents (currency-aware; zero-decimal safe). A blank
  // / non-numeric / non-positive draft → 0 (= "no amount set").
  const draftCents = useMemo<number>(() => {
    const major = Number.parseFloat(amountDraft.replace(/,/g, ""));
    if (!Number.isFinite(major) || major <= 0) return 0;
    return minorFromMajor(major, currency);
  }, [amountDraft, currency]);

  // The fee is a broken "paid but charges nothing" config while ON with no
  // positive amount — surface it and DO NOT treat the fee as active.
  const feeNeedsAmount = feeEnabled && draftCents <= 0;
  const feeActive = paidFeeIsActive(feeEnabled, draftCents);

  const handleToggleReservations = useCallback(
    (next: boolean): void => {
      if (!canMutate) return;
      setEnabled.mutate(next);
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

  // Commit the typed amount to fee_amount_cents (on blur / explicit save). A
  // null/0 draft writes null so the fee reads FREE rather than broken-paid.
  const handleSaveAmount = useCallback((): void => {
    if (!canMutate || !feeEnabled) return;
    updateFee.mutate({
      feeAmountCents: draftCents > 0 ? draftCents : null,
      feeCurrency: currency,
    });
  }, [canMutate, feeEnabled, updateFee, draftCents, currency]);

  const handleNoShowPolicy = useCallback(
    (policy: "forfeit" | "none"): void => {
      if (!canMutate) return;
      updateFee.mutate({ noShowFeePolicy: policy });
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
  const hoursQuery = useBrandHours(brandId);
  const upsertHours = useUpsertBrandHours(brandId);
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
      if (o >= c) return true;
    }
    return false;
  }, [hoursDraft]);

  const handleHoursChange = useCallback((next: BrandHourEntry[]): void => {
    setHoursDraft(next);
    setHoursSaved(false);
    setHoursError(false);
  }, []);

  const handleSaveHours = useCallback((): void => {
    if (!canMutate || hoursDraft === null || !hoursDirty || hoursInvalid) return;
    setHoursError(false);
    upsertHours.mutate(hoursDraft, {
      onSuccess: () => {
        setHoursSaved(true);
        // The mutation invalidates the hours query; the draft re-syncs above.
        setHoursDraft(null);
      },
      onError: () => {
        setHoursError(true);
      },
    });
  }, [canMutate, hoursDraft, hoursDirty, hoursInvalid, upsertHours]);

  // Auto-dismiss the success line.
  useEffect(() => {
    if (!hoursSaved) return;
    const t = setTimeout(() => setHoursSaved(false), 2500);
    return () => clearTimeout(t);
  }, [hoursSaved]);

  // ----- ORCH-1186-A: AI / photos / vibes read-only readout + entry point -----
  const authoringCtx = useBrandPlaceAuthoringContext(brandId, placePoolId);
  const galleryCount = authoringCtx.data?.gallery_urls?.length ?? 0;
  const scoreRows = useMemo(() => {
    const scores = authoringCtx.data?.ai_signal_scores ?? null;
    if (scores === null) return [];
    return Object.entries(scores)
      .filter(([, v]) => v.inappropriate_for !== true)
      .map(([id, v]) => ({ id, score: v.score_0_to_100 }))
      .sort((a, b) => b.score - a.score);
  }, [authoringCtx.data]);
  const editsRemaining = authoringCtx.data?.recommend_edits_remaining ?? null;

  const goToVenueEdit = useCallback((): void => {
    if (brandId !== null) router.push(`/brand/${brandId}` as never);
  }, [brandId, router]);

  const goToDeckReadiness = useCallback((): void => {
    if (brandId === null || placePoolId === null) return;
    router.push(
      `/venue/deck-readiness?brand_id=${brandId}&place_pool_id=${placePoolId}&focus=review&fix=review_pipeline` as never,
    );
  }, [brandId, placePoolId, router]);

  const hostStyle = useMemo(
    () =>
      isWideDesktop
        ? [styles.host, { maxWidth: venueSettingsMaxWidth, alignSelf: "flex-start" as const }]
        : styles.host,
    [isWideDesktop],
  );

  return (
    <View style={hostStyle} testID={testID ?? "venue-settings-module"}>
      {/* 1 — Reservations (canonical toggle home). */}
      <Section title="Reservations">
        <View style={styles.rowBetween}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Take table reservations</Text>
            <Text style={styles.rowSub}>
              Turn on the reservation suite for this venue. Free to switch on.
            </Text>
          </View>
          <Switch
            value={reservationsEnabled}
            onValueChange={handleToggleReservations}
            disabled={!canMutate || setEnabled.isPending}
            trackColor={{ false: "rgba(255,255,255,0.16)", true: accent.warm }}
            thumbColor="#ffffff"
            ios_backgroundColor="rgba(255,255,255,0.16)"
            accessibilityLabel="Reservations toggle"
            testID="venue-settings-reservations-toggle"
          />
        </View>
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
              <Switch
                value={feeEnabled}
                onValueChange={handleToggleFee}
                disabled={!canMutate || updateFee.isPending}
                trackColor={{ false: "rgba(255,255,255,0.16)", true: accent.warm }}
                thumbColor="#ffffff"
                ios_backgroundColor="rgba(255,255,255,0.16)"
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
                  onBlur={handleSaveAmount}
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
                    Set an amount above 0 to charge guests. Until you do, this fee
                    stays free.
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
              Cancellation cutoff: {settings?.cancelCutoffHours ?? 24} hours before
              the reservation.
            </Text>
            <View style={styles.segment}>
              {(["forfeit", "none"] as const).map((policy) => {
                const active = (settings?.noShowFeePolicy ?? "forfeit") === policy;
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
                      {policy === "forfeit" ? "Forfeit fee on no-show" : "No penalty"}
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
          These are the hours guests see — and the baseline for reservation slots.
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
        {canMutate && hoursDraft !== null ? (
          <>
            <Button
              label="Save hours"
              onPress={handleSaveHours}
              variant="primary"
              size="md"
              fullWidth
              loading={upsertHours.isPending}
              disabled={!hoursDirty || hoursInvalid || upsertHours.isPending}
              style={styles.saveBtn}
              testID="venue-settings-hours-save"
            />
            {hoursSaved ? (
              <Text style={styles.hoursSaved} testID="venue-settings-hours-saved">
                Hours saved.
              </Text>
            ) : null}
            {hoursError ? (
              <Text style={styles.hoursError} testID="venue-settings-hours-save-error">
                Couldn&apos;t save hours. Tap Save to try again.
              </Text>
            ) : null}
          </>
        ) : null}
      </Section>

      {/* 5 — Venue details (live summary + working edit affordance). */}
      <Section title="Venue details">
        <Text style={styles.rowTitle}>{brand?.displayName ?? "Your venue"}</Text>
        {brand?.tagline != null && brand.tagline.length > 0 ? (
          <Text style={styles.rowSub}>{brand.tagline}</Text>
        ) : null}
        {brand?.city != null ? (
          <Text style={styles.rowSub}>{brand.city}</Text>
        ) : null}
        {brand?.venueCategory != null ? (
          <Text style={styles.rowSub}>{CATEGORY_LABEL[brand.venueCategory]}</Text>
        ) : null}
        {canMutate ? (
          <Button
            label="Edit venue details"
            onPress={goToVenueEdit}
            variant="secondary"
            size="md"
            style={styles.inlineBtn}
            testID="venue-settings-edit-details"
          />
        ) : null}
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
              Run Recommend me to see how you match Mingla moments.
            </Text>
          )}
          {canMutate ? (
            <Button
              label="Edit photos & vibes"
              onPress={goToDeckReadiness}
              variant="secondary"
              size="md"
              style={styles.inlineBtn}
              testID="venue-settings-edit-photos"
            />
          ) : null}
          {editsRemaining !== null ? (
            <Text style={styles.rowSub}>
              {editsRemaining > 0
                ? `You can re-run "Recommend me" ${editsRemaining} more ${editsRemaining === 1 ? "time" : "times"}.`
                : "You've used all your changes. Contact support if you need more."}
            </Text>
          ) : null}
          {canMutate ? (
            <Button
              label="Re-run Recommend me"
              onPress={goToDeckReadiness}
              variant="primary"
              size="md"
              leadingIcon="sparkle"
              disabled={editsRemaining !== null && editsRemaining <= 0}
              style={styles.inlineBtn}
              testID="venue-settings-rerun-recommend"
            />
          ) : null}
        </Section>
      ) : null}

      {/* 7 — Team roles scaffold (DISPLAY ONLY; mutation reuses the Team surface). */}
      <Section title="Team roles">
        <Text style={styles.rowSub}>
          Who can manage reservations at this venue. Role assignment lives in your
          team settings — more venue-specific roles are coming.
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

      {!canMutate ? (
        <Text style={styles.readOnlyNote}>
          You can view these settings. Ask a manager or owner to make changes.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.md,
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
