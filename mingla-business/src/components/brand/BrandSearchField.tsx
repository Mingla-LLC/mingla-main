/**
 * #4453 (contract section I) — "Find a brand", shown in the brand switcher
 * above 8 brands. A plain text field (no animation library) so the switcher
 * stays light: it is opened from every screen.
 */
import React from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { color, radius, space, type } from "../../constants/designSystem";
import { Icon } from "../ui/Icon";

export interface BrandSearchFieldProps {
  value: string;
  onChangeText: (next: string) => void;
  inputRef?: React.Ref<TextInput>;
  testID?: string;
}

export const BrandSearchField: React.FC<BrandSearchFieldProps> = ({
  value,
  onChangeText,
  inputRef,
  testID = "brand-search",
}) => (
  <View style={styles.field}>
    <Icon name="search" size={16} color={color.text3} />
    <TextInput
      ref={inputRef}
      value={value}
      onChangeText={onChangeText}
      placeholder="Find a brand"
      placeholderTextColor={color.text3}
      accessibilityLabel="Find a brand"
      autoCapitalize="none"
      autoCorrect={false}
      returnKeyType="search"
      style={styles.input}
      testID={testID}
    />
    {value.length > 0 ? (
      <Pressable
        onPress={() => onChangeText("")}
        accessibilityRole="button"
        accessibilityLabel="Clear the search"
        hitSlop={12}
        style={styles.clear}
        testID={`${testID}-clear`}
      >
        <Icon name="close" size={14} color={color.text2} />
      </Pressable>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  field: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    paddingVertical: 0,
    color: color.text1,
    fontSize: type.row.fontSize,
  },
  clear: { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
});

export default BrandSearchField;
