/**
 * #4490 — pick one value from a fixed list. A field-shaped button that opens a
 * list: a centred modal on wide web, a bottom sheet on phones. Never free text.
 * When used inside another Sheet, render it as that Sheet's child
 * (I-SUB-SHEET-INSIDE-PARENT): this component renders its Sheet inline.
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../constants/designSystem";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { Icon } from "./Icon";
import { PickerSheetHead } from "./PickerSheetHead";
import { Sheet } from "./Sheet";
import type { SelectOption } from "./fieldModels";

export interface SelectSheetProps<T extends string | number> {
  label: string;
  value: T | null;
  options: readonly SelectOption<T>[];
  onChange: (next: T) => void;
  placeholder?: string;
  disabled?: boolean;
  hasError?: boolean;
  testID?: string;
}

export function SelectSheet<T extends string | number>({
  label,
  value,
  options,
  onChange,
  placeholder = "Choose",
  disabled = false,
  hasError = false,
  testID,
}: SelectSheetProps<T>): React.ReactElement {
  const [open, setOpen] = useState(false);
  const { isWideDesktop } = useResponsiveLayout();
  const selected = options.find((option) => option.value === value) ?? null;
  return (
    <View style={styles.host} testID={testID}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${selected?.label ?? "not chosen"}. Change`}
        style={[styles.field, hasError && styles.fieldError, disabled && styles.disabled]}
        testID={testID !== undefined ? `${testID}-field` : undefined}
      >
        <Text style={selected !== null ? styles.value : styles.placeholder} numberOfLines={1}>
          {selected?.label ?? placeholder}
        </Text>
        <Icon name="list" size={16} color={color.text3} />
      </Pressable>
      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        snapPoint={0.6}
        presentation={isWideDesktop ? "modal" : undefined}
        testID={testID !== undefined ? `${testID}-sheet` : undefined}
      >
        <View style={styles.sheetBody}>
          <PickerSheetHead title={label} onClose={() => setOpen(false)} testID={testID !== undefined ? `${testID}-head` : undefined} />
          <ScrollView style={styles.scroll} contentContainerStyle={styles.list}>
            {options.map((option) => {
              const on = option.value === value;
              return (
                <Pressable
                  key={String(option.value)}
                  onPress={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  disabled={option.disabled === true}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on, disabled: option.disabled === true }}
                  accessibilityLabel={option.label}
                  accessibilityHint={option.helper}
                  style={[styles.option, on && styles.optionOn, option.disabled === true && styles.disabled]}
                  testID={testID !== undefined ? `${testID}-option-${String(option.value)}` : undefined}
                >
                  <View style={styles.optionCopy}>
                    <Text style={[styles.optionText, on && styles.optionTextOn]}>{option.label}</Text>
                    {option.helper !== undefined ? <Text style={styles.optionHelper}>{option.helper}</Text> : null}
                  </View>
                  {on ? <Icon name="check" size={16} color={color.text1} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: space[1], flexGrow: 1 },
  label: { ...type.small, color: color.text2 },
  field: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  fieldError: { borderColor: color.danger },
  disabled: { opacity: 0.5 },
  value: { ...type.body, color: color.text1, flexShrink: 1 },
  placeholder: { ...type.body, color: color.text4, flexShrink: 1 },
  sheetBody: { flex: 1, paddingHorizontal: space[4], paddingTop: space[2], gap: space[2] },
  scroll: { flex: 1 },
  list: { gap: space[1], paddingBottom: space[6] },
  option: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space[3],
    borderRadius: radius.md,
    backgroundColor: color.fill.inset,
  },
  optionOn: { backgroundColor: color.accentLine },
  optionText: { ...type.body, color: color.text2 },
  optionTextOn: { color: color.text1, fontWeight: "600" },
  optionCopy: { flex: 1, minWidth: 0, gap: 2 },
  optionHelper: { ...type.caption, color: color.text3 },
});
