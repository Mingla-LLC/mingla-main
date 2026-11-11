/**
 * #4389 F2 — the bank-country list, rendered INLINE in the full-screen setup
 * route (never inside a Sheet or Modal: the freeze was a native modal sheet
 * opened over the brand-switcher overlay, I-4389-NO-MODAL-ON-OVERLAY).
 *
 * Rows: flag · country · currency code. Search, plus "Suggested" (the device
 * region, when supported) on top. Host copy never names a payment partner.
 */
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { STRIPE_SUPPORTED_COUNTRIES } from "../../constants/stripeSupportedCountries";
import { accent, radius, spacing, text as textTokens, typography } from "../../constants/designSystem";
import { BRAND_SETUP_COPY } from "./brandSetupCopy";
// Text-only state: this list stays free of the icon (svg) runtime.
import { CenteredState } from "../ui/CenteredState";

export interface PayoutCountryOption {
  country: string;
  name: string;
  currency: string;
}

/** The one list: 34 card countries + Nigeria (parity with payout_country_rail). */
export const PAYOUT_COUNTRY_OPTIONS: readonly PayoutCountryOption[] = [
  ...STRIPE_SUPPORTED_COUNTRIES.map((c) => ({
    country: c.country,
    name: c.displayName,
    currency: c.defaultCurrency,
  })),
  // orch-strict-grep-allow stripe-country-out-of-scope — Nigeria is the Paystack rail, never Stripe Connect.
  { country: "NG", name: "Nigeria", currency: "NGN" },
].sort((a, b) => a.name.localeCompare(b.name));

export function flagEmoji(country: string): string {
  const cc = country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function payoutCountryOption(country: string | null | undefined): PayoutCountryOption | null {
  const cc = (country ?? "").trim().toUpperCase();
  return PAYOUT_COUNTRY_OPTIONS.find((o) => o.country === cc) ?? null;
}

/** The device region, when it is a country Mingla pays out to. */
export function suggestedPayoutCountry(locale: string | null | undefined): PayoutCountryOption | null {
  const region = (locale ?? "").split(/[-_]/)[1] ?? "";
  return payoutCountryOption(region);
}

export function filterPayoutCountries(query: string): readonly PayoutCountryOption[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return PAYOUT_COUNTRY_OPTIONS;
  return PAYOUT_COUNTRY_OPTIONS.filter(
    (o) => o.name.toLowerCase().includes(q) || o.country.toLowerCase() === q || o.currency.toLowerCase() === q,
  );
}

export interface PayoutCountryListProps {
  selected: string | null;
  onSelect: (country: string) => void;
  disabled?: boolean;
  deviceLocale?: string | null;
  testID?: string;
}

export const PayoutCountryList: React.FC<PayoutCountryListProps> = ({
  selected,
  onSelect,
  disabled = false,
  deviceLocale = null,
  testID = "payout-country-list",
}) => {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => filterPayoutCountries(query), [query]);
  const suggested = useMemo(() => (query.length === 0 ? suggestedPayoutCountry(deviceLocale) : null), [query, deviceLocale]);

  const renderRow = (o: PayoutCountryOption): React.ReactElement => {
    const isSel = o.country === selected;
    return (
      <Pressable
        key={o.country}
        testID={`${testID}-row-${o.country}`}
        accessibilityRole="radio"
        accessibilityState={{ checked: isSel, disabled }}
        accessibilityLabel={`${o.name}, ${o.currency}`}
        disabled={disabled}
        onPress={() => onSelect(o.country)}
        style={[styles.row, isSel && styles.rowSelected]}
      >
        <Text style={styles.flag}>{flagEmoji(o.country)}</Text>
        <Text style={styles.name} numberOfLines={2}>{o.name}</Text>
        <Text style={styles.currency}>{o.currency}</Text>
        <View style={[styles.radio, isSel && styles.radioOn]} />
      </Pressable>
    );
  };

  return (
    <View testID={testID} style={styles.root}>
      <TextInput
        testID={`${testID}-search`}
        value={query}
        onChangeText={setQuery}
        placeholder={BRAND_SETUP_COPY.f2.search}
        placeholderTextColor={textTokens.quaternary}
        accessibilityLabel={BRAND_SETUP_COPY.f2.search}
        autoCorrect={false}
        style={styles.search}
      />
      {suggested !== null ? (
        <View>
          <Text style={styles.groupLabel}>{BRAND_SETUP_COPY.f2.suggested}</Text>
          <View style={styles.group}>{renderRow(suggested)}</View>
        </View>
      ) : null}
      {rows.length === 0 ? (
        // #4389 — centred in the space under the search (CenteredState).
        <CenteredState
          fill
          title={BRAND_SETUP_COPY.f2.noMatch(query.trim())}
          body={BRAND_SETUP_COPY.f2.cantPayOut}
          testID={`${testID}-no-match`}
        />
      ) : (
        <View style={[styles.group, { marginTop: spacing.sm }]}>{rows.map(renderRow)}</View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  search: {
    minHeight: 48,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: "rgba(255,255,255,0.06)",
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
  },
  groupLabel: {
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  group: {
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.04)",
    overflow: "hidden",
  },
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  rowSelected: { backgroundColor: accent.faint },
  flag: { fontSize: 20, width: 28 },
  name: { flex: 1, fontSize: typography.body.fontSize, color: textTokens.primary },
  currency: { fontSize: typography.bodySm.fontSize, color: textTokens.tertiary },
  radio: {
    width: 20,
    height: 20,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.32)",
  },
  radioOn: { borderColor: accent.warm, backgroundColor: accent.warm },
  root: { flexGrow: 1 },
});
