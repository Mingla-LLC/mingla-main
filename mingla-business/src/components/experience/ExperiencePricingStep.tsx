/**
 * META-ORCH-1059 [experiences-business-parity] · SUB-A · LAYER 5
 * Step 4 — PRICING (whole-experience vs per-stop).
 *
 * Authoritative design: DESIGN_META-ORCH-1059_WIZARD_STOPS_PRICING.md §4.
 * A two-mode toggle: "One price for the whole experience" vs "Price each stop."
 * The buyer ALWAYS buys the whole itinerary → exactly ONE sellable ticket
 * (I-1). Per-stop prices are an itemised breakdown, never separate SKUs.
 * Per-stop price for stop i is the SAME field the Stops step edits (one source).
 * A persistent SoldAsOneSummary makes the single-ticket truth unmissable.
 * WhoCoversCostsSection (the 3 pass/absorb switches) is kept VERBATIM.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import { WhoCoversCostsSection } from "../pricing/WhoCoversCostsSection";
import { DEFAULT_TAKE_RATE_BPS } from "../../constants/pricing";
import type { PricingSwitchOverrides } from "../../services/pricingSwitchesService";
import type {
  ExperiencePricingMode,
  ExperienceStopDraft,
} from "./experienceWizardTypes";

export interface ExperiencePricingStepProps {
  currencySymbol: string;
  currency: string;
  pricingMode: ExperiencePricingMode;
  setPricingMode: (m: ExperiencePricingMode) => void;
  stops: ExperienceStopDraft[];
  setStops: React.Dispatch<React.SetStateAction<ExperienceStopDraft[]>>;
  wholePriceMajor: string;
  setWholePriceMajor: (v: string) => void;
  isFree: boolean;
  setIsFree: (v: boolean) => void;
  capacity: string;
  setCapacity: (v: string) => void;
  unlimited: boolean;
  setUnlimited: (v: boolean) => void;
  pricingSwitches: PricingSwitchOverrides;
  setPricingSwitches: (s: PricingSwitchOverrides) => void;
  brandDefaults: {
    passTax: boolean;
    passMinglaFee: boolean;
    passServiceFee: boolean;
  };
  takeRateBps: number;
  vatRegistered: boolean;
  onEditDefaults: () => void;
  onSetupVat: () => void;
  showErrors: boolean;
}

const num = (s: string): number => {
  const v = parseFloat(s);
  return Number.isFinite(v) && v >= 0 ? v : 0;
};

export const ExperiencePricingStep: React.FC<ExperiencePricingStepProps> = ({
  currencySymbol,
  currency,
  pricingMode,
  setPricingMode,
  stops,
  setStops,
  wholePriceMajor,
  setWholePriceMajor,
  isFree,
  setIsFree,
  capacity,
  setCapacity,
  unlimited,
  setUnlimited,
  pricingSwitches,
  setPricingSwitches,
  brandDefaults,
  takeRateBps,
  vatRegistered,
  onEditDefaults,
  onSetupVat,
  showErrors,
}) => {
  const n = stops.length;

  const resolvedTotalMajor = isFree
    ? 0
    : pricingMode === "whole"
      ? num(wholePriceMajor)
      : stops.reduce((sum, s) => sum + num(s.priceMajor), 0);

  const updateStopPrice = (i: number, v: string): void => {
    setStops((prev) => prev.map((s, idx) => (idx === i ? { ...s, priceMajor: v } : s)));
  };

  const summaryCopy = (): string => {
    const t = `${currencySymbol}${resolvedTotalMajor.toFixed(2)}`;
    if (isFree || resolvedTotalMajor === 0) {
      return `Free for buyers — they get all ${n} stops in one booking.`;
    }
    if (pricingMode === "whole") {
      return `Buyers pay ${t} for all ${n} stops — one booking, the whole itinerary.`;
    }
    return `Stops add up to ${t}. Buyers pay it once — one booking, the whole itinerary. They can't buy stops separately.`;
  };

  return (
    <View style={styles.stepBody}>
      <Text style={styles.title}>Pricing</Text>

      {/* PRICING MODE toggle */}
      <View style={styles.modeToggle} accessibilityRole="tablist">
        <Pressable
          onPress={() => setPricingMode("whole")}
          accessibilityRole="tab"
          accessibilityState={{ selected: pricingMode === "whole" }}
          accessibilityLabel="One price for the whole experience"
          style={[styles.modeSeg, pricingMode === "whole" && styles.modeSegActive]}
        >
          <Text style={[styles.modeSegText, pricingMode === "whole" && styles.modeSegTextActive]}>
            One price for the whole experience
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setPricingMode("per_stop")}
          accessibilityRole="tab"
          accessibilityState={{ selected: pricingMode === "per_stop" }}
          accessibilityLabel="Price each stop"
          style={[styles.modeSeg, pricingMode === "per_stop" && styles.modeSegActive]}
        >
          <Text style={[styles.modeSegText, pricingMode === "per_stop" && styles.modeSegTextActive]}>
            Price each stop
          </Text>
        </Pressable>
      </View>

      {/* MODE A — whole experience */}
      {pricingMode === "whole" ? (
        <>
          <ToggleRow
            label="This experience is free"
            value={isFree}
            onToggle={() => setIsFree(!isFree)}
          />
          {!isFree ? (
            <>
              <Text style={styles.fieldLabel}>Price</Text>
              <Input
                variant="number"
                value={wholePriceMajor}
                onChangeText={setWholePriceMajor}
                placeholder="0.00"
                accessibilityLabel="Whole experience price"
                leadingIcon="ticket"
              />
              {showErrors && num(wholePriceMajor) <= 0 ? (
                <Text style={styles.inlineError}>Set a price, or mark the experience free.</Text>
              ) : null}
            </>
          ) : null}
        </>
      ) : (
        /* MODE B — per-stop */
        <>
          <Text style={styles.sectionLabel}>PER-STOP PRICES</Text>
          {stops.map((s, i) => (
            <View key={s.clientId} style={styles.perStopRow}>
              <View style={styles.miniBadge}>
                <Text style={styles.miniBadgeText}>{i + 1}</Text>
              </View>
              <Text style={styles.perStopName} numberOfLines={1}>
                {s.placeName.trim().length > 0 ? s.placeName : `Stop ${i + 1}`}
              </Text>
              <View style={styles.perStopPrice}>
                <Input
                  variant="number"
                  value={s.priceMajor}
                  onChangeText={(v) => updateStopPrice(i, v)}
                  placeholder="0.00"
                  accessibilityLabel={`Price for stop ${i + 1}`}
                />
              </View>
            </View>
          ))}
          <View style={styles.divider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{`${currencySymbol}${resolvedTotalMajor.toFixed(2)}`}</Text>
          </View>
        </>
      )}

      {/* Capacity (both modes) */}
      <ToggleRow
        label="Unlimited spots"
        value={unlimited}
        onToggle={() => setUnlimited(!unlimited)}
      />
      {!unlimited ? (
        <>
          <Text style={styles.fieldLabel}>Total spots</Text>
          <Input
            variant="number"
            value={capacity}
            onChangeText={setCapacity}
            placeholder="20"
            accessibilityLabel="Total spots available"
          />
          {showErrors && (parseInt(capacity, 10) || 0) <= 0 ? (
            <Text style={styles.inlineError}>
              Enter how many spots are available, or choose Unlimited.
            </Text>
          ) : null}
        </>
      ) : null}

      {/* SoldAsOneSummary — the single-ticket anchor */}
      <View style={styles.summaryCard}>
        <Icon name="ticket" size={18} color={accent.warm} />
        <Text style={styles.summaryText}>{summaryCopy()}</Text>
      </View>

      {/* WhoCoversCostsSection — VERBATIM (total-aware previewBaseCents) */}
      <WhoCoversCostsSection
        format="experience"
        overrides={pricingSwitches}
        defaults={brandDefaults}
        onChange={setPricingSwitches}
        previewBaseCents={Math.round(resolvedTotalMajor * 100)}
        currency={currency}
        effectiveTakeRateBps={takeRateBps}
        onEditDefaults={onEditDefaults}
        vatRegistered={vatRegistered}
        onSetupVat={onSetupVat}
      />
    </View>
  );
};

interface ToggleRowProps {
  label: string;
  value: boolean;
  onToggle: () => void;
}

const ToggleRow: React.FC<ToggleRowProps> = ({ label, value, onToggle }) => (
  <Pressable
    onPress={onToggle}
    accessibilityRole="switch"
    accessibilityState={{ checked: value }}
    accessibilityLabel={label}
    style={styles.toggleRow}
  >
    <Text style={styles.toggleLabel}>{label}</Text>
    <View style={[styles.toggleTrack, value && styles.toggleTrackOn]}>
      <View style={[styles.toggleThumb, value && styles.toggleThumbOn]} />
    </View>
  </Pressable>
);

const styles = StyleSheet.create({
  stepBody: { gap: spacing.md },
  title: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    color: textTokens.primary,
  },
  modeToggle: {
    flexDirection: "row",
    gap: spacing.xs,
    backgroundColor: glass.tint.profileBase,
    borderRadius: radius.md,
    padding: spacing.xxs,
  },
  modeSeg: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
  },
  modeSegActive: {
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  modeSegText: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: textTokens.secondary,
    textAlign: "center",
  },
  modeSegTextActive: { color: textTokens.primary },
  fieldLabel: {
    fontSize: typography.caption.fontSize,
    fontWeight: "500",
    color: textTokens.secondary,
  },
  sectionLabel: {
    fontSize: typography.labelCap.fontSize,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
    color: textTokens.tertiary,
  },
  perStopRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  miniBadge: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
    alignItems: "center",
    justifyContent: "center",
  },
  miniBadgeText: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
  perStopName: { flex: 1, fontSize: typography.body.fontSize, color: textTokens.primary },
  perStopPrice: { width: 120 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: glass.border.profileBase,
  },
  totalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  totalLabel: { fontSize: typography.body.fontSize, color: textTokens.secondary },
  totalValue: {
    fontSize: typography.h3.fontSize,
    fontWeight: typography.h3.fontWeight,
    color: accent.warm,
  },
  toggleRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  toggleLabel: { flex: 1, fontSize: typography.body.fontSize, color: textTokens.primary },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: radius.full,
    backgroundColor: glass.tint.profileElevated,
    padding: 3,
    justifyContent: "center",
  },
  toggleTrackOn: { backgroundColor: accent.warm },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: radius.full,
    backgroundColor: textTokens.inverse,
  },
  toggleThumbOn: { alignSelf: "flex-end" },
  summaryCard: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  summaryText: {
    flex: 1,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.primary,
  },
  inlineError: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
    marginTop: spacing.xxs,
  },
});

export default ExperiencePricingStep;
