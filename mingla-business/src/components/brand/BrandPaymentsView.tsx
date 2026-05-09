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

import React, { useCallback, useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
import { useBrandStripeStatus } from "../../hooks/useBrandStripeStatus";
import { getEffectiveBrandStripeStatus } from "../../utils/stripeOnboardingOutcome";
import { ACTIVE_STRIPE_BANNER_TITLE } from "../../utils/brandStripeUiState";

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
  const bannerConfig = BANNER_CONFIG[stripeStatus];

  // [TRANSITIONAL] payouts + refunds still read from Zustand stub (brand.payouts,
  // brand.refunds). B2a does NOT migrate these to real `payouts` + `refunds`
  // table queries — that ships in B2b/B3 per SPEC §3.2 non-goals + DISC-2 +
  // DISC-7 from forensics. Existing Zustand fields will be deprecated to
  // orphan storage at that time; persist migration v12→v13 will drop them.
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

  // ----- Populated state -----

  const lastPayoutAmount = sortedPayouts[0]?.amountGbp;
  const lastPayoutDisplay =
    brand.lastPayoutAt !== undefined && lastPayoutAmount !== undefined
      ? formatCurrency(lastPayoutAmount, brand.defaultCurrency ?? "GBP")
      : "—";
  const lastPayoutSub =
    brand.lastPayoutAt !== undefined
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
        {/* SECTION A — Status Banner */}
        {bannerConfig !== null ? (
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
                  bannerConfig.destructive && styles.bannerIconWrapDestructive,
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
            {bannerConfig.ctaLabel !== null && bannerConfig.ctaVariant !== null ? (
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
            ) : null}
          </GlassCard>
        ) : null}

        {stripeStatusQuery.isError ? (
          <GlassCard variant="base" padding={spacing.md} style={styles.statusRefreshWarning}>
            <Text style={styles.statusRefreshTitle}>Couldn{"’"}t refresh Stripe status</Text>
            <Text style={styles.statusRefreshBody}>
              Showing the last saved status. Continue verification will create a
              fresh Stripe link.
            </Text>
          </GlassCard>
        ) : null}

        {/* SECTION A2 — V3 multi-country surfaces (Sub-C Session A + B).
            Deadline banner on top (within 7 days, urgent). KYC remediation
            card next (when status non-active and there's a requirement code).
            Bank verification status (when connected). Orphaned refunds at
            the bottom (only for detached brands). */}
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
              const requirements =
                (stripeStatusQuery.data?.requirements as
                  | { disabled_reason?: string | null; currently_due?: readonly string[] | null; past_due?: readonly string[] | null }
                  | undefined) ?? null;
              return (
                <BrandStripeKycRemediationCard
                  requirements={requirements}
                  onResolve={onOpenOnboard}
                />
              );
            })()
          : null}

        {brand && (stripeStatus === "active" || stripeStatus === "restricted") ? (
          <BrandStripeBankSection
            brandId={brand.id}
            onResolve={onOpenOnboard}
          />
        ) : null}

        {brand && stripeStatusQuery.data?.detached_at != null ? (
          <BrandStripeOrphanedRefundsSection brandId={brand.id} />
        ) : null}

        {/* SECTION B — KPI Tiles (always rendered) */}
        <View style={styles.kpisRow}>
          <KpiTile
            label="Available"
            value={formatCurrency(brand.availableBalanceGbp ?? 0, brand.defaultCurrency ?? "GBP")}
            sub="Ready to pay out"
            style={styles.kpiCell}
          />
          <KpiTile
            label="Pending"
            value={formatCurrency(brand.pendingBalanceGbp ?? 0, brand.defaultCurrency ?? "GBP")}
            sub="In Stripe escrow"
            style={styles.kpiCell}
          />
          <KpiTile
            label="Last payout"
            value={lastPayoutDisplay}
            sub={lastPayoutSub}
            style={styles.kpiCell}
          />
        </View>

        {/* SECTION C — Recent Payouts */}
        <Text style={styles.sectionLabel}>RECENT PAYOUTS</Text>
        {sortedPayouts.length === 0 ? (
          <GlassCard variant="base" padding={spacing.lg}>
            <Text style={styles.emptyTitle}>No payouts yet</Text>
            <Text style={styles.emptyBody}>
              Payouts arrive here once you start selling tickets.
            </Text>
          </GlassCard>
        ) : (
          <GlassCard variant="base" padding={0}>
            {/* [TRANSITIONAL] payout rows are visually inert in Cycle 2 —
                no detail-view drill-in. B2 wires per-payout detail screens
                with full Stripe transaction breakdown. */}
            {sortedPayouts.map((payout, index) => {
              const isLast = index === sortedPayouts.length - 1;
              return (
                <View
                  key={payout.id}
                  style={[styles.txnRow, !isLast && styles.txnRowDivider]}
                >
                  <View style={styles.txnLeftCol}>
                    <Text style={styles.txnAmount}>
                      {formatCurrency(payout.amountGbp, brand.defaultCurrency ?? "GBP")}
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
        {sortedRefunds.length > 0 ? (
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
                        {`−${formatCurrency(refund.amountGbp, brand.defaultCurrency ?? "GBP")}`}
                      </Text>
                      <Text style={styles.txnSub} numberOfLines={1}>
                        {refund.eventTitle}
                        {refund.reason !== undefined ? ` · ${refund.reason}` : ""}
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
        ) : null}

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
      </ScrollView>

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

  // KPI tiles ------------------------------------------------------------
  kpisRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  kpiCell: {
    flex: 1,
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
});

export default BrandPaymentsView;
