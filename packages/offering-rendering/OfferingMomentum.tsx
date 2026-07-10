/**
 * OfferingMomentum — ORCH-1339 [momentum-card-cross-entity] (META-ORCH-1337).
 *
 * The ONE shared, pure-presentational cross-entity momentum unit for the three
 * NON-RSVP public bodies (EventOfferingBody / TripOfferingBody /
 * ExperienceOfferingBody). Renders the honest going/booked COUNT + an optional
 * scarcity sub-line + a capacity METER + an explicitly ANONYMOUS (FACELESS)
 * glyph cluster — a COUNT motif, never identities.
 *
 * WHY this exists (read before editing):
 *   - Gates are SERVER-authoritative (D2): `privateGuestList === true`
 *     suppresses the cluster entirely (count/sub-line/meter still render);
 *     `hideRemainingCount` is applied inside deriveSocialProofMomentum (null
 *     DISPLAY capacity → sub-line omitted, fixed low meter, count kept).
 *   - The cluster is GLYPH-ONLY in this leg — NO <Image>, no avatar
 *     consumption, no identity props. Real avatars are ORCH-1340's (the props
 *     shape already carries `sample`, deliberately unread here). NO Pressable /
 *     onPress anywhere — the tap affordance is ORCH-1341's (the unit stays
 *     inert; Constitution rule 1 — no dead taps means no tap at all until the
 *     sheet exists).
 *   - Honest absence: `socialProof` null OR derivation invisible → render null
 *     (zero layout shift; a fetch failure degrades to today's page).
 *   - Theme dial: every color derives from `palette.*` — never a hex literal
 *     (I-PROPOSED-1157-USES-BRAND-THEME-DIAL applies to this sibling too).
 *   - NO kicker ("YOU'RE INVITED" is RSVP-only), NO chips, NO decision.
 *   - Meter is a STATIC fill (no Animated) — the simplest ORCH-1303-compliant
 *     option (nothing can hold an InteractionManager handle).
 *
 * Pure: react-native + react-native-svg + the shared ThemePalette/ResolvedTheme
 * only. NO data fetch, NO React Query, NO app `src/` import
 * (I-MOR-0827-PACKAGE-ISOLATION). Renders on react-native-web AND native RN.
 * Android: opaque card fill (Platform.OS === "android" → palette.page) +
 * overflow:'hidden' per ANDROID_GLASS_USES_OPAQUE_FALLBACK; web/iOS composite
 * via opaqueSurfaceColor (styles byte-follow RsvpMomentumDecision's momentum
 * unit so the two cards read identically).
 */

import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import {
  boldFontFamily,
  opaqueSurfaceColor,
  type ThemePalette,
} from "./themePalette";
import { type ResolvedTheme } from "./designTokens";
import { type SocialProofSummary } from "./socialProofTypes";
import { deriveSocialProofMomentum } from "./socialProofMomentum";

// ───────────────────────────── props contract ───────────────────────────────

export interface OfferingMomentumProps {
  palette: ThemePalette;
  theme: ResolvedTheme;
  /** ORCH-1338 payload (props-only — the surface owns the fetch). null → no unit. */
  socialProof: SocialProofSummary | null;
  testID?: string;
}

// ─────────────────────────────── glyph (SVG) ────────────────────────────────

/** FACELESS person glyph for the anonymous cluster (NEVER a photo). Local copy
 * of the RsvpMomentumDecision glyph so the RSVP unit's file stays untouched. */
const PersonGlyph: React.FC<{ color: string }> = ({ color }) => (
  <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
    <Circle cx={12} cy={8} r={4} stroke={color} strokeWidth={2} />
    <Path
      d="M4 21c0-4 4-7 8-7s8 3 8 7"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
    />
  </Svg>
);

// Opaque neutral card fill on EVERY platform (byte-follows RsvpMomentumDecision:
// Android keeps its raw opaque page; web/iOS composite the translucent card
// token over the page to a SOLID hex — no see-through).
// ANDROID_GLASS_USES_OPAQUE_FALLBACK.
const opaqueCardFill = (palette: ThemePalette): string =>
  Platform.OS === "android" ? palette.page : opaqueSurfaceColor(palette);

// ─────────────────────────────── component ──────────────────────────────────

export const OfferingMomentum: React.FC<OfferingMomentumProps> = ({
  palette,
  theme,
  socialProof,
  testID,
}) => {
  if (socialProof === null) return null;
  const momentum = deriveSocialProofMomentum(socialProof);
  if (!momentum.visible) return null;

  const boldFamily = boldFontFamily(theme);
  const a11yLabel = `${socialProof.goingCount} people ${momentum.countLabel}`;

  return (
    <View
      style={[
        styles.momentum,
        { backgroundColor: opaqueCardFill(palette), borderColor: palette.panelBorder },
      ]}
      testID={testID ?? "orch-1339-momentum"}
    >
      <View style={styles.momTop}>
        <Text
          style={[styles.momCount, { color: palette.primaryText, fontFamily: boldFamily }]}
          accessibilityLabel={a11yLabel}
        >
          {socialProof.goingCount}
        </Text>
        <Text style={[styles.momLabel, { color: palette.secondaryText }]}>
          {momentum.countLabel}
        </Text>
      </View>
      {momentum.subLabel !== null ? (
        <Text
          style={[styles.momSub, { color: palette.tertiaryText }]}
          testID="orch-1339-momentum-sub"
        >
          {momentum.subLabel}
        </Text>
      ) : null}
      {/* capacity meter — accent fill (theme dial); STATIC width (no Animated). */}
      <View style={[styles.meterTrack, { backgroundColor: palette.panelBorder }]}>
        <View
          style={[
            styles.meterFill,
            { width: `${momentum.meterPercent}%`, backgroundColor: palette.accent },
          ]}
          testID="orch-1339-momentum-meter"
        />
      </View>
      {/* anonymous FACELESS cluster — suppressed entirely under privateGuestList
          (D2); count/sub-line/meter above still render. GLYPH-only until 1340. */}
      {!socialProof.privateGuestList ? (
        <View
          style={styles.cluster}
          accessibilityLabel={a11yLabel}
          testID="orch-1339-momentum-cluster"
        >
          {Array.from({ length: momentum.shownGlyphs }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.avatar,
                {
                  backgroundColor: palette.accent,
                  borderColor: palette.page,
                  marginLeft: i === 0 ? 0 : -8,
                },
              ]}
            >
              <PersonGlyph color={palette.accentText} />
            </View>
          ))}
          {momentum.overflowCount > 0 ? (
            <View
              style={[
                styles.avatar,
                styles.avatarMore,
                {
                  backgroundColor: opaqueCardFill(palette),
                  borderColor: palette.page,
                  marginLeft: -8,
                },
              ]}
            >
              <Text style={[styles.avatarMoreText, { color: palette.secondaryText }]}>
                +{momentum.overflowCount}
              </Text>
            </View>
          ) : null}
          <Text style={[styles.clusterNote, { color: palette.tertiaryText }]}>
            {momentum.clusterNote}
          </Text>
        </View>
      ) : null}
    </View>
  );
};

OfferingMomentum.displayName = "OfferingMomentum";

// Styles byte-follow RsvpMomentumDecision.styles.momentum/momTop/momCount/
// momLabel/momSub/meterTrack/meterFill/cluster/avatar/avatarMore/avatarMoreText/
// clusterNote so the two momentum cards read identically across pages.
const styles = StyleSheet.create({
  momentum: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    marginBottom: 16,
    overflow: "hidden",
  },
  momTop: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  momCount: { fontSize: 40, fontWeight: "900", letterSpacing: -1.5, lineHeight: 42 },
  momLabel: { fontSize: 14, fontWeight: "700" },
  momSub: { fontSize: 12, fontWeight: "600", marginTop: 4 },
  meterTrack: { height: 8, borderRadius: 999, marginTop: 14, overflow: "hidden" },
  meterFill: { height: "100%", borderRadius: 999 },
  cluster: { flexDirection: "row", alignItems: "center", marginTop: 14 },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarMore: {},
  avatarMoreText: { fontSize: 11, fontWeight: "800" },
  clusterNote: { marginLeft: 12, fontSize: 12, fontWeight: "600" },
});

export default OfferingMomentum;
