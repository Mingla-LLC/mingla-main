/**
 * #4522 — "What you earn" on the pricing step. A thin lazy owner: the card's
 * numbers come from `pricingPreview.ts`, which the "Who covers costs" section
 * also uses, and that section loads in its own chunk. Both load through
 * `pricing/WhoCoversCostsChunk`, so the fee preview stays out of the wizard's
 * chunk and out of the business-web boot payload (ORCH-1083). One React.lazy,
 * no nested lazy.
 */

import React from "react";
import { StyleSheet, Text } from "react-native";

import { color, space, type } from "../../constants/designSystem";
import { GlassCard } from "../ui/GlassCard";
import type { TripEarningsCardProps } from "./TripEarningsCardBody";

export type { TripEarningsCardProps } from "./TripEarningsCardBody";

const Body = React.lazy(async () => {
  const module = await import("../pricing/WhoCoversCostsChunk");
  return { default: module.TripEarningsCardBody };
});

export const TripEarningsCard: React.FC<TripEarningsCardProps> = (props) => (
  <React.Suspense
    fallback={
      <GlassCard variant="base" padding={space[4]} radius="lg" testID="trip-earnings-card-loading">
        <Text accessibilityRole="header" style={styles.title}>
          What you earn
        </Text>
        <Text style={styles.note}>Loading…</Text>
      </GlassCard>
    }
  >
    <Body {...props} />
  </React.Suspense>
);

const styles = StyleSheet.create({
  title: {
    fontSize: type.h2.fontSize,
    lineHeight: type.h2.lineHeight,
    fontWeight: "600",
    color: color.text1,
    marginBottom: space[2],
  },
  note: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: color.text2,
  },
});
