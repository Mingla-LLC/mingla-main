/**
 * BrandPaymentsView — payments dashboard (J-A11 §5.3.7).
 *
 * Renders four states based on `brand.stripeStatus`:
 *   - not_connected → orange Connect banner + £0 KPIs + empty payouts + Export
 *   - onboarding → orange Verifying banner + £0 KPIs + empty + Export
 *   - active → green connected banner + populated KPIs + payouts + refunds + Export
 *   - restricted → red Action Required banner + £0/historical KPIs + payouts + Export
 *
 * Status-driven banner via `Record<BrandStripeStatus, BannerConfig | null>`
 * table. ORCH-0764C changed active from suppressed to explicit success banner.
 *
 * Inline composition (DEC-079 closure):
 *   - formatGbp (D-INV-A10-2 watch-point — THRESHOLD HIT, defer lift to J-A12)
 *   - formatRelativeTime (D-INV-A10-3 — THRESHOLD HIT, defer lift to J-A12)
 *   - StatusBanner (D-INV-A10-1 — first use; promote on 3+ uses)
 *
 * Per J-A10 spec §3.5.
 */

import React, { useCallback, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";

import {
  accent,
  glass,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type {
  Brand,
  BrandPayout,
  BrandPayoutStatus,
  BrandRefund,
  BrandStripeStatus,
} from "../../store/currentBrandStore";
import { formatCurrency } from "../../utils/currency";
import { formatRelativeTime } from "../../utils/relativeTime";

import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import { KpiTile } from "../ui/KpiTile";
import { Pill } from "../ui/Pill";
import type { PillVariant } from "../ui/Pill";
import { TopBar } from "../ui/TopBar";
// V3 multi-country surfaces — Sub-C Session A + B
import { BrandStripeBankSection } from "./BrandStripeBankSection";
import { BrandStripeKycRemediationCard } from "./BrandStripeKycRemediationCard";
import { BrandStripeOrphanedRefundsSection } from "./BrandStripeOrphanedRefundsSection";
import { BrandStripeDeadlineBanner } from "./BrandStripeDeadlineBanner";
// ORCH-0802 — Danger zone: Disconnect Stripe sheet (was HIDDEN-FLAW-2 in
// investigation — detach hook+service shipped in B2a Path C V3 without a
// UI surface).
import { BrandStripeDetachConfirmSheet } from "./BrandStripeDetachConfirmSheet";
// META-ORCH-1076 Phase 2 — Paystack (NG) payout onboarding surface.
import { BrandPaystackOnboardView } from "./BrandPaystackOnboardView";
import {
  useBrandPaystackStatus,
  useDisconnectPaystack,
} from "../../hooks/useBrandPaystack";
import { useBrandStripeStatus } from "../../hooks/useBrandStripeStatus";
import { useBrandStripeBalances } from "../../hooks/useBrandStripeBalances";
import { useBrandStripeTaxAccountSession } from "../../hooks/useBrandStripeTaxAccountSession";
import { useBrandStripeAccountSession } from "../../hooks/useBrandStripeAccountSession";
import { getEffectiveBrandStripeStatus } from "../../utils/stripeOnboardingOutcome";
import { ACTIVE_STRIPE_BANNER_TITLE } from "../../utils/brandStripeUiState";
import { majorFromMinor } from "../../utils/currency";

const RETURN_DEEP_LINK = "mingla-business://onboarding-complete" as const;

// Status-banner config table. ORCH-0764C requires active to render a visible
// success confirmation; only truly unsupported statuses would be suppressed.
// W-1 watch-point: kit lacks `alert`/`info` icons; restricted state uses
// `flag` (action-needed connotation) + semantic.error coloring.

interface BannerConfig {
  icon: IconName;
  iconColor: string;
  title: string;
  sub: string;
  ctaLabel: string | null;
  ctaVariant: "primary" | "destructive" | null;
  destructive: boolean;
  success?: boolean;
}

const BANNER_CONFIG: Record<BrandStripeStatus, BannerConfig | null> = {
  not_connected: {
    icon: "bank",
    iconColor: accent.warm,
    title: "Connect Stripe to sell tickets",
    sub: "Get paid for your events. Setup takes 5 minutes.",
    ctaLabel: "Connect Stripe",
    ctaVariant: "primary",
    destructive: false,
  },
  onboarding: {
    icon: "bank",
    iconColor: accent.warm,
    title: "Onboarding submitted — verifying",
    sub: "Stripe is reviewing your details. We'll email you when verified.",
    ctaLabel: "Finish onboarding",
    ctaVariant: "primary",
    destructive: false,
  },
  active: {
    icon: "check",
    iconColor: semantic.success,
    title: ACTIVE_STRIPE_BANNER_TITLE,
    sub: "Payments are ready for this brand.",
    ctaLabel: null,
    ctaVariant: null,
    destructive: false,
    success: true,
  },
  restricted: {
    icon: "flag", // W-1: alert/info absent in kit; flag = action-needed
    iconColor: semantic.error,
    title: "Action required — your account is limited",
    sub: "Stripe needs additional information before you can sell tickets.",
    ctaLabel: "Continue verification",
    ctaVariant: "destructive",
    destructive: true,
  },
};

const PAYOUT_PILL_VARIANT: Record<BrandPayoutStatus, PillVariant> = {
  paid: "live", // W-2: green dot — money safely landed
  in_transit: "info",
  failed: "error",
};

const PAYOUT_STATUS_LABEL: Record<BrandPayoutStatus, string> = {
  paid: "PAID",
  in_transit: "IN TRANSIT",
  failed: "FAILED",
};

export interface BrandPaymentsViewProps {
  brand: Brand | null;
  onBack: () => void;
  /**
   * Called when user taps Connect/Finish banner CTA — routes to onboarding
   * shell. Restricted remediation uses the same route so the app creates a
   * fresh Stripe Account Link.
   */
  onOpenOnboard: () => void;
  /**
   * Called when user taps the "Export finance report" Button — routes to
   * the finance reports surface. NEW in J-A12.
   */
  onOpenReports: () => void;
}

export const BrandPaymentsView: React.FC<BrandPaymentsViewProps> = ({
  brand,
  onBack,
  onOpenOnboard,
  onOpenReports,
}) => {
  const insets = useSafeAreaInsets();

  const handleExport = useCallback((): void => {
    onOpenReports();
  }, [onOpenReports]);

  // V3 (Sub-C Session A): live status query gives access to requirements
  // shape for the KycRemediationCard. Sibling-pattern: cached + Realtime-fed.
  const stripeStatusQuery = useBrandStripeStatus(brand?.id ?? null);
  const stripeStatus = getEffectiveBrandStripeStatus({
    liveStatus: stripeStatusQuery.data?.status,
    cachedStatus: brand?.stripeStatus,
  });
  const stripeBalancesQuery = useBrandStripeBalances(brand?.id ?? null, {
    stripeStatus,
  });
  // META-ORCH-1076 — Paystack rail. Enabled only for paystack brands; harmless
  // (disabled) for every Stripe brand. Hook runs unconditionally per React rules.
  const isPaystackBrand = brand?.paymentProvider === "paystack";
  const paystackStatusQuery = useBrandPaystackStatus(
    isPaystackBrand ? (brand?.id ?? null) : null,
  );
  const disconnectPaystackMutation = useDisconnectPaystack();
  const [paystackEditing, setPaystackEditing] = useState<boolean>(false);
  // ORCH-0955 — Tax CTA opens new brand-stripe-tax-account-session that mints
  // an AccountSession with tax_registrations + tax_settings GA components,
  // rendered in the Mingla-hosted /connect-tax-registrations page via
  // expo-web-browser. Replaces the legacy ORCH-0804 dashboard-link redirect
  // (deleted; would have broken under ORCH-0954 dashboard:'none' cutover).
  // ORCH-0955: brand is merchant of record; Stripe Tax for Platforms direct-
  // charge handles the calc/commit/reverse 3-step inline on every native PI.
  const taxAccountSession = useBrandStripeTaxAccountSession();
  // ORCH-0954 — Account management embedded-onboarding session for
  // dashboard:'none' Stripe-managed-risk Connect controllers.
  const accountSession = useBrandStripeAccountSession();
  const handleOpenAccountManagement = useCallback(async (): Promise<void> => {
    if (brand?.id === undefined || accountSession.isPending) return;
    const result = await accountSession.mutateAsync({
      brandId: brand.id,
      surface: "account_management",
    });
    await WebBrowser.openAuthSessionAsync(result.targetUrl, RETURN_DEEP_LINK);
  }, [accountSession, brand?.id]);
  const handleOpenTaxDashboard = useCallback((): void => {
    if (brand?.id === undefined || taxAccountSession.isPending) return;
    taxAccountSession.mutate(brand.id);
  }, [brand?.id, taxAccountSession]);

  // ORCH-0802 — Disconnect Stripe sheet visibility. Sheet is only ever
  // reachable from the Danger zone CTA below, which itself only renders
  // when stripeStatus is active OR restricted (SPEC §6.3 visibility gate).
  const [detachSheetVisible, setDetachSheetVisible] = useState<boolean>(false);
  const handleOpenDetach = useCallback((): void => {
    setDetachSheetVisible(true);
  }, []);
  const handleCloseDetach = useCallback((): void => {
    setDetachSheetVisible(false);
  }, []);

  const bannerConfig = BANNER_CONFIG[stripeStatus];

  // ORCH-0796 — `brand.payouts` and `brand.refunds` are intentionally unpopulated
  // by mapBrandRowToUi today (ORCH-0742 collapsed the persist payload to currentBrandId
  // only). This screen renders the empty state. Real per-brand payout/refund listing
  // is tracked separately from per-event reconciliation.
  const sortedPayouts = useMemo<BrandPayout[]>(() => {
    if (brand === null) return [];
    return (brand.payouts ?? [])
      .slice()
      .sort((a, b) => (a.arrivedAt < b.arrivedAt ? 1 : -1));
  }, [brand]);

  const sortedRefunds = useMemo<BrandRefund[]>(() => {
    if (brand === null) return [];
    return (brand.refunds ?? [])
      .slice()
      .sort((a, b) => (a.refundedAt < b.refundedAt ? 1 : -1));
  }, [brand]);

  // ----- Not-found state -----
  if (brand === null) {
    return (
      <View style={styles.host}>
        <View style={styles.barWrap}>
          <TopBar
            leftKind="back"
            title="Payments"
            onBack={onBack}
            rightSlot={<View />}
          />
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.notFoundTitle}>Brand not found</Text>
            <Text style={styles.notFoundBody}>
              The brand you tried to open doesn{"’"}t exist or has been removed.
              Go back to your account to pick another.
            </Text>
            <View style={styles.notFoundBtnRow}>
              <Button
                label="Back to Account"
                onPress={onBack}
                variant="secondary"
                size="md"
                leadingIcon="arrowL"
              />
            </View>
          </GlassCard>
        </ScrollView>
      </View>
    );
  }

  // ----- Paystack rail (META-ORCH-1076 Phase 2) -----
  // Nigerian brands settle through Paystack, not Stripe Connect. Render the
  // bank-details onboarding form until a subaccount exists, then a readiness
  // card. Entirely separate from the Stripe surface below.
  if (isPaystackBrand) {
    const connected = brand.paystackSubaccountCode != null ||
      paystackStatusQuery.data?.connected === true;
    const ps = paystackStatusQuery.data;
    const handleDisconnect = (): void => {
      Alert.alert(
        "Disconnect payout bank?",
        "This brand will stop receiving payouts until you connect a bank again.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Disconnect",
            style: "destructive",
            onPress: () => {
              disconnectPaystackMutation.mutate(brand.id, {
                onSuccess: () => {
                  setPaystackEditing(false);
                  paystackStatusQuery.refetch();
                },
                onError: () =>
                  Alert.alert(
                    "Couldn't disconnect",
                    "Please try again in a moment.",
                  ),
              });
            },
          },
        ],
      );
    };
    return (
      <View style={styles.host}>
        <View style={styles.barWrap}>
          <TopBar
            leftKind="back"
            title="Payments"
            onBack={onBack}
            rightSlot={<View />}
          />
        </View>
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: spacing.xl + Math.max(insets.bottom, spacing.md) },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {connected && !paystackEditing
            ? (
              <GlassCard variant="elevated" padding={spacing.lg}>
                <Text style={styles.notFoundTitle}>Bank connected</Text>
                <Text style={styles.notFoundBody}>
                  {ps?.account_number_masked != null
                    ? `Payouts settle to ${ps.account_number_masked}, usually the next business day.`
                    : "Your payout account is connected. Sales settle to your bank, usually the next business day."}
                  {ps?.is_verified === false
                    ? " Your bank is still being verified — your first payout may take a little longer."
                    : ""}
                </Text>
                <View style={styles.notFoundBtnRow}>
                  <Button
                    label="Change bank account"
                    onPress={() => setPaystackEditing(true)}
                    variant="secondary"
                    size="md"
                  />
                </View>
                <View style={{ marginTop: spacing.sm }}>
                  <Button
                    label={disconnectPaystackMutation.isPending
                      ? "Disconnecting…"
                      : "Disconnect bank"}
                    onPress={handleDisconnect}
                    variant="destructive"
                    size="md"
                    loading={disconnectPaystackMutation.isPending}
                  />
                </View>
              </GlassCard>
            )
            : (
              <BrandPaystackOnboardView
                brandId={brand.id}
                brandName={brand.displayName}
                mode={connected ? "update" : "create"}
                onConnected={() => {
                  setPaystackEditing(false);
                  paystackStatusQuery.refetch();
                }}
                onCancel={connected ? () => setPaystackEditing(false) : undefined}
              />
            )}
        </ScrollView>
      </View>
    );
  }

  // ----- Populated state -----

  const liveBalances = stripeBalancesQuery.data;
  const balanceCurrency = liveBalances?.currency ?? brand.defaultCurrency ??
    null;
  const availableDisplay = liveBalances && balanceCurrency !== null
    ? formatCurrency(
      majorFromMinor(liveBalances.availableMinor, balanceCurrency),
      balanceCurrency,
    )
    : "—";
  const pendingDisplay = liveBalances && balanceCurrency !== null
    ? formatCurrency(
      majorFromMinor(liveBalances.pendingMinor, balanceCurrency),
      balanceCurrency,
    )
    : "—";
  const balanceSub = liveBalances
    ? "Ready to pay out"
    : stripeStatus === "active"
    ? "Balance unavailable"
    : "Connect Stripe";
  const lastPayoutAmount = sortedPayouts[0]?.amountGbp;
  const lastPayoutCurrency = sortedPayouts[0]?.currency;
  const lastPayoutDisplay = brand.lastPayoutAt !== undefined &&
      lastPayoutAmount !== undefined &&
      lastPayoutCurrency !== undefined
    ? formatCurrency(lastPayoutAmount, lastPayoutCurrency)
    : "—";
  const lastPayoutSub = brand.lastPayoutAt !== undefined
    ? formatRelativeTime(brand.lastPayoutAt)
    : "No payouts yet";

  return (
    <View style={styles.host}>
      <View style={styles.barWrap}>
        <TopBar
          leftKind="back"
          title="Payments"
          onBack={onBack}
          rightSlot={<View />}
        />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: spacing.xl + Math.max(insets.bottom, spacing.md) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ORCH-0954 — Manage payouts & tax embedded account-management session,
            for dashboard:'none' Stripe-managed-risk Connect controllers. */}
        {stripeStatus === "active" || stripeStatus === "restricted"
          ? (
            <GlassCard
              variant="base"
              padding={spacing.md}
              style={styles.manageStripeCard}
            >
              <View style={styles.manageStripeRow}>
                <View style={styles.manageStripeIconCol}>
                  <Icon name="bank" size={20} color={accent.warm} />
                </View>
                <View style={styles.manageStripeTextCol}>
                  <Text style={styles.manageStripeTitle}>
                    Manage payouts & tax
                  </Text>
                  <Text style={styles.manageStripeBody}>
                    Update payout details and resolve Stripe account alerts.
                  </Text>
                  {accountSession.isError
                    ? (
                      <Text style={styles.manageStripeError}>
                        Couldn{"’"}t open Stripe account management. Try again.
                      </Text>
                    )
                    : null}
                </View>
              </View>
              <View style={styles.manageStripeBtnRow}>
                <Button
                  label={accountSession.isPending
                    ? "Opening Stripe..."
                    : "Manage payouts & tax"}
                  onPress={handleOpenAccountManagement}
                  variant="primary"
                  size="md"
                  disabled={accountSession.isPending}
                  leadingIcon="bank"
                  accessibilityLabel="Manage payouts and tax"
                />
              </View>
            </GlassCard>
          )
          : null}

        {/* SECTION A — Status Banner */}
        {bannerConfig !== null
          ? (
            <GlassCard
              variant="base"
              padding={spacing.md}
              style={[
                bannerConfig.destructive ? styles.bannerDestructive : null,
                bannerConfig.success ? styles.bannerSuccess : null,
              ]}
            >
              <View style={styles.bannerRow}>
                <View
                  style={[
                    styles.bannerIconWrap,
                    bannerConfig.destructive &&
                    styles.bannerIconWrapDestructive,
                    bannerConfig.success && styles.bannerIconWrapSuccess,
                  ]}
                >
                  <Icon
                    name={bannerConfig.icon}
                    size={20}
                    color={bannerConfig.iconColor}
                  />
                </View>
                <View style={styles.bannerTextCol}>
                  <Text style={styles.bannerTitle}>{bannerConfig.title}</Text>
                  <Text style={styles.bannerSub}>{bannerConfig.sub}</Text>
                </View>
              </View>
              {bannerConfig.ctaLabel !== null &&
                  bannerConfig.ctaVariant !== null
                ? (
                  <View style={styles.bannerCtaRow}>
                    <Button
                      label={bannerConfig.ctaLabel}
                      onPress={onOpenOnboard}
                      variant={bannerConfig.ctaVariant}
                      size="md"
                      fullWidth
                      accessibilityLabel={bannerConfig.ctaLabel}
                    />
                  </View>
                )
                : null}
            </GlassCard>
          )
          : null}

        {stripeStatusQuery.isError
          ? (
            <GlassCard
              variant="base"
              padding={spacing.md}
              style={styles.statusRefreshWarning}
            >
              <Text style={styles.statusRefreshTitle}>
                Couldn{"’"}t refresh Stripe status
              </Text>
              <Text style={styles.statusRefreshBody}>
                Showing the last saved status. Continue verification will create
                a fresh Stripe link.
              </Text>
            </GlassCard>
          )
          : null}

        {stripeBalancesQuery.isError
          ? (
            <GlassCard
              variant="base"
              padding={spacing.md}
              style={styles.statusRefreshWarning}
            >
              <Text style={styles.statusRefreshTitle}>
                Couldn{"’"}t refresh Stripe balance
              </Text>
              <Text style={styles.statusRefreshBody}>
                Balance unavailable until Stripe balance refresh works.
              </Text>
            </GlassCard>
          )
          : null}

        {
          /* SECTION A2 — V3 multi-country surfaces (Sub-C Session A + B).
            Deadline banner on top (within 7 days, urgent). KYC remediation
            card next (when status non-active and there's a requirement code).
            Bank verification status (when connected). Orphaned refunds at
            the bottom (only for detached brands). */
        }
        {brand && stripeStatusQuery.data?.requirements
          ? (() => {
            const reqs = stripeStatusQuery.data.requirements as
              | { current_deadline?: number | null }
              | undefined;
            const deadline = reqs?.current_deadline ?? null;
            return (
              <BrandStripeDeadlineBanner
                deadline={deadline}
                onResolve={onOpenOnboard}
              />
            );
          })()
          : null}

        {brand && stripeStatus !== "active" && stripeStatus !== "not_connected"
          ? (() => {
            const requirements = (stripeStatusQuery.data?.requirements as
              | {
                disabled_reason?: string | null;
                currently_due?: readonly string[] | null;
                past_due?: readonly string[] | null;
              }
              | undefined) ?? null;
            return (
              <BrandStripeKycRemediationCard
                requirements={requirements}
                onResolve={onOpenOnboard}
              />
            );
          })()
          : null}

        {brand && (stripeStatus === "active" || stripeStatus === "restricted")
          ? (
            <BrandStripeBankSection
              brandId={brand.id}
              onResolve={onOpenOnboard}
            />
          )
          : null}

        {brand && stripeStatusQuery.data?.detached_at != null
          ? <BrandStripeOrphanedRefundsSection brandId={brand.id} />
          : null}

        {/* SECTION B — KPI Tiles (always rendered) */}
        <View style={styles.kpisRow}>
          <KpiTile
            label="Available"
            value={availableDisplay}
            sub={balanceSub}
            style={styles.kpiCell}
          />
          <KpiTile
            label="Pending"
            value={pendingDisplay}
            sub={liveBalances ? "In Stripe escrow" : "Balance unavailable"}
            style={styles.kpiCell}
          />
          <KpiTile
            label="Last payout"
            value={lastPayoutDisplay}
            sub={lastPayoutSub}
            style={styles.kpiCell}
          />
        </View>

        {/* SECTION B.5 — ORCH-0955 embedded Tax tools.
            Mints an AccountSession with tax_registrations + tax_settings
            GA components, then opens the Mingla-hosted
            /connect-tax-registrations page (via expo-web-browser) which
            mounts both components inline. Replaces the legacy ORCH-0804
            Stripe Express Dashboard login-link redirect (deleted; broke
            under ORCH-0954 dashboard:'none' cutover). Brand is merchant
            of record. Stripe Tax for Platforms direct-charge handles
            calc/commit/reverse on every native PI. */}
        {stripeStatus === "active" && brand !== null
          ? (
            <GlassCard
              variant="base"
              padding={spacing.md}
              style={styles.taxCtaCard}
            >
              <View style={styles.taxCtaRow}>
                <View style={styles.taxCtaIconCol}>
                  <Icon name="bank" size={20} color={accent.warm} />
                </View>
                <View style={styles.taxCtaTextCol}>
                  <Text style={styles.taxCtaTitle}>Tax & registrations</Text>
                  <Text style={styles.taxCtaBody}>
                    Manage tax registrations and settings in Stripe. Stripe Tax
                    adds about 0.5% on top of Stripe fees. You're the merchant
                    of record.
                  </Text>
                  {taxAccountSession.isError
                    ? (
                      <Text style={styles.taxCtaError}>
                        Couldn't open Stripe. Try again.
                      </Text>
                    )
                    : null}
                </View>
              </View>
              <View style={styles.taxCtaBtnRow}>
                <Button
                  label={taxAccountSession.isPending
                    ? "Opening Stripe..."
                    : "Manage tax registrations"}
                  onPress={handleOpenTaxDashboard}
                  variant="secondary"
                  size="md"
                  disabled={taxAccountSession.isPending}
                  leadingIcon="link"
                />
              </View>
            </GlassCard>
          )
          : null}

        {/* SECTION C — Recent Payouts */}
        <Text style={styles.sectionLabel}>RECENT PAYOUTS</Text>
        {sortedPayouts.length === 0
          ? (
            <GlassCard variant="base" padding={spacing.lg}>
              <Text style={styles.emptyTitle}>No payouts yet</Text>
              <Text style={styles.emptyBody}>
                Payouts arrive here once you start selling tickets.
              </Text>
            </GlassCard>
          )
          : (
            <GlassCard variant="base" padding={0}>
              {sortedPayouts.map((payout, index) => {
                const isLast = index === sortedPayouts.length - 1;
                return (
                  <View
                    key={payout.id}
                    style={[styles.txnRow, !isLast && styles.txnRowDivider]}
                  >
                    <View style={styles.txnLeftCol}>
                      <Text style={styles.txnAmount}>
                        {payout.currency.length > 0
                          ? formatCurrency(payout.amountGbp, payout.currency)
                          : "—"}
                      </Text>
                      <Text style={styles.txnSub}>
                        {payout.status === "in_transit"
                          ? "Arriving soon"
                          : `Paid ${formatRelativeTime(payout.arrivedAt)}`}
                      </Text>
                    </View>
                    <Pill variant={PAYOUT_PILL_VARIANT[payout.status]}>
                      {PAYOUT_STATUS_LABEL[payout.status]}
                    </Pill>
                  </View>
                );
              })}
            </GlassCard>
          )}

        {/* SECTION D — Recent Refunds (skipped entirely when empty) */}
        {sortedRefunds.length > 0
          ? (
            <>
              <Text style={[styles.sectionLabel, styles.sectionLabelGap]}>
                RECENT REFUNDS
              </Text>
              <GlassCard variant="base" padding={0}>
                {sortedRefunds.map((refund, index) => {
                  const isLast = index === sortedRefunds.length - 1;
                  return (
                    <View
                      key={refund.id}
                      style={[styles.txnRow, !isLast && styles.txnRowDivider]}
                    >
                      <View style={styles.txnLeftCol}>
                        {/* Render-time minus prefix on positive amount per spec §6 + AC#27 */}
                        <Text style={styles.txnAmountRefund}>
                          {refund.currency.length > 0
                            ? `−${
                              formatCurrency(refund.amountGbp, refund.currency)
                            }`
                            : "—"}
                        </Text>
                        <Text style={styles.txnSub} numberOfLines={1}>
                          {refund.eventTitle}
                          {refund.reason !== undefined
                            ? ` · ${refund.reason}`
                            : ""}
                        </Text>
                      </View>
                      <Text style={styles.refundDate}>
                        {formatRelativeTime(refund.refundedAt)}
                      </Text>
                    </View>
                  );
                })}
              </GlassCard>
            </>
          )
          : null}

        {/* SECTION E — Export CTA */}
        <View style={styles.exportRow}>
          <Button
            label="Export finance report"
            onPress={handleExport}
            variant="secondary"
            size="md"
            leadingIcon="chart"
            fullWidth
          />
        </View>

        {
          /* SECTION F — ORCH-0802 Danger zone: Disconnect Stripe.
            Only rendered for active/restricted (the only states where
            there is a real connection to sever). Hidden for not_connected
            (nothing to disconnect) and onboarding (would strand the brand
            mid-onboarding without a recovery path). */
        }
        {(stripeStatus === "active" || stripeStatus === "restricted") &&
            brand !== null
          ? (
            <View style={styles.dangerZone}>
              <Text style={styles.dangerZoneTitle}>DANGER ZONE</Text>
              <GlassCard variant="base" padding={spacing.md}>
                <Text style={styles.dangerZoneBody}>
                  Disconnecting stops {brand.displayName}{" "}
                  from selling tickets. Existing buyers keep their tickets;
                  refunds remain visible under your refund history.
                </Text>
                <View style={styles.dangerZoneBtnRow}>
                  <Button
                    label="Disconnect Stripe"
                    onPress={handleOpenDetach}
                    variant="destructive"
                    size="md"
                    leadingIcon="bank"
                    accessibilityLabel={`Disconnect Stripe from ${brand.displayName}`}
                  />
                </View>
              </GlassCard>
            </View>
          )
          : null}
      </ScrollView>

      {
        /* ORCH-0802 — Detach confirmation sheet. Mounted outside the
          ScrollView so the modal overlay isn't clipped by the scroll
          frame. brandId/brandName are null-guarded — the sheet renders
          null when either is missing. */
      }
      <BrandStripeDetachConfirmSheet
        visible={detachSheetVisible}
        brandId={brand?.id ?? null}
        brandName={brand?.displayName ?? null}
        onClose={handleCloseDetach}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  barWrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },

  // Not-found state ------------------------------------------------------
  notFoundTitle: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    letterSpacing: typography.h2.letterSpacing,
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  notFoundBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    marginBottom: spacing.md,
  },
  notFoundBtnRow: {
    flexDirection: "row",
    marginTop: spacing.sm,
  },

  // Banner ---------------------------------------------------------------
  bannerDestructive: {
    borderColor: "rgba(239, 68, 68, 0.45)", // Pill error border style
    borderWidth: 1,
  },
  bannerSuccess: {
    borderColor: "rgba(34, 197, 94, 0.45)",
    borderWidth: 1,
  },
  bannerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  bannerIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
    alignItems: "center",
    justifyContent: "center",
  },
  bannerIconWrapDestructive: {
    backgroundColor: semantic.errorTint,
    borderColor: "rgba(239, 68, 68, 0.45)",
  },
  bannerIconWrapSuccess: {
    backgroundColor: semantic.successTint,
    borderColor: "rgba(34, 197, 94, 0.45)",
  },
  bannerTextCol: {
    flex: 1,
    minWidth: 0,
  },
  bannerTitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  bannerSub: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
    marginTop: 2,
  },
  bannerCtaRow: {
    marginTop: spacing.md,
  },
  statusRefreshWarning: {
    borderColor: "rgba(251, 191, 36, 0.35)",
    borderWidth: 1,
  },
  statusRefreshTitle: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
  },
  statusRefreshBody: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
    marginTop: 4,
  },

  // ORCH-0954 — Embedded Stripe account-management entry ----------------
  manageStripeCard: {
    borderColor: accent.border,
    borderWidth: 1,
  },
  manageStripeRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  manageStripeIconCol: {
    width: 26,
    paddingTop: 2,
  },
  manageStripeTextCol: {
    flex: 1,
    minWidth: 0,
  },
  manageStripeTitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
    marginBottom: 2,
  },
  manageStripeBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  manageStripeError: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
    marginTop: 4,
  },
  manageStripeBtnRow: {
    marginTop: spacing.md,
    flexDirection: "row",
  },

  // KPI tiles ------------------------------------------------------------
  kpisRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  kpiCell: {
    flex: 1,
  },

  // ORCH-0804 — Tax & registrations CTA card -----------------------------
  taxCtaCard: {
    marginTop: spacing.md,
  },
  taxCtaRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  taxCtaIconCol: {
    width: 26,
    paddingTop: 2,
  },
  taxCtaTextCol: {
    flex: 1,
    minWidth: 0,
  },
  taxCtaTitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
    marginBottom: 2,
  },
  taxCtaBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  taxCtaError: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
    marginTop: 4,
  },
  taxCtaBtnRow: {
    marginTop: spacing.sm,
    alignItems: "flex-start",
  },

  // Section labels -------------------------------------------------------
  sectionLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: textTokens.tertiary,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.sm,
  },
  sectionLabelGap: {
    paddingTop: spacing.md,
  },

  // Empty state ----------------------------------------------------------
  emptyTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  emptyBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    marginTop: 4,
  },

  // Transaction rows (payouts + refunds) ---------------------------------
  txnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  txnRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.profileBase,
  },
  txnLeftCol: {
    flex: 1,
    minWidth: 0,
  },
  txnAmount: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  txnAmountRefund: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: semantic.error,
  },
  txnSub: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  refundDate: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
  },

  // Export CTA -----------------------------------------------------------
  exportRow: {
    marginTop: spacing.sm,
  },

  // ORCH-0802 — Danger zone (Disconnect Stripe) --------------------------
  dangerZone: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  dangerZoneTitle: {
    fontSize: typography.caption.fontSize,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: semantic.error,
  },
  dangerZoneBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  dangerZoneBtnRow: {
    flexDirection: "row",
    marginTop: spacing.sm,
  },
});

export default BrandPaymentsView;
