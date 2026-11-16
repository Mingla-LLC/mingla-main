/**
 * #4238 — choose where a Host ad runs by country name and flag.
 *
 * Native reuses the shared `@mingla/phone-input` full-screen country modal
 * with dial codes hidden. #4238 rework 3 (P3-5): web opens the app's own
 * Sheet instead (a centred card on desktop, a bottom sheet on a narrow
 * window) with a search field and the list in its scroll body, so Escape and
 * a tap outside close it like every other Host ads sheet. The old in-place
 * overlay filled the whole desktop window edge to edge and ignored Escape.
 */

import React, { useCallback, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { CountryPickerModal, type PhoneInputIconName } from "@mingla/phone-input";

import { color, radius, space, type } from "../../../constants/designSystem";
import { BUSINESS_SHEET_PHONE_THEME } from "../../ui/PhoneField";
import { Icon } from "../../ui/Icon";
import { Input } from "../../ui/Input";
import { Sheet } from "../../ui/Sheet";
import { SheetScrollLayout } from "../../ui/SheetScrollLayout";
import { countryLabel, countryName, hostAdCountryMatches } from "./hostAdCountries";

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

function HostAdCountrySheet(props: {
  visible: boolean;
  chosen: readonly string[];
  onSelect: (code: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => hostAdCountryMatches(query, props.chosen), [query, props.chosen]);
  return (
    <Sheet visible={props.visible} onClose={props.onClose} snapPoint="full" testID="host-ad-country-sheet">
      <View style={styles.sheetWrap}>
        <Text style={styles.sheetTitle} accessibilityRole="header">{PICKER_LABELS.pickerTitle}</Text>
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder={PICKER_LABELS.pickerSearchPlaceholder}
          accessibilityLabel={PICKER_LABELS.pickerSearchPlaceholder}
          autoFocus
          testID="host-ad-country-search"
        />
        <SheetScrollLayout testID="host-ad-country-layout">
          {rows.length === 0 ? (
            <Text style={styles.helper}>{PICKER_LABELS.pickerNoResults}</Text>
          ) : (
            <View style={styles.list}>
              {rows.map((row, index) => (
                <Pressable
                  key={row.code}
                  style={[styles.row, index > 0 && styles.rowDivider]}
                  onPress={() => props.onSelect(row.code)}
                  accessibilityRole="button"
                  accessibilityLabel={row.name}
                  testID={`host-ad-country-option-${row.code}`}
                >
                  <Text style={styles.rowFlag}>{row.flag}</Text>
                  <Text style={styles.rowName}>{row.name}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </SheetScrollLayout>
      </View>
    </Sheet>
  );
}

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
  const web = Platform.OS === "web";

  return (
    <View style={styles.root}>
      <Text style={styles.label}>Countries</Text>
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
      {web ? (
        <HostAdCountrySheet visible={open} chosen={countries} onSelect={add} onClose={close} />
      ) : open ? (
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
  sheetWrap: { flex: 1, minHeight: 0, gap: space[3], paddingHorizontal: space[2], paddingTop: space[2] },
  sheetTitle: { ...type.h2, color: color.text1 },
  list: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line, overflow: "hidden" },
  row: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[4] },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  rowFlag: { ...type.body, color: color.text1 },
  rowName: { ...type.body, color: color.text1, flex: 1 },
});
