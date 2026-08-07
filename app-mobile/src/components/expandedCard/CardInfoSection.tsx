/**
 * THE BODY'S PROSE — description, typical spend, and the tip. Issue #1605 wave 4.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS COMPONENT USED TO BE, AND WHERE EACH PIECE WENT
 *
 * It was the whole single-place info block: a 24/700 title, a #D97706 category
 * chip, a tag, four orange metric pills (rating, distance, travel time, price),
 * the price provenance, the description and the tip. Under one spine those
 * pieces belong to different materials:
 *
 *     title                 -> the HERO's title, 30/700 on the photograph
 *     rating / distance     -> the PLATE's meta line, spans 1 and 2
 *     price TIER            -> the PLATE's meta line, span 3
 *     category              -> the PLATE's meta line, span 4 (the 0.72 tail)
 *     travel time           -> the plate is one row; a travel time is not an
 *                              identity fact and it is already on the card
 *     description           -> here, as body prose
 *     price (FX-converted)  -> here, as a fact row
 *     tip                   -> here
 *
 * A curated plan's TAGLINE is a description, so it renders here too — the dark
 * header used to carry it at 14pt on rgba(255,255,255,0.7) and the single-place
 * branch dropped it on the floor along with the rest of this component.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CONVERTED PRICE IS A ROW AND THE TIER IS A SPAN
 *
 * `canonicalDiscoveryPriceDetail` produces a real money range in the viewer's
 * currency, plus the date of the rates it used and the attribution the licence
 * requires. NONE of that fits in a two-character span on a fixed-height plate,
 * and dropping the attribution to make it fit would be a licence problem rather
 * than a design one. So the PLATE carries the tier — the fact that ranks places
 * against each other at a glance, and the one the collapsed card already shows —
 * and the BODY carries the converted figure with its provenance intact.
 *
 * Nothing is lost: this is the same `discoveryPrice={card}` value, through the
 * same `canonicalDiscoveryPriceDetail(discoveryPrice as CanonicalDiscoveryPrice
 * | undefined)` call, rendered where it has room to be honest.
 */
import React from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  canonicalDiscoveryPriceDetail,
  type CanonicalDiscoveryPrice,
} from "../../utils/priceTiers";
import { FactRow, Section, present } from "./SpineParts";
import { SPINE } from "./spineTokens";

/** Five lines, then a Read more. Long enough to be a paragraph, short enough to be a fold. */
const DESCRIPTION_CLAMP_LINES = 5;

interface CardInfoSectionProps {
  /**
   * `generative_summary` only. `fullDescription` stays unrendered
   * (I-1290-PITCH-CONSUMER-FACING — the pitch is not consumer-facing copy).
   */
  description?: string | null;
  tip?: string | null;
  discoveryPrice?: Partial<CanonicalDiscoveryPrice>;
}

export default function CardInfoSection({
  description,
  tip,
  discoveryPrice,
}: CardInfoSectionProps): React.ReactElement | null {
  const { t } = useTranslation(["expanded_details", "cards", "common"]);
  const [expanded, setExpanded] = React.useState(false);

  const priceDetail = canonicalDiscoveryPriceDetail(
    discoveryPrice as CanonicalDiscoveryPrice | undefined,
  );

  const hasDescription = present(description);
  const hasTip = present(tip);
  const hasPrice = priceDetail !== null && present(priceDetail.source);
  if (!hasDescription && !hasTip && !hasPrice) return null;

  return (
    <View style={styles.container}>
      {hasDescription ? (
        <View style={styles.prose}>
          <Text
            style={styles.description}
            numberOfLines={expanded ? undefined : DESCRIPTION_CLAMP_LINES}
          >
            {description}
          </Text>
          {/*
            `Read more` expands IN PLACE. It is 14/600 #C2410C (5.18:1) on a 44pt
            target — the only accent-coloured text in the body, and it is a
            control, not decoration.
          */}
          <Pressable
            onPress={() => setExpanded((v) => !v)}
            style={styles.readMore}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={
              expanded
                ? t("expanded_details:action_buttons.show_less")
                : t("cards:expanded.read_more", { defaultValue: "Read more" })
            }
          >
            <Text style={styles.readMoreText}>
              {expanded
                ? t("expanded_details:action_buttons.show_less")
                : t("cards:expanded.read_more", { defaultValue: "Read more" })}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {hasPrice ? (
        <Section
          title={t("expanded_details:action_buttons.typical_spend", {
            defaultValue: "Typical spend",
          })}
        >
          <FactRow
            first
            label={t("expanded_details:action_buttons.per_person", {
              defaultValue: "Per person",
            })}
            value={priceDetail.source}
            tail={present(priceDetail.approximate) ? `≈ ${priceDetail.approximate}` : null}
          />
          {present(priceDetail.ratesDate) || present(priceDetail.attributionUrl) ? (
            <View style={styles.provenance}>
              {present(priceDetail.ratesDate) ? (
                <Text style={styles.provenanceText}>
                  {t("expanded_details:action_buttons.rates_from", {
                    defaultValue: "Rates from {{date}}",
                    date: new Date(priceDetail.ratesDate).toLocaleDateString(),
                  })}
                </Text>
              ) : null}
              {present(priceDetail.attributionUrl) ? (
                <Text
                  accessibilityRole="link"
                  style={styles.attribution}
                  onPress={() => {
                    void Linking.openURL(priceDetail.attributionUrl as string).catch(() => {
                      // The attribution is a courtesy link, not an action the user
                      // asked for; a failure here has nothing to surface and
                      // nothing to retry. Swallowed DELIBERATELY and visibly.
                    });
                  }}
                >
                  Rates by ExchangeRate-API
                </Text>
              ) : null}
            </View>
          ) : null}
        </Section>
      ) : null}

      {hasTip ? (
        <View style={styles.tipRow}>
          {/* 7.56:1 — was #9CA3AF at 2.54:1, which is not text, it is a suggestion of text. */}
          <Text style={styles.tip}>{tip}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  prose: { paddingHorizontal: SPINE.gutter, paddingBottom: SPINE.sectionPaddingVertical },
  description: {
    fontSize: SPINE.proseSize,
    lineHeight: SPINE.proseLineHeight,
    color: SPINE.prose,
  },
  readMore: { minHeight: SPINE.factRowMinHeight, justifyContent: "center" },
  readMoreText: { fontSize: 14, fontWeight: "600", color: SPINE.link },
  provenance: { paddingHorizontal: SPINE.gutter, paddingTop: 6, gap: 2 },
  provenanceText: { fontSize: 12, color: SPINE.factLabel },
  attribution: { fontSize: 12, color: SPINE.link, textDecorationLine: "underline" },
  tipRow: {
    paddingHorizontal: SPINE.gutter,
    paddingBottom: SPINE.sectionPaddingVertical,
  },
  tip: { fontSize: 14, fontStyle: "italic", color: SPINE.muted, lineHeight: 20 },
});
