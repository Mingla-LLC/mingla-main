/**
 * #4522 — the body of "What you earn" (see `TripEarningsCard`, which loads it). Every number comes from
 * `pricingPreview.ts` (`computePreview` / `feeFromBps`) with the brand's real
 * take rate (`takeRateBpsOverride ?? DEFAULT_TAKE_RATE_BPS`) and the 3% service
 * fee, fed the same switches the "Who covers costs" card shows. No processing
 * fee row: Mingla pays processing out of its own fee. When the brand's rate
 * cannot be read the fee rows read "--" and the card says why; nothing is made up.
 */

import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, space, type } from "../../constants/designSystem";
import { DEFAULT_TAKE_RATE_BPS } from "../../constants/pricing";
import { useBrandTaxRegistration } from "../../hooks/useBrandTaxRegistration";
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
import { resolveSwitches } from "../../services/pricingSwitchesService";
import { formatCurrency } from "../../utils/currency";
import { configuredVatRateBps } from "../../utils/pricingTaxContext";
import { GlassCard } from "../ui/GlassCard";
import { computeEarningsRows, earningsAtFullCapacity } from "./tripEarnings";
import type { Step4Draft } from "./TripCreatorStep4Pricing";

export const EARNINGS_LOADING_COPY =
  "We'll show your earnings once your payout settings load.";

export interface TripEarningsCardProps {
  draft: Pick<Step4Draft, "packages" | "currency" | "pricingSwitches">;
}

const minorOf = (priceMajor: string): number =>
  Math.round((parseFloat(priceMajor) || 0) * 100);

export const TripEarningsCardBody: React.FC<TripEarningsCardProps> = ({ draft }) => {
  const brand = useCurrentBrand();
  const taxRegistration = useBrandTaxRegistration(brand?.id ?? null);

  const model = useMemo(() => {
    const priced = draft.packages
      .map((p) => ({ priceMinor: minorOf(p.priceMajor), spots: p.capacity }))
      .filter((p) => p.priceMinor > 0);
    if (priced.length === 0) return { kind: "empty" as const };
    if (brand === null) return { kind: "loading" as const };
    const resolved = resolveSwitches(draft.pricingSwitches, {
      passTax: brand.defaultPassTax ?? false,
      passMinglaFee: brand.defaultPassMinglaFee ?? false,
      passServiceFee: brand.defaultPassServiceFee ?? false,
    });
    const vatRateBps = configuredVatRateBps({
      paymentProvider: brand.paymentProvider,
      paymentCountry: brand.paymentCountry,
    });
    const vatUnavailable = vatRateBps === null && taxRegistration.data?.hasActiveRegistration !== true;
    const base = {
      takeRateBps: brand.takeRateBpsOverride ?? DEFAULT_TAKE_RATE_BPS,
      switches: {
        passTax: vatUnavailable ? false : resolved.passTax,
        passMinglaFee: resolved.passMinglaFee,
        passServiceFee: resolved.passServiceFee,
      },
      vatRateBps,
    };
    const from = Math.min(...priced.map((p) => p.priceMinor));
    return {
      kind: "ready" as const,
      rows: computeEarningsRows({ ...base, priceMinor: from }),
      full: earningsAtFullCapacity(priced, base),
      multiple: priced.length > 1,
    };
  }, [draft.packages, draft.pricingSwitches, brand, taxRegistration.data?.hasActiveRegistration]);

  const money = (minor: number): string => formatCurrency(minor, draft.currency, true);

  return (
    <GlassCard variant="base" padding={space[4]} radius="lg" testID="trip-earnings-card">
      <Text accessibilityRole="header" style={styles.title}>
        What you earn
      </Text>
      {model.kind === "empty" ? (
        <Text style={styles.note}>Add a package price to see what you earn.</Text>
      ) : model.kind === "loading" || model.rows === null ? (
        <>
          <Row label="Price" value="--" />
          <Row label="Mingla fee" value="--" />
          <Row label="You receive per traveler" value="--" strong />
          <Text style={styles.note} testID="trip-earnings-loading">
            {EARNINGS_LOADING_COPY}
          </Text>
        </>
      ) : (
        <>
          <Row label={model.multiple ? "Price (from)" : "Price"} value={money(model.rows.priceMinor)} />
          <Row
            label={model.rows.feePassedMinor > 0 && model.rows.feeMinor === 0 ? "Mingla fee (paid by the buyer)" : "Mingla fee"}
            value={model.rows.feeMinor > 0 ? `− ${money(model.rows.feeMinor)}` : money(0)}
          />
          {model.rows.vatMinor !== null ? (
            <Row label="VAT" value={money(model.rows.vatMinor)} />
          ) : null}
          <Row label="You receive per traveler" value={money(model.rows.receiveMinor)} strong />
          {model.full !== null ? (
            <Row
              label={`At ${model.full.spots} travelers`}
              value={money(model.full.receiveMinor)}
              testID="trip-earnings-at-spots"
            />
          ) : null}
        </>
      )}
    </GlassCard>
  );
};

const Row: React.FC<{ label: string; value: string; strong?: boolean; testID?: string }> = ({
  label,
  value,
  strong = false,
  testID,
}) => (
  <View style={styles.row} testID={testID}>
    <Text style={[styles.label, strong ? styles.strong : null]}>{label}</Text>
    <Text style={[styles.value, strong ? styles.strong : null]}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  title: {
    fontSize: type.h2.fontSize,
    lineHeight: type.h2.lineHeight,
    fontWeight: "600",
    color: color.text1,
    marginBottom: space[2],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 36,
    gap: space[3],
  },
  label: { flex: 1, fontSize: type.body.fontSize, lineHeight: type.body.lineHeight, color: color.text2 },
  value: { fontSize: type.body.fontSize, lineHeight: type.body.lineHeight, color: color.text1 },
  strong: { fontWeight: "600", color: color.text1 },
  note: {
    marginTop: space[2],
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: color.text2,
  },
});
