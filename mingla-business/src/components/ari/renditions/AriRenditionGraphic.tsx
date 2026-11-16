import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { ariPalette, color, materials, radius, space } from "../../../constants/designSystem";

export type AriRenditionGraphicVariant =
  "event" | "media" | "site" | "research" | "social";

interface Props {
  variant: AriRenditionGraphicVariant;
  eyebrow?: string;
  title?: string;
  meta?: string;
}

const COPY: Record<
  AriRenditionGraphicVariant,
  { eyebrow: string; title: string; meta: string }
> = {
  event: {
    eyebrow: "EVENT PLAN",
    title: "Event details",
    meta: "Confirmed fields appear below",
  },
  media: {
    eyebrow: "MEDIA REVIEW",
    title: "Attached media",
    meta: "Verified details appear below",
  },
  site: {
    eyebrow: "WEBSITE PLAN",
    title: "Site details",
    meta: "Preview and verification appear below",
  },
  research: {
    eyebrow: "PUBLIC RESEARCH",
    title: "Evidence check",
    meta: "Sources and freshness appear below",
  },
  social: {
    eyebrow: "PUBLIC PROFILE",
    title: "Profile evidence",
    meta: "Public details appear below",
  },
};

export const AriRenditionGraphic: React.FC<Props> = ({
  variant,
  eyebrow,
  title,
  meta,
}) => {
  const copy = {
    eyebrow: eyebrow ?? COPY[variant].eyebrow,
    title: title ?? COPY[variant].title,
    meta: meta ?? COPY[variant].meta,
  };
  const colors: [string, string, string] =
    variant === "site"
      ? [color.card, color.card3, ariPalette.ember]
      : variant === "research"
        ? [color.card, color.card2, ariPalette.flame]
        : variant === "social"
          ? [color.card2, color.card3, ariPalette.flame]
          : [color.card, color.card3, ariPalette.gold];

  return (
    <LinearGradient
      colors={colors}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.host}
      accessibilityRole="image"
      accessibilityLabel={`${copy.eyebrow}. ${copy.title}. ${copy.meta}.`}
    >
      <View style={styles.orbGlow} />
      <View style={styles.grid} pointerEvents="none">
        <View style={[styles.gridLine, styles.gridLineOne]} />
        <View style={[styles.gridLine, styles.gridLineTwo]} />
        <View style={[styles.gridLine, styles.gridLineThree]} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.meta}>{copy.meta}</Text>
      </View>
      <View style={styles.badge}>
        <View style={styles.badgeDot} />
        <Text style={styles.badgeText}>ARI</Text>
      </View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  host: {
    minHeight: 142,
    borderRadius: radius.lg,
    overflow: "hidden",
    padding: space[4],
    justifyContent: "flex-end",
  },
  orbGlow: {
    position: "absolute",
    width: 150,
    height: 150,
    borderRadius: 75,
    right: -28,
    top: -48,
    backgroundColor: ariPalette.glow,
  },
  grid: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.28,
  },
  gridLine: {
    position: "absolute",
    height: 1,
    width: "130%",
    left: -20,
    backgroundColor: color.status.muted,
    transform: [{ rotate: "-12deg" }],
  },
  gridLineOne: { top: 34 },
  gridLineTwo: { top: 76 },
  gridLineThree: { top: 118 },
  copy: { gap: 2 },
  eyebrow: {
    color: color.textOnPhoto2,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    letterSpacing: 1.1,
  },
  title: {
    color: color.textOnPhoto,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "700",
  },
  meta: {
    color: color.textOnPhoto2,
    fontSize: 12,
    lineHeight: 17,
  },
  badge: {
    position: "absolute",
    top: space[2],
    left: space[2],
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: radius.full,
    backgroundColor: materials.onPhoto.solidFill,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  badgeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: ariPalette.flame,
  },
  badgeText: {
    color: color.textOnPhoto,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "700",
    letterSpacing: 1,
  },
});
