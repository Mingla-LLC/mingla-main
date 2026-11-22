/**
 * issue #3281 S2 — "Add at checkout:" under a ticket, package, option or RSVP
 * on the public page (buyer web, Explorer, the Host web preview).
 *
 * Props only. It reads the reader's raw add-on list (a ticket's `extras`, or
 * the RSVP payload's `rsvpAddOns`) and lists what the host chose to show:
 * "{thumb} {name} · {price}", "Free" for 0, a greyed "Sold out" when none are
 * left. Nothing is chosen here (checkout does that), so the chips are not
 * buttons. A ticket with nothing to show renders nothing; the caller decides
 * whether add-ons are on at all (`enabled`, from its own feature flag).
 *
 * Every price is the server's all-in; photos are the stored thumbnail object
 * (the caller builds its public URL, never an image transformation URL).
 *
 * Imported by its deep path (`@mingla/offering-rendering/OfferingAddOnsBlock`),
 * never through the package barrel.
 */

import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import {
  formatAddOnMoney,
  publicAddOnChips,
  type OfferingAddOnChip,
  type OfferingAddOnsDisplay,
} from "./offeringAddOnChips";
import type { ThemePalette } from "./themePalette";

export type { OfferingAddOnsDisplay } from "./offeringAddOnChips";

export interface OfferingAddOnsBlockProps {
  /** The caller's add-ons switch; false renders nothing. */
  enabled: boolean;
  /** The reader's raw list (`ticket.extras` or `rsvpAddOns`). */
  addOns: unknown;
  palette: ThemePalette;
  /** The offering's currency (ISO 4217); prices are minor units. */
  currency: string | null;
  /** The stored thumbnail's public URL, or null to show no image. */
  photoUrl?: (path: string) => string | null;
  testID?: string;
}

export const OfferingAddOnsBlock: React.FC<OfferingAddOnsBlockProps> = ({
  enabled,
  addOns,
  palette,
  currency,
  photoUrl,
  testID = "issue-3281-offering-add-ons",
}) => {
  if (!enabled) return null;
  const formatMoney = (minor: number): string => formatAddOnMoney(minor, currency);
  const chips = publicAddOnChips(addOns);
  if (chips.length === 0) return null;
  const label = (chip: OfferingAddOnChip): string =>
    chip.soldOut
      ? `${chip.name}, sold out`
      : `${chip.name}, ${chip.priceAllInCents > 0 ? formatMoney(chip.priceAllInCents) : "free"}`;
  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityLabel={`Add at checkout: ${chips.map(label).join("; ")}`}
      testID={testID}
    >
      <Text style={[styles.lead, { color: palette.secondaryText }]}>Add at checkout:</Text>
      <View style={styles.chips}>
        {chips.map((chip) => {
          const uri =
            chip.photoThumbPath !== null && photoUrl !== undefined ? photoUrl(chip.photoThumbPath) : null;
          return (
            <View
              key={chip.id}
              style={[
                styles.chip,
                { borderColor: palette.panelBorder, backgroundColor: palette.card },
                chip.soldOut ? styles.chipSoldOut : null,
              ]}
              testID={`${testID}-${chip.id}`}
            >
              {uri !== null ? (
                <Image source={{ uri }} style={styles.thumb} accessibilityIgnoresInvertColors />
              ) : null}
              <Text style={[styles.chipText, { color: palette.primaryText }]} numberOfLines={1}>
                {chip.name}
                <Text style={{ color: palette.secondaryText }}>
                  {` · ${chip.soldOut ? "Sold out" : chip.priceAllInCents > 0 ? formatMoney(chip.priceAllInCents) : "Free"}`}
                </Text>
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginTop: 8, gap: 6 },
  lead: { fontSize: 12, lineHeight: 16, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 28,
    maxWidth: "100%",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipSoldOut: { opacity: 0.5 },
  thumb: { width: 20, height: 20, borderRadius: 6 },
  chipText: { fontSize: 12, lineHeight: 16, flexShrink: 1 },
});
