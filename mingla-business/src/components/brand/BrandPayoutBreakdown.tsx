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
  color,
  durations,
  radius,
  space,
  type,
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
      return { bg: color.successTint, fg: color.success };
    case "warn":
      return { bg: color.warningTint, fg: color.warning };
    case "error":
      return { bg: color.errorTint, fg: color.errorText };
    case "draft":
      return { bg: color.fill.tile, fg: color.text3 };
    case "info":
    default:
      return { bg: color.infoTint, fg: color.info };
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
    releasableAt: release.releasableAt,
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
          <Icon name="chevD" size={16} color={color.text3} />
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
        <Icon name="clock" size={14} color={color.text1} />
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
              <View style={{ marginTop: space[1] }}>
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
      <GlassCard variant="base" padding={space[4]} style={styles.errorCard}>
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
      <GlassCard variant="base" padding={space[6]}>
        <View style={styles.limitedRow}>
          <View style={styles.limitedIconChip}>
            <Icon name="shield" size={20} color={color.text3} />
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
      <GlassCard variant="base" padding={space[6]}>
        <Text style={styles.emptyTitle}>No payouts yet</Text>
        <Text style={styles.emptyBody}>
          Payouts appear here about a day after each payment.
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
        <GlassCard variant="base" padding={space[4]} style={styles.debtBanner}>
          <View style={styles.debtRow}>
            <View style={styles.debtIconChip}>
              <Icon name="shield" size={20} color={color.warning} />
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
    gap: space[4],
  },

  // Header + explainer link ------------------------------------------------
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space[1],
    paddingTop: space[2],
  },
  sectionLabel: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: color.text3,
  },
  refundsLabel: {
    paddingHorizontal: space[1],
    paddingTop: space[2],
  },
  explainerLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    minHeight: 44,
    paddingVertical: space[2],
    paddingLeft: space[2],
  },
  explainerLinkPressed: {
    opacity: 0.6,
  },
  explainerLinkText: {
    fontSize: type.btnSm.fontSize,
    lineHeight: type.btnSm.lineHeight,
    fontWeight: type.btnSm.fontWeight,
    letterSpacing: type.btnSm.letterSpacing,
    color: color.text1,
  },

  // Rows -------------------------------------------------------------------
  row: {
    paddingHorizontal: space[4],
    paddingVertical: space[4],
    overflow: "hidden",
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  rowPressed: {
    backgroundColor: color.fill.tile,
  },
  tierA: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[2],
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
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    fontWeight: "600",
    color: color.text1,
  },
  rowMeta: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text3,
    marginTop: space[1],
  },
  trailingCol: {
    alignItems: "flex-end",
    gap: space[1],
  },
  rowAmount: {
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    fontWeight: "700",
    color: color.text1,
  },
  tierB: {
    marginTop: space[2],
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
  },
  oneLiner: {
    flex: 1,
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text3,
  },

  // Receipt ----------------------------------------------------------------
  receiptWrap: {
    overflow: "hidden",
  },
  measurer: {
    position: "absolute",
    left: space[4],
    right: space[4],
    top: 0,
    opacity: 0,
    zIndex: -1,
  },
  receipt: {
    marginTop: space[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
    paddingTop: space[2],
  },
  line: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingVertical: space[1],
    gap: space[4],
  },
  lineLabel: {
    flexShrink: 1,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: color.text2,
  },
  lineQualifier: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text3,
  },
  lineValue: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    textAlign: "right",
  },
  lineValuePrimary: {
    color: color.text1,
  },
  lineValueSecondary: {
    color: color.text2,
  },
  lineValueSuccess: {
    color: color.success,
  },
  lineValueConfirming: {
    color: color.text3,
    fontStyle: "italic",
  },
  finalLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: space[4],
    marginTop: space[1],
    paddingTop: space[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
  },
  finalLabel: {
    flexShrink: 1,
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    fontWeight: "700",
    color: color.text1,
  },
  finalValue: {
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    fontWeight: "700",
    color: color.text1,
    textAlign: "right",
  },

  // Skeleton ---------------------------------------------------------------
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[4],
    paddingHorizontal: space[4],
    paddingVertical: space[4],
  },
  skeletonTextCol: {
    flex: 1,
    minWidth: 0,
  },

  // Error ------------------------------------------------------------------
  errorCard: {
    borderColor: color.line,
    borderWidth: 1,
  },
  errorTitle: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    fontWeight: "700",
    color: color.text1,
  },
  errorBody: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text2,
    marginTop: space[1],
  },
  errorBtnRow: {
    flexDirection: "row",
    marginTop: space[2],
  },

  // Empty / limited --------------------------------------------------------
  emptyTitle: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    color: color.text1,
  },
  emptyBody: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: color.text2,
    marginTop: space[1],
  },
  limitedRow: {
    flexDirection: "row",
    gap: space[2],
    alignItems: "flex-start",
  },
  limitedIconChip: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.fill.tile,
  },
  limitedTextCol: {
    flex: 1,
    minWidth: 0,
  },

  // Debt banner ------------------------------------------------------------
  debtBanner: {
    borderWidth: 1,
    borderColor: color.line,
  },
  debtRow: {
    flexDirection: "row",
    gap: space[2],
    alignItems: "flex-start",
  },
  debtIconChip: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.warningTint,
  },
  debtTextCol: {
    flex: 1,
    minWidth: 0,
  },
  debtTitle: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    fontWeight: "700",
    color: color.text1,
  },
  debtBody: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text2,
    marginTop: space[1],
  },

  // Refund rows ------------------------------------------------------------
  refundRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
    paddingHorizontal: space[4],
    paddingVertical: space[4],
  },
  refundTextCol: {
    flex: 1,
    minWidth: 0,
  },
  refundAmountDebit: {
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    fontWeight: "600",
    color: color.errorText,
  },
  refundAmountCredit: {
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    fontWeight: "600",
    color: color.success,
  },
  refundDate: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text3,
  },
});

export default BrandPayoutBreakdown;
