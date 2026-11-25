/**
 * #4490 P3-3 — a package's paid extras as checkboxes with their price
 * ("Cake table · ₦20,000 a booking"). Ticking one re-asks the quote.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ResolvedTheme, ThemePalette } from "@mingla/offering-rendering";
import { accentFillWithBorder, accentOutline, themeBoldFace } from "@mingla/offering-rendering/themeAccentStyle";
import { formatVenueMoney } from "@mingla/brand-rendering/venueMoney";
import type { PackageExtraView } from "@mingla/brand-rendering/venueOffers/packageModel";

import { radius, space, type } from "../../../constants/designSystem";
import { Icon } from "../../ui/Icon";

export interface ExtrasListProps {
  palette: ThemePalette;
  theme: ResolvedTheme;
  extras: readonly PackageExtraView[];
  picked: readonly string[];
  onToggle: (id: string) => void;
  currencyCode: string;
  exponent: number;
  /** Extras already on the booking (the pass page): shown as "Added". */
  added?: readonly string[];
  label?: string;
  testID?: string;
}

export function ExtrasList({
  palette,
  theme,
  extras,
  picked,
  onToggle,
  currencyCode,
  exponent,
  added = [],
  label = "EXTRAS",
  testID = "issue-4490-extras",
}: ExtrasListProps): React.ReactElement | null {
  if (extras.length === 0) return null;
  return (
    <View style={styles.wrap} testID={testID}>
      <Text style={[styles.label, { color: palette.tertiaryText }]}>{label}</Text>
      {extras.map((e) => {
        const on = picked.includes(e.id);
        const price = `${formatVenueMoney(e.priceMinor, currencyCode, exponent)} ${e.per === "guest" ? "a guest" : "a booking"}`;
        return (
          <Pressable
            key={e.id}
            onPress={() => onToggle(e.id)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`${e.name}, ${price}`}
            style={({ pressed }) => [
              styles.row,
              on
                ? accentOutline(palette, { background: palette.card, opaqueBackground: palette.page })
                : { borderColor: palette.panelBorder, backgroundColor: palette.card },
              pressed ? styles.pressed : null,
            ]}
            testID={`${testID}-${e.id}`}
          >
            <View style={[styles.box, on ? accentFillWithBorder(palette) : { borderColor: palette.secondaryText, backgroundColor: "transparent" }]}>
              {on ? <Icon name="check" size={14} color={palette.accentText} /> : null}
            </View>
            <View style={styles.text}>
              <Text style={[styles.name, themeBoldFace(theme), { color: palette.primaryText }]}>{e.name}</Text>
              {added.includes(e.id) ? <Text style={[styles.note, { color: palette.secondaryText }]}>Already on your booking</Text> : null}
            </View>
            <Text style={[styles.price, { color: palette.secondaryText }]}>{price}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[2] },
  label: { ...type.label },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    minHeight: 52,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  pressed: { opacity: 0.85 },
  box: { width: 22, height: 22, borderRadius: radius.sm, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, minWidth: 0, gap: 2 },
  name: { ...type.row },
  note: { ...type.caption },
  price: { ...type.small },
});
