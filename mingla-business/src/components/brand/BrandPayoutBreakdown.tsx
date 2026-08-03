/**
 * BrandPayoutBreakdown — #1180 held-payout receipt + release history.
 *
 * The one shared payout-history sub-tree rendered on BOTH rails (Stripe active/
 * restricted path + Paystack-connected branch of BrandPaymentsView). Answers an
 * organiser's three questions — did my money arrive, when will it, why is it
 * less than expected — at three levels of disclosure (DESIGN §1):
 *   L0 scan   — the release list (one row per release, newest-first).
 *   L1 drill  — tap a row → it expands in place to the gross→bank receipt.
 *   L2 learn  — the "How payouts work" link opens the explainer sheet (parent).
 *
 * Composes existing primitives ONLY (GlassCard / Pill / Skeleton / Icon /
 * Button) — zero new design-system tokens, no hand-rolled translucent View
 * (GlassCard owns the iOS-translucent / Android-opaque treatment).
 *
 * Read path: useBrandPayoutLedger reads the ledger TABLES directly via RLS
 * (finance_manager+). Below that rank RLS returns zero rows indistinguishably
 * from "no data", so the role branch renders a DISTINCT "limited access" state
 * (never "no payouts yet") — closes the RLS-returning-owner-gap for reads.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { LayoutChangeEvent } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import {
  accent,
  durations,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { formatCurrency } from "../../utils/currency";
import { formatRelativeTime } from "../../utils/relativeTime";
import { useBrandPayoutLedger } from "../../hooks/useBrandPayoutLedger";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import { BRAND_ROLE_RANK } from "../../utils/brandRole";
import {
  buildPayoutWaterfall,
  isRefundAdjustment,
  payoutStatusOneLiner,
  PAYOUT_STATUS_PRESENTATION,
  refundAdjustmentLabel,
  refundAdjustmentSign,
  releaseHeadlineCents,
  sumOutstandingDebtByCurrency,
  type BrandPayoutReleaseDTO,
  type PayoutLedgerAdjustmentDTO,
  type PayoutTransferLegDTO,
  type WaterfallLine,
} from "../../utils/payoutBreakdown";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import type { PillVariant } from "../ui/Pill";
import { Skeleton } from "../ui/Skeleton";
import { BrandPayoutStatusPill } from "./BrandPayoutStatusPill";

const FINANCE_MANAGER_RANK = BRAND_ROLE_RANK.finance_manager; // 30

export interface BrandPayoutBreakdownProps {
  brandId: string;
  /** NG (Paystack) brand — passed through only for parity/testing hooks. */
  isNgBrand: boolean;
  /** Opens the "How payouts work" explainer sheet (owned by the parent). */
  onOpenExplainer: () => void;
}

// Bucket chrome for the leading status-icon chip (DESIGN §4.2).
const bucketChrome = (variant: PillVariant): { bg: string; fg: string } => {
  switch (variant) {
    case "live":
      return { bg: semantic.successTint, fg: semantic.success };
    case "warn":
      return { bg: semantic.warningTint, fg: semantic.warning };
    case "error":
      return { bg: semantic.errorTint, fg: semantic.error };
    case "draft":
      return { bg: glass.tint.profileElevated, fg: textTokens.tertiary };
    case "info":
    default:
      return { bg: semantic.infoTint, fg: semantic.info };
  }
};

const formatOccurrenceDate = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
};

// ---------------------------------------------------------------------------
// Receipt (the expanded gross→bank waterfall).
// ---------------------------------------------------------------------------

const PayoutReceipt: React.FC<{
  release: BrandPayoutReleaseDTO;
  legs: readonly PayoutTransferLegDTO[];
}> = ({ release, legs }) => {
  const { lines, final } = useMemo(
    () => buildPayoutWaterfall(release, legs),
    [release, legs],
  );
  const currency = release.currency;

  const renderValue = (line: WaterfallLine): React.ReactNode => {
    if (line.qualifier === "confirming" || line.valueCents === null) {
      return (
        <Text style={[styles.lineValue, styles.lineValueConfirming]}>
          Confirming…
        </Text>
      );
    }
    const money = formatCurrency(line.valueCents, currency, true);
    const prefixed = line.sign === null ? money : `${line.sign}${money}`;
    const valueColor =
      line.tone === "success"
        ? styles.lineValueSuccess
        : line.tone === "primary"
          ? styles.lineValuePrimary
          : styles.lineValueSecondary;
    return (
      <Text style={[styles.lineValue, valueColor]} numberOfLines={1}>
        {prefixed}
      </Text>
    );
  };

  const a11yValue = (line: WaterfallLine): string => {
    if (line.qualifier === "confirming" || line.valueCents === null) {
      return "being confirmed";
    }
    const money = formatCurrency(line.valueCents, currency, true);
    const spoken = line.sign === "−" ? "minus " : line.sign === "+" ? "plus " : "";
    return `${spoken}${money}`;
  };

  return (
    <View style={styles.receipt}>
      {lines.map((line) => (
        <View
          key={line.key}
          style={styles.line}
          accessibilityLabel={`${line.label}: ${a11yValue(line)}`}
        >
          <Text style={styles.lineLabel} numberOfLines={2}>
            {line.label}
            {line.qualifier === "estimated" ? (
              <Text style={styles.lineQualifier}> · estimated</Text>
            ) : null}
          </Text>
          {renderValue(line)}
        </View>
      ))}
      <View
        style={styles.finalLine}
        accessibilityLabel={`${final.label} total: ${formatCurrency(final.valueCents, currency, true)}`}
      >
        <Text style={styles.finalLabel}>
          {final.label}
          {final.confirming ? (
            <Text style={styles.lineQualifier}> · confirming fees</Text>
          ) : null}
        </Text>
        <Text style={styles.finalValue} numberOfLines={1}>
          {formatCurrency(final.valueCents, currency, true)}
        </Text>
      </View>
    </View>
  );
};

// ---------------------------------------------------------------------------
// Release row (collapsed Level-0 + expandable Level-1 receipt).
// ---------------------------------------------------------------------------

const BrandPayoutReleaseRow: React.FC<{
  release: BrandPayoutReleaseDTO;
  legs: readonly PayoutTransferLegDTO[];
  divider: boolean;
}> = ({ release, legs, divider }) => {
  const reduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);
  const progress = useSharedValue(0);

  useEffect(() => {
    const target = expanded ? 1 : 0;
    if (reduceMotion) {
      progress.value = target;
    } else {
      progress.value = withTiming(target, {
        duration: durations.entry,
        easing: Easing.bezier(0.33, 1, 0.68, 1),
      });
    }
  }, [expanded, progress, reduceMotion]);

  const receiptStyle = useAnimatedStyle(
    () => ({
      height: progress.value * contentHeight,
      opacity: progress.value,
    }),
    [contentHeight],
  );
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotateZ: `${progress.value * 180}deg` }],
  }));

  const presentation = PAYOUT_STATUS_PRESENTATION[release.status];
  const chrome = bucketChrome(presentation.variant);
  const headline = formatCurrency(
    releaseHeadlineCents(release),
    release.currency,
    true,
  );
  const occurrence = formatOccurrenceDate(release.anchorEndAt);
  const relativeReleased =
    release.releasedAt !== null ? formatRelativeTime(release.releasedAt) : undefined;
  const oneLiner = payoutStatusOneLiner(release.status, {
    relativeTime: relativeReleased,
  });
  const title = "Event payout";

  const onMeasure = (event: LayoutChangeEvent): void => {
    const next = Math.round(event.nativeEvent.layout.height);
    if (next !== contentHeight) setContentHeight(next);
  };

  return (
    <Pressable
      onPress={() => setExpanded((prev) => !prev)}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`${title}, ${presentation.label}, ${headline}. ${oneLiner}`}
      accessibilityHint="Double tap to show the payment breakdown"
      style={({ pressed }) => [
        styles.row,
        divider ? styles.rowDivider : null,
        pressed ? styles.rowPressed : null,
      ]}
    >
      {/* Tier A */}
      <View style={styles.tierA}>
        <View
          style={[styles.iconChip, { backgroundColor: chrome.bg }]}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          <Icon name={presentation.icon} size={16} color={chrome.fg} />
        </View>
        <View style={styles.middleCol}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
          {occurrence.length > 0 ? (
            <Text style={styles.rowMeta} numberOfLines={1}>
              {occurrence}
            </Text>
          ) : null}
        </View>
        <View style={styles.trailingCol}>
          <Text style={styles.rowAmount} numberOfLines={1}>
            {headline}
          </Text>
          <BrandPayoutStatusPill status={release.status} />
        </View>
      </View>

      {/* Tier B */}
      <View style={styles.tierB}>
        <Text style={styles.oneLiner} numberOfLines={2}>
          {oneLiner}
        </Text>
        <Animated.View
          style={chevronStyle}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          <Icon name="chevD" size={16} color={textTokens.tertiary} />
        </Animated.View>
      </View>

      {/* Receipt — expands in place (height driven by progress). */}
      <Animated.View style={[styles.receiptWrap, receiptStyle]}>
        <PayoutReceipt release={release} legs={legs} />
      </Animated.View>

      {/* Off-screen measurer — natural receipt height for the expand animation. */}
      <View style={styles.measurer} onLayout={onMeasure} pointerEvents="none">
        <PayoutReceipt release={release} legs={legs} />
      </View>
    </Pressable>
  );
};

// ---------------------------------------------------------------------------
// Container (header + 5 states + debt banner + refund history).
// ---------------------------------------------------------------------------

export const BrandPayoutBreakdown: React.FC<BrandPayoutBreakdownProps> = ({
  brandId,
  onOpenExplainer,
}) => {
  const ledgerQuery = useBrandPayoutLedger(brandId);
  const role = useCurrentBrandRole(brandId);

  const ledger = ledgerQuery.data;
  const refunds = useMemo<PayoutLedgerAdjustmentDTO[]>(
    () => (ledger?.adjustments ?? []).filter((adj) => isRefundAdjustment(adj.kind)),
    [ledger],
  );
  const outstandingDebt = useMemo(
    () => sumOutstandingDebtByCurrency(ledger?.openDebts ?? []),
    [ledger],
  );

  const header = (
    <View style={styles.headerRow}>
      <Text style={styles.sectionLabel}>PAYOUTS</Text>
      <Pressable
        onPress={onOpenExplainer}
        accessibilityRole="button"
        accessibilityLabel="How payouts work"
        accessibilityHint="Opens an explainer about payout timing and fees"
        style={({ pressed }) => [styles.explainerLink, pressed ? styles.explainerLinkPressed : null]}
      >
        <Icon name="clock" size={14} color={accent.warm} />
        <Text style={styles.explainerLinkText}>How payouts work</Text>
      </Pressable>
    </View>
  );

  // --- state selection ---
  const isLoading = ledgerQuery.isLoading || role.isLoading;
  const belowFinance = !role.isLoading && role.rank < FINANCE_MANAGER_RANK;

  let body: React.ReactNode;
  if (isLoading) {
    body = (
      <GlassCard variant="base" padding={0}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={[styles.skeletonRow, i < 2 ? styles.rowDivider : null]}
          >
            <View style={styles.skeletonTextCol}>
              <Skeleton width="55%" height={16} radius="sm" />
              <View style={{ marginTop: spacing.xs }}>
                <Skeleton width="35%" height={12} radius="sm" />
              </View>
            </View>
            <Skeleton width={64} height={16} radius="sm" />
          </View>
        ))}
      </GlassCard>
    );
  } else if (ledgerQuery.isError) {
    body = (
      <GlassCard variant="base" padding={spacing.md} style={styles.errorCard}>
        <Text style={styles.errorTitle}>Couldn{"’"}t load your payouts</Text>
        <Text style={styles.errorBody}>Check your connection and try again.</Text>
        <View style={styles.errorBtnRow}>
          <Button
            label="Try again"
            onPress={() => {
              void ledgerQuery.refetch();
            }}
            variant="secondary"
            size="md"
          />
        </View>
      </GlassCard>
    );
  } else if (belowFinance) {
    body = (
      <GlassCard variant="base" padding={spacing.lg}>
        <View style={styles.limitedRow}>
          <View style={styles.limitedIconChip}>
            <Icon name="shield" size={20} color={textTokens.tertiary} />
          </View>
          <View style={styles.limitedTextCol}>
            <Text style={styles.emptyTitle}>Payout details are limited</Text>
            <Text style={styles.emptyBody}>
              Payout history and amounts are visible to finance managers and
              owners. Ask a brand owner if you need access.
            </Text>
          </View>
        </View>
      </GlassCard>
    );
  } else if ((ledger?.releases.length ?? 0) === 0) {
    body = (
      <GlassCard variant="base" padding={spacing.lg}>
        <Text style={styles.emptyTitle}>No payouts yet</Text>
        <Text style={styles.emptyBody}>
          Payouts appear here 3 days after your first event date ends.
        </Text>
      </GlassCard>
    );
  } else {
    const releases = ledger?.releases ?? [];
    body = (
      <GlassCard variant="base" padding={0}>
        {releases.map((release, index) => (
          <BrandPayoutReleaseRow
            key={release.id}
            release={release}
            legs={ledger?.legsByRelease[release.id] ?? []}
            divider={index < releases.length - 1}
          />
        ))}
      </GlassCard>
    );
  }

  const showDebtBanner = !isLoading && !belowFinance && outstandingDebt.length > 0;
  const debtAmount = outstandingDebt
    .map((entry) => formatCurrency(entry.cents, entry.currency, true))
    .join(" + ");

  const showRefunds = !isLoading && !belowFinance && refunds.length > 0;

  return (
    <View style={styles.container}>
      {header}

      {showDebtBanner ? (
        <GlassCard variant="base" padding={spacing.md} style={styles.debtBanner}>
          <View style={styles.debtRow}>
            <View style={styles.debtIconChip}>
              <Icon name="shield" size={20} color={semantic.warning} />
            </View>
            <View style={styles.debtTextCol}>
              <Text style={styles.debtTitle}>Balance carried forward</Text>
              <Text style={styles.debtBody}>
                {debtAmount} will come out of your next payout(s).
              </Text>
            </View>
          </View>
        </GlassCard>
      ) : null}

      {body}

      {showRefunds ? (
        <>
          <Text style={[styles.sectionLabel, styles.refundsLabel]}>
            RECENT REFUNDS
          </Text>
          <GlassCard variant="base" padding={0}>
            {refunds.map((adj, index) => {
              const sign = refundAdjustmentSign(adj.kind);
              const money = formatCurrency(adj.amountCents, adj.currency, true);
              return (
                <View
                  key={adj.id}
                  style={[
                    styles.refundRow,
                    index < refunds.length - 1 ? styles.rowDivider : null,
                  ]}
                >
                  <View style={styles.refundTextCol}>
                    <Text
                      style={sign === "+" ? styles.refundAmountCredit : styles.refundAmountDebit}
                    >
                      {`${sign}${money}`}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {refundAdjustmentLabel(adj.kind)}
                    </Text>
                  </View>
                  <Text style={styles.refundDate}>
                    {formatRelativeTime(adj.createdAt)}
                  </Text>
                </View>
              );
            })}
          </GlassCard>
        </>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },

  // Header + explainer link ------------------------------------------------
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.sm,
  },
  sectionLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: textTokens.tertiary,
  },
  refundsLabel: {
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.sm,
  },
  explainerLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 44,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.sm,
  },
  explainerLinkPressed: {
    opacity: 0.6,
  },
  explainerLinkText: {
    fontSize: typography.buttonMd.fontSize,
    lineHeight: typography.buttonMd.lineHeight,
    fontWeight: typography.buttonMd.fontWeight,
    letterSpacing: typography.buttonMd.letterSpacing,
    color: accent.warm,
  },

  // Rows -------------------------------------------------------------------
  row: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    overflow: "hidden",
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.profileBase,
  },
  rowPressed: {
    backgroundColor: glass.tint.profileElevated,
  },
  tierA: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  iconChip: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  middleCol: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  rowMeta: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: spacing.xxs,
  },
  trailingCol: {
    alignItems: "flex-end",
    gap: spacing.xxs,
  },
  rowAmount: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
  },
  tierB: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  oneLiner: {
    flex: 1,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
  },

  // Receipt ----------------------------------------------------------------
  receiptWrap: {
    overflow: "hidden",
  },
  measurer: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    top: 0,
    opacity: 0,
    zIndex: -1,
  },
  receipt: {
    marginTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileBase,
    paddingTop: spacing.sm,
  },
  line: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingVertical: spacing.xs,
    gap: spacing.md,
  },
  lineLabel: {
    flexShrink: 1,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  lineQualifier: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
  },
  lineValue: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    textAlign: "right",
  },
  lineValuePrimary: {
    color: textTokens.primary,
  },
  lineValueSecondary: {
    color: textTokens.secondary,
  },
  lineValueSuccess: {
    color: semantic.success,
  },
  lineValueConfirming: {
    color: textTokens.tertiary,
    fontStyle: "italic",
  },
  finalLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: spacing.md,
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileBase,
  },
  finalLabel: {
    flexShrink: 1,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
  },
  finalValue: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
    textAlign: "right",
  },

  // Skeleton ---------------------------------------------------------------
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  skeletonTextCol: {
    flex: 1,
    minWidth: 0,
  },

  // Error ------------------------------------------------------------------
  errorCard: {
    borderColor: "rgba(251, 191, 36, 0.35)",
    borderWidth: 1,
  },
  errorTitle: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
  },
  errorBody: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
    marginTop: spacing.xs,
  },
  errorBtnRow: {
    flexDirection: "row",
    marginTop: spacing.sm,
  },

  // Empty / limited --------------------------------------------------------
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
    marginTop: spacing.xs,
  },
  limitedRow: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  limitedIconChip: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileElevated,
  },
  limitedTextCol: {
    flex: 1,
    minWidth: 0,
  },

  // Debt banner ------------------------------------------------------------
  debtBanner: {
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.45)",
  },
  debtRow: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  debtIconChip: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: semantic.warningTint,
  },
  debtTextCol: {
    flex: 1,
    minWidth: 0,
  },
  debtTitle: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
  },
  debtBody: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
    marginTop: spacing.xxs,
  },

  // Refund rows ------------------------------------------------------------
  refundRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  refundTextCol: {
    flex: 1,
    minWidth: 0,
  },
  refundAmountDebit: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: semantic.error,
  },
  refundAmountCredit: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: semantic.success,
  },
  refundDate: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
  },
});

export default BrandPayoutBreakdown;
