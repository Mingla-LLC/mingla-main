// issue #4420 — the identity printed on the cover's bottom edge over a dark
// scrim: the eyebrow (date · city), the title in the host's display font, and
// "Presented by <brand>". On desktop the same block heads the right column
// (`variant="desktop"`), in page colours instead of white-on-scrim.
//
// Pure: react-native + this package only. Wave B (venues, stays) reuses it,
// passing `badge` (e.g. "Open now") instead of a presenter.

import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import type { ResolvedTheme } from "./designTokens";
import { ThemeAccentGradientLayer } from "./ThemeAccentFill";
import { accentFill, themeFontFace } from "./themeAccentStyle";
import { boldFontFamily, type ThemePalette } from "./themePalette";

export interface OfferingCoverIdentityData {
  /** Short facts joined with dots ("Sat 19 Dec", "Lagos"). Blank parts drop. */
  eyebrow: readonly (string | null | undefined)[];
  title: string;
  presenter?: { name: string; photo?: string | null } | null;
  /** A node under the title (trip route pills). */
  extra?: React.ReactNode;
  /**
   * issue #4420 wave B — a live status pill under the title (a venue's
   * "Open now"). Plain data, so a surface passes only what is true.
   */
  live?: string | null;
}

export interface OfferingCoverIdentityProps extends OfferingCoverIdentityData {
  palette: ThemePalette;
  theme: ResolvedTheme;
  variant: "cover" | "desktop";
  testID?: string;
}

export const OfferingCoverIdentity: React.FC<OfferingCoverIdentityProps> = ({
  eyebrow,
  title,
  presenter = null,
  extra = null,
  live = null,
  palette,
  theme,
  variant,
  testID = "offering-cover-identity",
}: OfferingCoverIdentityProps) => {
  const onCover = variant === "cover";
  const face = themeFontFace(boldFontFamily(theme));
  const parts = eyebrow.filter(
    (p): p is string => typeof p === "string" && p.trim().length > 0,
  );
  const ink = onCover ? "#FFFFFF" : palette.primaryText;
  const soft = onCover ? "rgba(255,255,255,0.86)" : palette.secondaryText;
  const initial = (presenter?.name.trim()[0] ?? "•").toUpperCase();
  return (
    <View style={styles.wrap} testID={testID}>
      {parts.length > 0 ? (
        <Text
          // issue #4420 audit — the small eyebrow washed out over bright
          // photos (a sunlit sky); it gets the title's shadow on the cover.
          style={[styles.eyebrow, { color: soft }, onCover ? styles.titleShadow : null]}
          numberOfLines={2}
          testID={`${testID}-eyebrow`}
        >
          {/* issue #4420 audit — each part keeps its words together, so a
              long eyebrow wraps only at the dots ("8 DAYS · 7 / NIGHTS" split
              a fact across lines on the trip cover). A part too long for one
              line (a long venue name) keeps its normal spaces. */}
          {parts
            .map((p) => p.trim())
            .map((p) => (p.length <= 28 ? p.replace(/ /g, "\u00A0") : p))
            .join("  ·  ")}
        </Text>
      ) : null}
      <Text
        accessibilityRole="header"
        style={[
          onCover ? styles.titleCover : styles.titleDesktop,
          { color: ink },
          face,
          onCover ? styles.titleShadow : null,
        ]}
        numberOfLines={onCover ? 3 : undefined}
        testID={`${testID}-title`}
      >
        {title}
      </Text>
      {extra !== null ? <View style={styles.extra}>{extra}</View> : null}
      {live !== null && live.length > 0 ? (
        <View
          style={[
            styles.livePill,
            onCover
              ? styles.livePillCover
              : { backgroundColor: palette.card, borderColor: palette.panelBorder },
          ]}
          testID={`${testID}-live`}
        >
          <View style={styles.liveDot} />
          <Text style={[styles.liveText, { color: onCover ? "#FFFFFF" : palette.primaryText }]}>
            {live}
          </Text>
        </View>
      ) : null}
      {presenter !== null && presenter.name.trim().length > 0 ? (
        <View style={styles.byline} testID={`${testID}-presenter`}>
          <View style={[styles.avatar, accentFill(palette)]}>
            <ThemeAccentGradientLayer
              theme={theme}
              palette={palette}
              borderRadius={styles.avatar.borderRadius}
            />
            {presenter.photo != null && presenter.photo.length > 0 ? (
              <Image
                source={{ uri: presenter.photo }}
                style={styles.avatarPhoto}
                accessibilityIgnoresInvertColors
              />
            ) : (
              <Text style={[styles.avatarInitial, { color: palette.accentText }, face]}>
                {initial}
              </Text>
            )}
          </View>
          <Text style={[styles.bylineText, { color: soft }]} numberOfLines={1}>
            Presented by {presenter.name}
          </Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  eyebrow: {
    fontSize: 11.5,
    fontWeight: "700",
    letterSpacing: 1.8,
    textTransform: "uppercase",
  },
  // #3859 — host display faces own their line metrics; no fixed lineHeight.
  titleCover: { fontSize: 40, fontWeight: "700", letterSpacing: -0.4 },
  titleDesktop: { fontSize: 54, fontWeight: "700", letterSpacing: -0.6 },
  titleShadow: {
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 24,
  },
  extra: { marginTop: 2 },
  livePill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  livePillCover: {
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(20,20,22,0.42)",
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#4ADE80" },
  liveText: { fontSize: 12.5, fontWeight: "700" },
  byline: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarPhoto: { width: "100%", height: "100%" },
  avatarInitial: { fontSize: 13, fontWeight: "700" },
  bylineText: { fontSize: 13.5, fontWeight: "600", flexShrink: 1 },
});

export default OfferingCoverIdentity;
