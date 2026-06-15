// ChipGroup — ORCH-1138 A2.
//
// Wrapping chip row with check (✓) / cross (✗) variants for included /
// not-included lists. Matches DIRECTION_A_V2_FULL_RESPONSIVE.html `.chip-wrap` /
// `.ichip`: flex-wrap left→right on BOTH phone and desktop; `yes` = accent-wash
// fill + accent-filled ✓ badge; `no` = card fill + muted ✗ badge.
//
// Constitution: color is NEVER the only indicator — the ✓/✗ glyph carries the
// meaning. Empty `chips` ⇒ renders nothing (rule 9 — no empty frame).
//
// Pure: react-native + react-native-svg + the shared ThemePalette only.

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Line, Path } from "react-native-svg";

import { type ThemePalette } from "@mingla/event-rendering";

export interface Chip {
  label: string;
  variant: "yes" | "no";
}

export interface ChipGroupProps {
  chips: Chip[];
  palette: ThemePalette;
  testID?: string;
}

const CheckGlyph: React.FC<{ color: string }> = ({ color }) => (
  <Svg width={10} height={10} viewBox="0 0 24 24" fill="none">
    <Path
      d="M5 13l4 4L19 7"
      stroke={color}
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

const CrossGlyph: React.FC<{ color: string }> = ({ color }) => (
  <Svg width={10} height={10} viewBox="0 0 24 24" fill="none">
    <Line
      x1={6}
      y1={6}
      x2={18}
      y2={18}
      stroke={color}
      strokeWidth={3}
      strokeLinecap="round"
    />
    <Line
      x1={18}
      y1={6}
      x2={6}
      y2={18}
      stroke={color}
      strokeWidth={3}
      strokeLinecap="round"
    />
  </Svg>
);

export const ChipGroup: React.FC<ChipGroupProps> = ({
  chips,
  palette,
  testID,
}) => {
  if (chips.length === 0) return null;

  return (
    <View style={styles.wrap} testID={testID}>
      {chips.map((chip, index) => {
        const isYes = chip.variant === "yes";
        return (
          <View
            key={`${chip.variant}-${index}-${chip.label}`}
            style={[
              styles.chip,
              isYes
                ? {
                    backgroundColor: palette.accentWash,
                    borderColor: palette.panelBorder,
                  }
                : {
                    backgroundColor: palette.card,
                    borderColor: palette.panelBorder,
                  },
            ]}
            accessibilityLabel={`${isYes ? "Included" : "Not included"}: ${chip.label}`}
          >
            <View
              style={[
                styles.badge,
                isYes
                  ? { backgroundColor: palette.accent }
                  : { backgroundColor: "rgba(127,127,127,0.22)" },
              ]}
            >
              {isYes ? (
                <CheckGlyph color={palette.accentText} />
              ) : (
                <CrossGlyph color={palette.tertiaryText} />
              )}
            </View>
            <Text
              style={[
                styles.label,
                { color: isYes ? palette.primaryText : palette.secondaryText },
              ]}
            >
              {chip.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  badge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 16,
  },
});

export default ChipGroup;
