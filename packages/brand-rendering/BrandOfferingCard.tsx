/**
 * BrandOfferingCard — issue #4420 wave 2 (§1.1.8). The ONE offering card on
 * the public brand page, shared by every kind (tickets, RSVP, experience,
 * trip, and the section and upcoming rows that mix them). It replaces five
 * copies of the same markup (Constitution 8: subtract before adding).
 *
 *   ┌───────────────────────────────┐
 *   │ [kind chip]      [3 left]     │  16:10 photo (host colour when none)
 *   │                               │
 *   ├───────────────────────────────┤
 *   │ SAT 19 DEC · 21:00            │  date eyebrow, the text accent
 *   │ Graphite Rooftop Night        │  host face, two lines
 *   │ The Glasshouse                │  venue or destination
 *   │ $45  $60        (View tickets)│  price (struck list price) + tonal pill
 *   └───────────────────────────────┘
 *
 * Presentational only: each kind still computes its own price, date, badge
 * and accessibility label (unchanged), and hands this card the pieces. Past
 * cards fade and drop the price row.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import type { ResolvedTheme, ThemePalette } from "@mingla/offering-rendering";
import { themeTextAccent } from "@mingla/offering-rendering/themePalette";
import { themeBoldFace } from "@mingla/offering-rendering/themeAccentStyle";
import { AccentLucideIcon } from "@mingla/offering-rendering/LucideIcons";

export interface BrandOfferingCardScarcity {
  label: string;
  /** "paper": a light chip ("3 left"); "glass": a quiet chip ("Sold out"). */
  tone: "paper" | "glass";
}

export interface BrandOfferingCardProps {
  onPress: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  accessibilityLabel: string;
  testID?: string;
  /** The photo (or the host-colour fallback), drawn by the page. */
  cover: React.ReactNode;
  /** The glass chip on the photo: "Tickets", "RSVP", "Experience", "Trip". */
  kind: { label: string; Icon?: LucideIcon } | null;
  scarcity?: BrandOfferingCardScarcity | null;
  dateLine: string | null;
  title: string;
  meta: string | null;
  price: string | null;
  /** The regular price, struck, when the card is on sale. */
  listPrice?: string | null;
  /** Today's tonal pill: "View tickets", "Book a time", "View trip". */
  actionLabel: string | null;
  past?: boolean;
  isDesktop: boolean;
  palette: ThemePalette;
  theme: ResolvedTheme;
  /** The page's card surface (`offeringSurfaceStyles(...).card`). */
  surfaceCard: object;
}

const PAPER_CHIP = "rgba(255,255,255,0.92)";
const PAPER_INK = "#10141f";

export const BrandOfferingCard: React.FC<BrandOfferingCardProps> = ({
  onPress,
  onFocus,
  onBlur,
  accessibilityLabel,
  testID,
  cover,
  kind,
  scarcity = null,
  dateLine,
  title,
  meta,
  price,
  listPrice = null,
  actionLabel,
  past = false,
  isDesktop,
  palette,
  theme,
  surfaceCard,
}: BrandOfferingCardProps) => {
  const accent = themeTextAccent(palette);
  return (
    <Pressable
      onPress={onPress}
      onFocus={onFocus}
      onBlur={onBlur}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={({ pressed }: { pressed: boolean }) => [
        styles.card,
        surfaceCard,
        isDesktop && styles.cardDesktop,
        past && styles.cardPast,
        pressed && styles.cardPressed,
      ]}
    >
      <View style={styles.photo}>
        {cover}
        {kind !== null ? (
          <View
            style={[styles.chip, styles.chipLeft, { backgroundColor: palette.glass, borderColor: palette.panelBorder }]}
            testID="issue-4420-brand-card-kind"
          >
            {kind.Icon !== undefined ? (
              <AccentLucideIcon Icon={kind.Icon} size={13} palette={palette} />
            ) : null}
            <Text style={[styles.chipLabel, { color: palette.primaryText }]}>{kind.label}</Text>
          </View>
        ) : null}
        {scarcity !== null ? (
          <View
            style={[
              styles.chip,
              styles.chipRight,
              scarcity.tone === "paper"
                ? { backgroundColor: PAPER_CHIP, borderColor: PAPER_CHIP }
                : { backgroundColor: palette.glass, borderColor: palette.panelBorder },
            ]}
            testID="issue-4420-brand-card-scarcity"
          >
            <Text
              style={[
                styles.chipLabel,
                { color: scarcity.tone === "paper" ? PAPER_INK : palette.primaryText },
              ]}
            >
              {scarcity.label}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.body}>
        {dateLine !== null && dateLine.length > 0 ? (
          <Text style={[styles.date, { color: accent }]} numberOfLines={1}>
            {dateLine}
          </Text>
        ) : null}
        <Text
          style={[styles.title, { ...themeBoldFace(theme), color: palette.primaryText }]}
          numberOfLines={2}
        >
          {title}
        </Text>
        {meta !== null && meta.length > 0 ? (
          <Text style={[styles.meta, { color: palette.secondaryText }]} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
        {past ? null : (
          <View style={styles.actionRow}>
            {price !== null ? (
              <View style={styles.priceRow}>
                <Text style={[styles.price, { color: palette.primaryText }]}>{price}</Text>
                {listPrice !== null ? (
                  <Text
                    style={[styles.listPrice, { color: palette.tertiaryText }]}
                    accessibilityLabel={`Regular price ${listPrice}`}
                  >
                    {listPrice}
                  </Text>
                ) : null}
              </View>
            ) : (
              <View style={styles.priceRow} />
            )}
            {actionLabel !== null ? (
              <View
                style={[styles.pill, { backgroundColor: palette.accentWash }]}
                testID="issue-4420-brand-card-pill"
              >
                <Text style={[styles.pillLabel, { color: palette.primaryText }]}>{actionLabel}</Text>
              </View>
            ) : null}
          </View>
        )}
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: { borderRadius: 20, overflow: "hidden" },
  cardDesktop: { width: "48%" },
  cardPast: { opacity: 0.62 },
  cardPressed: { opacity: 0.78 },
  photo: { width: "100%", aspectRatio: 16 / 10, overflow: "hidden" },
  chip: {
    position: "absolute",
    top: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipLeft: { left: 12 },
  chipRight: { right: 12 },
  chipLabel: { fontSize: 12, fontWeight: "700" },
  body: { paddingTop: 14, paddingHorizontal: 16, paddingBottom: 16, gap: 4 },
  date: { fontSize: 11.5, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  title: { fontSize: 20, fontWeight: "700", marginTop: 2 },
  meta: { fontSize: 13.5, marginTop: 2 },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12 },
  priceRow: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: 6 },
  price: { fontSize: 15, fontWeight: "800", fontVariant: ["tabular-nums"] },
  listPrice: { fontSize: 13, textDecorationLine: "line-through" },
  pill: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    flexShrink: 0,
  },
  pillLabel: { fontSize: 13.5, fontWeight: "800" },
});

export default BrandOfferingCard;
