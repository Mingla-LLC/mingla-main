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

import {
  color,
  radius,
  space,
  type,
} from "../../constants/designSystem";
import { BRAND_SETUP_COPY } from "./brandSetupCopy";
// Text-only state: this list stays free of the icon (svg) runtime.
import { CenteredState } from "../ui/CenteredState";

export {
  PAYOUT_COUNTRY_OPTIONS,
  filterPayoutCountries,
  flagEmoji,
  payoutCountryOption,
  suggestedPayoutCountry,
  type PayoutCountryOption,
} from "./payoutCountryOptions";
import {
  filterPayoutCountries,
  flagEmoji,
  suggestedPayoutCountry,
  type PayoutCountryOption,
} from "./payoutCountryOptions";

export interface PayoutCountryListProps {
  selected: string | null;
  onSelect: (country: string) => void;
  disabled?: boolean;
  deviceLocale?: string | null;
  testID?: string;
  /** #4389 — the selected row's view, so the screen can scroll it into view. */
  selectedRowRef?: React.Ref<View>;
}

export const PayoutCountryList: React.FC<PayoutCountryListProps> = ({
  selected,
  onSelect,
  disabled = false,
  deviceLocale = null,
  testID = "payout-country-list",
  selectedRowRef,
}) => {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => filterPayoutCountries(query), [query]);
  const suggested = useMemo(() => (query.length === 0 ? suggestedPayoutCountry(deviceLocale) : null), [query, deviceLocale]);

  const renderRow = (o: PayoutCountryOption): React.ReactElement => {
    const isSel = o.country === selected;
    return (
      <Pressable
        key={o.country}
        ref={isSel ? selectedRowRef : undefined}
        testID={`${testID}-row-${o.country}`}
        accessibilityRole="radio"
        accessibilityState={{ checked: isSel, disabled }}
        accessibilityLabel={`${o.name}, ${o.currency}`}
        disabled={disabled}
        onPress={() => onSelect(o.country)}
        // #4579 retest P3-4 — read-only (not the owner, or locked): the other
        // rows are dimmed so a tap that does nothing is expected; the current
        // country stays at full strength.
        style={[styles.row, isSel && styles.rowSelected, disabled && !isSel && styles.rowDisabled]}
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
        placeholderTextColor={color.text4}
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
        <View style={[styles.group, { marginTop: space[2] }]}>{rows.map(renderRow)}</View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  search: {
    minHeight: 48,
    borderRadius: radius.sm,
    paddingHorizontal: space[4],
    backgroundColor: color.fill.tile,
    color: color.text1,
    fontSize: type.body.fontSize,
  },
  groupLabel: {
    marginTop: space[4],
    marginBottom: space[1],
    fontSize: type.caption.fontSize,
    color: color.text3,
  },
  group: {
    borderRadius: radius.sm,
    backgroundColor: color.fill.inset,
    overflow: "hidden",
  },
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space[4],
    gap: space[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  rowSelected: { backgroundColor: color.fill.tabOn },
  rowDisabled: { opacity: 0.45 },
  flag: { fontSize: 20, width: 28 },
  name: { flex: 1, fontSize: type.body.fontSize, color: color.text1 },
  currency: { fontSize: type.small.fontSize, color: color.text3 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: color.lineStrong,
  },
  radioOn: { borderColor: color.paper, backgroundColor: color.paper },
  root: { flexGrow: 1 },
});
