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

import React, { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";

import {
  accent,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import {
  useSetReservationsEnabled,
  useUpdateReservationFee,
  useVenueReservationSettings,
} from "../../hooks/useVenueReservationSettings";
import { BRAND_ROLE_RANK } from "../../utils/brandRole";
import { formatCurrency, normalizeCurrency } from "../../utils/currency";
import {
  brandStripeOnboardingRoute,
  paidPublishGuardCopy,
} from "../../utils/paidPublishGuards";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { brandPayoutReadiness, canEnablePaidReservationFee } from "./venueFeeGate";

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
      updateFee.mutate({
        feeEnabled: next,
        feeCurrency: next ? currency : null,
      });
    },
    [canMutate, payoutReady, updateFee, currency],
  );

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
    if (!feeEnabled || feeAmountCents <= 0) return null;
    return formatCurrency(feeAmountCents, currency, true);
  }, [feeEnabled, feeAmountCents, currency]);

  return (
    <View style={styles.host} testID={testID ?? "venue-settings-module"}>
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

            {feeEnabled && feePreview !== null ? (
              <Text style={styles.feePreview}>
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

      {/* 3 — Venue profile (read-mostly; editing routes to existing surfaces). */}
      <Section title="Venue profile">
        <Text style={styles.rowTitle}>{brand?.displayName ?? "Your venue"}</Text>
        {brand?.city != null ? (
          <Text style={styles.rowSub}>{brand.city}</Text>
        ) : null}
        <Button
          label="Edit venue details"
          onPress={() => {
            if (brandId !== null) router.push(`/brand/${brandId}` as never);
          }}
          variant="secondary"
          size="sm"
          style={styles.inlineBtn}
        />
      </Section>

      {/* 4 — Hours (read-only summary; full editor is 2.1 Availability). */}
      <Section title="Hours">
        <Text style={styles.rowSub}>
          Your opening hours come from your venue profile. Reservation-specific
          hours and turn times arrive with the Availability update.
        </Text>
      </Section>

      {/* 5 — Team roles scaffold (DISPLAY ONLY; mutation reuses the Team surface). */}
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
