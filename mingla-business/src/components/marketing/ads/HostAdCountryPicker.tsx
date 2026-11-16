/**
 * #4238 — choose where a Host ad runs by country name and flag.
 *
 * Reuses the shared `@mingla/phone-input` country picker with dial codes
 * hidden. Native opens it as a full-screen modal; web uses the in-place
 * overlay, the same split PhoneField uses.
 */

import React, { useCallback, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import {
  CountryPickerModal,
  CountryPickerOverlay,
  resolvePickerPresentation,
  type PhoneInputIconName,
} from "@mingla/phone-input";

import { color, radius, space, type } from "../../../constants/designSystem";
import { BUSINESS_SHEET_PHONE_THEME } from "../../ui/PhoneField";
import { Icon } from "../../ui/Icon";
import { countryLabel, countryName } from "./hostAdCountries";

const iconRenderer = (
  name: PhoneInputIconName,
  props: { size: number; color: string },
): React.ReactElement => (
  <Icon
    name={
      name === "chevronDown"
        ? "chevD"
        : name === "checkmark"
          ? "check"
          : name === "close"
            ? "close"
            : "search"
    }
    size={props.size}
    color={props.color}
  />
);

const PICKER_LABELS = {
  pickerTitle: "Add a country",
  pickerSearchPlaceholder: "Search countries",
  pickerCloseAccessibilityLabel: "Close country list",
  pickerNoResults: "No countries found",
};

export interface HostAdCountryPickerProps {
  countries: readonly string[];
  onChange: (countries: string[]) => void;
}

export function HostAdCountryPicker({
  countries,
  onChange,
}: HostAdCountryPickerProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const add = useCallback(
    (code: string) => {
      const next = code.trim().toUpperCase();
      if (!countries.includes(next)) onChange([...countries, next]);
      setOpen(false);
    },
    [countries, onChange],
  );
  const overlay = resolvePickerPresentation("overlay", Platform.OS) === "overlay";

  return (
    <View style={styles.root}>
      <Text style={styles.label}>Countries</Text>
      <Text style={styles.helper}>People in these countries can see your ad.</Text>
      <View style={styles.chipRow}>
        {countries.map((code) => (
          <View key={code} style={styles.chip} testID={`host-ad-country-${code}`}>
            <Text style={styles.chipLabel}>{countryLabel(code)}</Text>
            <Pressable
              onPress={() => onChange(countries.filter((item) => item !== code))}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${countryName(code)}`}
              hitSlop={8}
              testID={`host-ad-country-remove-${code}`}
            >
              <Text style={styles.remove}>×</Text>
            </Pressable>
          </View>
        ))}
        <Pressable
          style={[styles.chip, styles.addChip]}
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Add country"
          testID="host-ad-country-add"
        >
          <Text style={styles.addLabel}>+ Add country</Text>
        </Pressable>
      </View>
      {open ? (
        overlay ? (
          <CountryPickerOverlay
            selectedCode={null}
            onSelect={add}
            onClose={close}
            iconRenderer={iconRenderer}
            labels={PICKER_LABELS}
            theme={BUSINESS_SHEET_PHONE_THEME}
            showDialCode={false}
          />
        ) : (
          <CountryPickerModal
            visible={open}
            selectedCode={null}
            onSelect={add}
            onClose={close}
            iconRenderer={iconRenderer}
            labels={PICKER_LABELS}
            theme={BUSINESS_SHEET_PHONE_THEME}
            showDialCode={false}
          />
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[1] },
  label: {
    ...type.caption,
    color: color.text2,
    marginTop: space[1],
  },
  helper: {
    ...type.caption,
    color: color.text2,
    lineHeight: 18,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: space[1] },
  chip: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    paddingHorizontal: space[4],
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineStrong,
    backgroundColor: color.fill.tile,
  },
  chipLabel: { ...type.caption, color: color.text1 },
  remove: { ...type.small, color: color.text2 },
  addChip: { borderStyle: "dashed" },
  addLabel: { ...type.caption, color: color.text1, fontWeight: "700" },
});
