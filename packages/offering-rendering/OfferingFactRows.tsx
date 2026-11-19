// issue #4420 — the three fact rows (when / where / who's going) under every
// public offering title, each with at most ONE action, then a quiet tag line.
// They replace the old chip row: the same facts, read as a list instead of a
// band of pills.
//
//   [icon]  Sat 19 Dec                       Add to calendar
//           9:00 PM – 3:00 AM
//   ──────────────────────────────────────────────────────
//   [icon]  Harmattan Courtyard                         Map
//           Lagos
//
// A row with no `value` and no `detail` is skipped, so a page never prints an
// empty fact. Icons and action links are the theme's first colour (text
// accents never take the gradient, #1023). The trailing slot takes a node
// (the guest face cluster) instead of a link.
//
// Pure: react-native + this package only. Wave B (venues, stays) reuses it.

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ResolvedTheme } from "./designTokens";
import { Calendar, Clock, Globe, MapPin, Tag, Users } from "./LucideIcons";
import { themeFontFace } from "./themeAccentStyle";
import { boldFontFamily, themeTextAccent, type ThemePalette } from "./themePalette";

export type OfferingFactIcon =
  | "calendar"
  | "clock"
  | "pin"
  | "globe"
  | "people"
  | "price";

export interface OfferingFact {
  /** Stable key (also the testID suffix). */
  key: string;
  icon: OfferingFactIcon;
  /** The bold line. */
  value: string | null;
  /** The quiet line under it. */
  detail?: string | null;
  /** A third, smaller line (e.g. "Full address after you get tickets"). */
  caption?: string | null;
  /** The row's one action. */
  action?: {
    label: string;
    onPress: () => void;
    accessibilityLabel?: string;
  } | null;
  /** A node shown at the row's end instead of an action (face cluster). */
  trailing?: React.ReactNode;
}

export interface OfferingFactRowsProps {
  facts: readonly OfferingFact[];
  palette: ThemePalette;
  theme?: ResolvedTheme;
  /** The quiet line under the rows ("In person · Artsy · 18+"). */
  tags?: readonly string[];
  /** Replaces the tag line with a custom node (the trip route pills). */
  tagsNode?: React.ReactNode;
  testID?: string;
}

const ICON_SIZE = 20;

const FactGlyph: React.FC<{ icon: OfferingFactIcon; color: string }> = ({
  icon,
  color,
}) => {
  switch (icon) {
    case "calendar":
      return <Calendar size={ICON_SIZE} color={color} strokeWidth={1.7} />;
    case "clock":
      return <Clock size={ICON_SIZE} color={color} strokeWidth={1.7} />;
    case "pin":
      return <MapPin size={ICON_SIZE} color={color} strokeWidth={1.7} />;
    case "globe":
      return <Globe size={ICON_SIZE} color={color} strokeWidth={1.7} />;
    case "people":
      return <Users size={ICON_SIZE} color={color} strokeWidth={1.7} />;
    case "price":
      return <Tag size={ICON_SIZE} color={color} strokeWidth={1.7} />;
    default: {
      const never: never = icon;
      return never;
    }
  }
};

const present = (s: string | null | undefined): s is string =>
  typeof s === "string" && s.trim().length > 0;

/**
 * issue #4420 audit — a detail that only repeats the value ("Long Table Loft"
 * under "Long Table Loft", when the venue's area falls back to its name) is
 * not printed twice.
 */
export const sameLine = (
  a: string | null | undefined,
  b: string | null | undefined,
): boolean =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.trim().toLowerCase() === b.trim().toLowerCase();

export const OfferingFactRows: React.FC<OfferingFactRowsProps> = ({
  facts,
  palette,
  theme,
  tags = [],
  tagsNode = null,
  testID = "offering-fact-rows",
}: OfferingFactRowsProps) => {
  const accent = themeTextAccent(palette);
  const boldFace = theme !== undefined ? themeFontFace(boldFontFamily(theme)) : null;
  const shown = facts.filter((f) => present(f.value) || present(f.detail));
  const tagLine = tags.filter(present).join(" · ");
  if (shown.length === 0 && tagLine.length === 0 && tagsNode === null) return null;
  return (
    <View style={styles.wrap} testID={testID}>
      {shown.length > 0 ? (
        <View style={[styles.rows, { borderTopColor: palette.panelBorder }]}>
          {shown.map((fact) => (
            <View
              key={fact.key}
              style={[styles.row, { borderBottomColor: palette.panelBorder }]}
              testID={`${testID}-${fact.key}`}
            >
              <View style={styles.icon}>
                <FactGlyph icon={fact.icon} color={accent} />
              </View>
              <View style={styles.textCol}>
                {present(fact.value) ? (
                  <Text
                    style={[styles.value, { color: palette.primaryText }, boldFace]}
                    testID={`${testID}-${fact.key}-value`}
                  >
                    {fact.value}
                  </Text>
                ) : null}
                {present(fact.detail) && !sameLine(fact.detail, fact.value) ? (
                  <Text style={[styles.detail, { color: palette.secondaryText }]}>
                    {fact.detail}
                  </Text>
                ) : null}
                {present(fact.caption) ? (
                  <Text style={[styles.caption, { color: palette.tertiaryText }]}>
                    {fact.caption}
                  </Text>
                ) : null}
              </View>
              {fact.action != null ? (
                <Pressable
                  onPress={fact.action.onPress}
                  accessibilityRole="button"
                  accessibilityLabel={fact.action.accessibilityLabel ?? fact.action.label}
                  hitSlop={10}
                  style={styles.action}
                  testID={`${testID}-${fact.key}-action`}
                >
                  <Text style={[styles.actionText, { color: accent }]}>
                    {fact.action.label}
                  </Text>
                </Pressable>
              ) : fact.trailing != null ? (
                <View style={styles.trailing}>{fact.trailing}</View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      {tagsNode !== null ? (
        <View style={styles.tagsNode}>{tagsNode}</View>
      ) : tagLine.length > 0 ? (
        <Text
          style={[styles.tags, { color: palette.secondaryText }]}
          testID={`${testID}-tags`}
        >
          {tagLine}
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginTop: 4 },
  rows: { borderTopWidth: StyleSheet.hairlineWidth },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  icon: { width: 22, paddingTop: 1, alignItems: "center" },
  textCol: { flex: 1, minWidth: 0 },
  value: { fontSize: 15.5, fontWeight: "700", lineHeight: 21 },
  detail: { fontSize: 13.5, lineHeight: 19, marginTop: 3 },
  caption: { fontSize: 12.5, lineHeight: 17, marginTop: 4 },
  // #4490: a 44 touch target (a phone browser has no hitSlop); the negative margin keeps the
  // row exactly as tall as before.
  action: { minHeight: 44, minWidth: 44, marginVertical: -10, paddingTop: 2, justifyContent: "center", alignItems: "flex-end", flexShrink: 0 },
  actionText: { fontSize: 13.5, fontWeight: "700" },
  trailing: { flexShrink: 0, paddingTop: 1 },
  tags: { fontSize: 13, lineHeight: 19, marginTop: 14, letterSpacing: 0.2 },
  tagsNode: { marginTop: 14 },
});

export default OfferingFactRows;
