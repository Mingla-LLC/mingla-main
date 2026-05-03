/**
 * BrandFinanceReportsView — finance reports surface (J-A12 §5.3.7-reports).
 *
 * Per Designer FinanceReportsScreen (design-package screens-brand.jsx
 * line 363-441). Five sections:
 *   1. TopBar (Finance · back · download IconChrome inert per W-A12-2)
 *   2. Period switcher (7d / 30d / 90d / YTD / All; default 30d)
 *   3. Headline card (net revenue + sparkline derived from filtered events)
 *   4. Breakdown (5 rows: Gross · Refunds · Mingla fee · Stripe processing · Net)
 *   5. Top events (DESC by revenueGbp, top 5)
 *   6. Exports (3 rows; per-row Toast with TRANSITIONAL B2 exit)
 *
 * Restricted brands see a red "Stripe restricted — historical only" banner
 * above the period switcher. Empty brands (no events at all OR no events
 * in selected period) see an empty-state GlassCard.
 *
 * Future-event filtering policy (W-A12-1 resolution): events with `heldAt`
 * within the period window are INCLUDED, including events scheduled into
 * the future (e.g., 30d window includes upcoming events ≤ now+15d). This
 * matches the use case where organisers forecast revenue from upcoming
 * events alongside historical.
 *
 * [TRANSITIONAL] Per-event records are a Brand-level stub array
 * (BrandEventStub). Real events ship Cycle 3 (event creator) in a
 * separate table; the stub field retires when Cycle 3 lands.
 *
 * [TRANSITIONAL] Mingla fee + Stripe processing rates are hard-coded at
 * the values the Designer FinanceReportsScreen documents (2% + £0.30
 * Mingla; 1.5% + £0.20 Stripe). Real Stripe rates land in B2 — replace
 * the constants below with brand-config or a global config table.
 *
 * Inline composition (DEC-079 closure):
 *   - Sparkline (D-INV-A12-1 watch-point — first use; promote on 3+)
 *   - SegmentedControl-style period switcher (D-INV-A12-2)
 *   - BreakdownRow / RevenueRow / ExportRow (D-INV-A12-3)
 *
 * Per J-A12 spec §3.6.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type {
  Brand,
  BrandEventStub,
  BrandRefund,
} from "../../store/currentBrandStore";
import { formatCount, formatGbp, formatGbpRound } from "../../utils/currency";

import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Toast } from "../ui/Toast";
import { TopBar } from "../ui/TopBar";

interface ToastState {
  visible: boolean;
  message: string;
}

type TimeRange = "7d" | "30d" | "90d" | "ytd" | "all";

const PERIOD_OPTIONS: TimeRange[] = ["7d", "30d", "90d", "ytd", "all"];

const PERIOD_LABEL: Record<TimeRange, string> = {
  "7d": "7d",
  "30d": "30d",
  "90d": "90d",
  ytd: "YTD",
  all: "All",
};

const PERIOD_DAYS: Record<TimeRange, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  ytd: null, // computed from Jan 1 of current year
  all: null, // no filter
};

// [TRANSITIONAL] hard-coded Stripe + Mingla fee rates — replaced when B2
// wires real Stripe config. Per Designer FinanceReportsScreen line 405-406.
const STRIPE_PERCENT = 0.015; // 1.5%
const STRIPE_FLAT_GBP = 0.20;
const MINGLA_PERCENT = 0.02; // 2%
const MINGLA_FLAT_GBP = 0.30;

interface ExportRowConfig {
  label: string;
  sub: string;
}

const EXPORT_ROWS: ExportRowConfig[] = [
  { label: "Stripe payouts CSV", sub: "For Xero / QuickBooks" },
  { label: "Tax-ready (UK VAT)", sub: "Quarterly summary" },
  { label: "All transactions", sub: "Itemised CSV" },
];

const EVENT_STATUS_LABEL: Record<BrandEventStub["status"], string> = {
  upcoming: "upcoming",
  in_progress: "in progress",
  ended: "ended",
};

const SPARKLINE_BAR_COUNT = 30;
const SPARKLINE_RECENT_BAR_COUNT = 5;

/**
 * Compute the cutoff timestamp for a period filter.
 * Returns 0 when no filter applies (all / null).
 */
const computeCutoffMs = (period: TimeRange): number => {
  if (period === "all") return 0;
  if (period === "ytd") {
    return new Date(new Date().getFullYear(), 0, 1).getTime();
  }
  const days = PERIOD_DAYS[period];
  if (days === null) return 0;
  return Date.now() - days * 24 * 60 * 60 * 1000;
};

/**
 * Generate a deterministic 30-bar sparkline from filtered events. Bar
 * heights are normalised 0..100. When events.length === 0, returns []
 * so the consumer can omit the sparkline entirely.
 *
 * Algorithm: bucket events by their position in a 30-day window keyed
 * off heldAt. Each bucket sums revenue. Heights normalised against the
 * max bucket value. Events outside the bar window cap at the last bar.
 */
const computeSparklineBars = (events: BrandEventStub[]): number[] => {
  if (events.length === 0) return [];
  const buckets = new Array(SPARKLINE_BAR_COUNT).fill(0);
  const now = Date.now();
  const windowMs = SPARKLINE_BAR_COUNT * 24 * 60 * 60 * 1000;
  const windowStart = now - windowMs;
  events.forEach((event) => {
    const eventMs = new Date(event.heldAt).getTime();
    let bucketIndex: number;
    if (eventMs <= windowStart) {
      bucketIndex = 0;
    } else if (eventMs >= now) {
      bucketIndex = SPARKLINE_BAR_COUNT - 1;
    } else {
      const offsetMs = eventMs - windowStart;
      bucketIndex = Math.min(
        SPARKLINE_BAR_COUNT - 1,
        Math.floor((offsetMs / windowMs) * SPARKLINE_BAR_COUNT),
      );
    }
    buckets[bucketIndex] += event.revenueGbp;
  });
  const maxBucket = Math.max(...buckets, 1); // avoid div-by-zero
  return buckets.map((value) => (value / maxBucket) * 100);
};

export interface BrandFinanceReportsViewProps {
  brand: Brand | null;
  onBack: () => void;
}

export const BrandFinanceReportsView: React.FC<BrandFinanceReportsViewProps> = ({
  brand,
  onBack,
}) => {
  const insets = useSafeAreaInsets();
  const [period, setPeriod] = useState<TimeRange>("30d");
  const [toast, setToast] = useState<ToastState>({ visible: false, message: "" });

  const fireToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  const handleDismissToast = useCallback((): void => {
    setToast((prev) => ({ ...prev, visible: false }));
  }, []);

  // [TRANSITIONAL] export Toast handlers — exit when B2 wires real CSV
  // download via Stripe data + native file share. Per-row Toast keeps
  // user feedback honest until then.
  const handleExportTap = useCallback(
    (label: string): void => {
      fireToast(`${label} export lands in B2.`);
    },
    [fireToast],
  );

  const filteredEvents = useMemo<BrandEventStub[]>(() => {
    if (brand === null) return [];
    const all = brand.events ?? [];
    if (period === "all") return all;
    const cutoff = computeCutoffMs(period);
    // W-A12-1 resolution: include future events with heldAt >= cutoff.
    // Past + future events both pass when cutoff < now, which lets
    // upcoming events appear in the 30d window for forecasting.
    return all.filter((e) => new Date(e.heldAt).getTime() >= cutoff);
  }, [brand, period]);

  const filteredRefunds = useMemo<BrandRefund[]>(() => {
    if (brand === null) return [];
    const all = brand.refunds ?? [];
    if (period === "all") return all;
    const cutoff = computeCutoffMs(period);
    return all.filter((r) => new Date(r.refundedAt).getTime() >= cutoff);
  }, [brand, period]);

  const grossSales = useMemo<number>(
    () => filteredEvents.reduce((sum, e) => sum + e.revenueGbp, 0),
    [filteredEvents],
  );
  const totalRefunds = useMemo<number>(
    () => filteredRefunds.reduce((sum, r) => sum + r.amountGbp, 0),
    [filteredRefunds],
  );
  const eventCount = useMemo<number>(
    () => filteredEvents.filter((e) => e.revenueGbp > 0).length,
    [filteredEvents],
  );
  const minglaFee = grossSales * MINGLA_PERCENT + eventCount * MINGLA_FLAT_GBP;
  const stripeFee = grossSales * STRIPE_PERCENT + eventCount * STRIPE_FLAT_GBP;
  const netToBank = grossSales - totalRefunds - minglaFee - stripeFee;

  const topEvents = useMemo<BrandEventStub[]>(
    () =>
      [...filteredEvents]
        .sort((a, b) => b.revenueGbp - a.revenueGbp)
        .slice(0, 5),
    [filteredEvents],
  );

  const sparklineBars = useMemo<number[]>(
    () => computeSparklineBars(filteredEvents),
    [filteredEvents],
  );

  // ----- Not-found state -----
  if (brand === null) {
    return (
      <View style={styles.host}>
        <View style={styles.barWrap}>
          <TopBar
            leftKind="back"
            title="Finance"
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

  const isRestricted = brand.stripeStatus === "restricted";
  const totalEvents = (brand.events ?? []).length;
  const showEmptyState = filteredEvents.length === 0;
  const emptyTitle =
    totalEvents === 0 ? "No data yet" : "No data in this period";
  const emptyBody =
    totalEvents === 0
      ? "Finance reports populate after your first event sells tickets."
      : "Try a different time range.";

  return (
    <View style={styles.host}>
      <View style={styles.barWrap}>
        <TopBar
          leftKind="back"
          title="Finance"
          onBack={onBack}
          rightSlot={
            // W-A12-2: download icon inert (no Pressable wrapper) per
            // Constitution #1 — Pressable disabled still announces as
            // button to screen readers. Decorative until B2 wires
            // quick-export. Exports section below IS the export
            // affordance.
            <View
              accessibilityRole="image"
              accessibilityLabel="Finance reports"
              style={styles.downloadIconWrap}
            >
              <Icon name="download" size={20} color={textTokens.primary} />
            </View>
          }
        />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: spacing.xl + Math.max(insets.bottom, spacing.md) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Restricted banner (above period switcher) */}
        {isRestricted ? (
          <GlassCard
            variant="base"
            padding={spacing.md}
            style={styles.restrictedBanner}
          >
            <View style={styles.bannerRow}>
              <View style={styles.bannerIconWrap}>
                <Icon name="flag" size={20} color={semantic.error} />
              </View>
              <View style={styles.bannerTextCol}>
                <Text style={styles.bannerTitle}>
                  Stripe restricted — historical only
                </Text>
                <Text style={styles.bannerSub}>
                  Resolve the restriction in payments to see live data.
                </Text>
              </View>
            </View>
          </GlassCard>
        ) : null}

        {/* Period switcher */}
        <View style={styles.periodRow}>
          {PERIOD_OPTIONS.map((p) => {
            const isSelected = p === period;
            return (
              <Pressable
                key={p}
                onPress={() => setPeriod(p)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`Period ${PERIOD_LABEL[p]}`}
                style={[
                  styles.periodBtn,
                  isSelected && styles.periodBtnSelected,
                ]}
              >
                <Text
                  style={[
                    styles.periodLabel,
                    isSelected && styles.periodLabelSelected,
                  ]}
                >
                  {PERIOD_LABEL[p]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {showEmptyState ? (
          // Empty state: render only this card; no headline / breakdown / top events.
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.emptyTitle}>{emptyTitle}</Text>
            <Text style={styles.emptyBody}>{emptyBody}</Text>
          </GlassCard>
        ) : (
          <>
            {/* Headline */}
            <GlassCard variant="elevated" padding={spacing.lg}>
              <Text style={styles.headlineLabel}>
                {`Net revenue · ${PERIOD_LABEL[period]}`}
              </Text>
              <Text style={styles.headlineValue}>{formatGbpRound(netToBank)}</Text>
              {sparklineBars.length > 0 ? (
                <View style={styles.sparklineRow}>
                  {sparklineBars.map((heightPct, i) => {
                    const isRecent =
                      i >= sparklineBars.length - SPARKLINE_RECENT_BAR_COUNT;
                    return (
                      <View
                        key={i}
                        style={[
                          styles.sparklineBar,
                          {
                            height: `${Math.max(heightPct, 4)}%`,
                            backgroundColor: isRecent
                              ? accent.warm
                              : "rgba(255,255,255,0.16)",
                          },
                        ]}
                      />
                    );
                  })}
                </View>
              ) : null}
            </GlassCard>

            {/* Breakdown */}
            <GlassCard variant="base" padding={spacing.md}>
              <BreakdownRow label="Gross sales" value={formatGbp(grossSales)} />
              <BreakdownRow
                label="Refunds"
                value={`−${formatGbp(totalRefunds)}`}
              />
              <BreakdownRow
                label="Mingla fee (2% + £0.30)"
                value={`−${formatGbp(minglaFee)}`}
              />
              <BreakdownRow
                label="Stripe processing"
                value={`−${formatGbp(stripeFee)}`}
              />
              <BreakdownRow label="Net to bank" value={formatGbp(netToBank)} last />
            </GlassCard>

            {/* Top events */}
            <Text style={styles.sectionLabel}>
              {`TOP EVENTS · ${PERIOD_LABEL[period]}`}
            </Text>
            <GlassCard variant="base" padding={0}>
              {/* [TRANSITIONAL] inert rows — B2 wires per-event detail screens. */}
              {topEvents.map((event, index) => {
                const isLast = index === topEvents.length - 1;
                const subText =
                  event.contextLabel ?? EVENT_STATUS_LABEL[event.status];
                return (
                  <View
                    key={event.id}
                    style={[
                      styles.eventRow,
                      !isLast && styles.eventRowDivider,
                    ]}
                  >
                    <View style={styles.eventLeftCol}>
                      <Text style={styles.eventTitle} numberOfLines={1}>
                        {event.title}
                      </Text>
                      <Text style={styles.eventSub} numberOfLines={1}>
                        {`${formatCount(event.soldCount)} sold · ${subText}`}
                      </Text>
                    </View>
                    <Text style={styles.eventAmount}>
                      {formatGbpRound(event.revenueGbp)}
                    </Text>
                  </View>
                );
              })}
            </GlassCard>
          </>
        )}

        {/* Exports — always rendered (even on empty state) */}
        <Text style={styles.sectionLabel}>EXPORTS</Text>
        <GlassCard variant="base" padding={0}>
          {EXPORT_ROWS.map((row, index) => {
            const isLast = index === EXPORT_ROWS.length - 1;
            return (
              <Pressable
                key={row.label}
                onPress={() => handleExportTap(row.label)}
                accessibilityRole="button"
                accessibilityLabel={`Export ${row.label}`}
                style={[
                  styles.exportRow,
                  !isLast && styles.exportRowDivider,
                ]}
              >
                <View style={styles.exportIconWrap}>
                  <Icon name="receipt" size={18} color={textTokens.primary} />
                </View>
                <View style={styles.exportTextCol}>
                  <Text style={styles.exportLabel}>{row.label}</Text>
                  <Text style={styles.exportSub}>{row.sub}</Text>
                </View>
                <Icon name="chevR" size={16} color={textTokens.tertiary} />
              </Pressable>
            );
          })}
        </GlassCard>
      </ScrollView>

      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={handleDismissToast}
        />
      </View>
    </View>
  );
};

// ---------------------------------------------------------------------------
// BreakdownRow — inline component for the 5-row breakdown table.
// D-INV-A12-3 watch-point — promote to kit BreakdownTable on 3+ uses.
// ---------------------------------------------------------------------------
interface BreakdownRowProps {
  label: string;
  value: string;
  last?: boolean;
}

const BreakdownRow: React.FC<BreakdownRowProps> = ({ label, value, last = false }) => (
  <View
    style={[
      breakdownStyles.row,
      last && breakdownStyles.rowLast,
    ]}
  >
    <Text style={[breakdownStyles.label, last && breakdownStyles.labelLast]}>
      {label}
    </Text>
    <Text style={[breakdownStyles.value, last && breakdownStyles.valueLast]}>
      {value}
    </Text>
  </View>
);

const breakdownStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
  },
  rowLast: {
    paddingTop: spacing.md,
    marginTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileBase,
  },
  label: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  labelLast: {
    color: textTokens.primary,
    fontWeight: "600",
  },
  value: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
    fontWeight: "500",
  },
  valueLast: {
    fontSize: typography.bodyLg.fontSize,
    lineHeight: typography.bodyLg.lineHeight,
    fontWeight: "700",
  },
});

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

  // Download icon (inert per W-A12-2) -----------------------------------
  downloadIconWrap: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },

  // Restricted banner ----------------------------------------------------
  restrictedBanner: {
    borderColor: "rgba(239, 68, 68, 0.45)",
    borderWidth: 1,
  },
  bannerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  bannerIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: semantic.errorTint,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.45)",
    alignItems: "center",
    justifyContent: "center",
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

  // Period switcher (D-INV-A12-2 watch-point — first use) ---------------
  periodRow: {
    flexDirection: "row",
    gap: 6,
  },
  periodBtn: {
    flex: 1,
    height: 36,
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  periodBtnSelected: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  periodLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  periodLabelSelected: {
    color: textTokens.primary,
  },

  // Headline (D-INV-A12-1 watch-point — first sparkline use) ------------
  headlineLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: textTokens.tertiary,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  headlineValue: {
    fontSize: typography.statValue.fontSize,
    lineHeight: typography.statValue.lineHeight,
    fontWeight: typography.statValue.fontWeight,
    letterSpacing: typography.statValue.letterSpacing,
    color: textTokens.primary,
  },
  sparklineRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 4,
    height: 56,
    marginTop: spacing.md,
  },
  sparklineBar: {
    flex: 1,
    borderRadius: 2,
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

  // Top event rows (visually inert) -------------------------------------
  eventRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  eventRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.profileBase,
  },
  eventLeftCol: {
    flex: 1,
    minWidth: 0,
  },
  eventTitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "500",
    color: textTokens.primary,
  },
  eventSub: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  eventAmount: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
  },

  // Export rows ----------------------------------------------------------
  exportRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  exportRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.profileBase,
  },
  exportIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radiusTokens.md,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    alignItems: "center",
    justifyContent: "center",
  },
  exportTextCol: {
    flex: 1,
    minWidth: 0,
  },
  exportLabel: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "500",
    color: textTokens.primary,
  },
  exportSub: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: 2,
  },

  // Toast ----------------------------------------------------------------
  toastWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: spacing.xl,
    paddingHorizontal: spacing.md,
  },
});

export default BrandFinanceReportsView;
