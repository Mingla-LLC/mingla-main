/**
 * OfferingMomentum — ORCH-1339 [momentum-card-cross-entity] (META-ORCH-1337).
 *
 * The ONE shared, pure-presentational cross-entity momentum unit for the three
 * NON-RSVP public bodies (EventOfferingBody / TripOfferingBody /
 * ExperienceOfferingBody). Renders the honest going/booked COUNT + an optional
 * scarcity sub-line + a capacity METER + a privacy-gated guest cluster (real
 * avatar photos where the server-filtered sample provides them, honest glyph
 * disks everywhere else) — a COUNT motif, never names.
 *
 * WHY this exists (read before editing):
 *   - Gates are SERVER-authoritative (D2): `privateGuestList === true`
 *     suppresses the WHOLE cluster block — disks AND the "See who's going"
 *     affordance (count/sub-line/meter still render); `hideRemainingCount` is
 *     applied inside deriveSocialProofMomentum (null DISPLAY capacity →
 *     sub-line omitted, fixed low meter, count kept).
 *   - The cluster renders exclusively through the shared GuestAvatarCluster
 *     (ORCH-1340) — the ONE photo-rendering owner. Photos come ONLY from
 *     `socialProof.sample` (1338 frozen shape: avatarUrl + isMinglaUser, no
 *     names — the payload IS the privacy boundary;
 *     I-PROPOSED-1340-GUEST-IDENTITY-PRIVACY-GATED). This file itself still
 *     contains NO <Image> and NO Pressable — the tap affordance lives inside
 *     the cluster and fires only when a host passes `onSeeWhosGoing`
 *     (ORCH-1341/1342 wire the handlers; absent ⇒ inert, no dead tap).
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

import {
  boldFontFamily,
  opaqueSurfaceColor,
  type ThemePalette,
} from "./themePalette";
import { type ResolvedTheme } from "./designTokens";
import { type SocialProofSummary } from "./socialProofTypes";
import { deriveSocialProofMomentum } from "./socialProofMomentum";
// ORCH-1340 — the ONE shared disk system (photo|glyph|+N|see-row) for both
// momentum cards; the faceless PersonGlyph now lives inside it.
import { GuestAvatarCluster } from "./GuestAvatarCluster";

// ───────────────────────────── props contract ───────────────────────────────

export interface OfferingMomentumProps {
  palette: ThemePalette;
  theme: ResolvedTheme;
  /** ORCH-1338 payload (props-only — the surface owns the fetch). null → no unit. */
  socialProof: SocialProofSummary | null;
  /**
   * ORCH-1340 — present ⇒ the cluster block becomes ONE pressable group with
   * the visible "See who's going" row (ORCH-1341 wires the consumer sheet,
   * ORCH-1342 the web gate). Absent ⇒ inert cluster: non-pressable, no
   * see-row, NO dead tap (Constitution #1).
   */
  onSeeWhosGoing?: () => void;
  testID?: string;
}

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
  onSeeWhosGoing,
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
      {/* guest cluster (ORCH-1340) — photos ONLY from the server-filtered
          sample via the shared GuestAvatarCluster (single photo owner); glyph
          = loading/fallback/anonymous, private ≡ no-photo by design. D2 —
          privateGuestList suppresses the WHOLE block, see-row included;
          count/sub-line/meter above still render. */}
      {!socialProof.privateGuestList ? (
        <GuestAvatarCluster
          palette={palette}
          theme={theme}
          shownCount={momentum.shownGlyphs}
          overflowCount={momentum.overflowCount}
          goingCount={socialProof.goingCount}
          guestSample={socialProof.sample}
          clusterNote={momentum.clusterNote}
          chipFill={opaqueCardFill(palette)}
          onSeeWhosGoing={onSeeWhosGoing}
          testID="orch-1339-momentum-cluster"
        />
      ) : null}
    </View>
  );
};

OfferingMomentum.displayName = "OfferingMomentum";

// Styles byte-follow RsvpMomentumDecision.styles.momentum/momTop/momCount/
// momLabel/momSub/meterTrack/meterFill so the two momentum cards read
// identically across pages (the disk/chip/note styles live in the shared
// GuestAvatarCluster since ORCH-1340).
const styles = StyleSheet.create({
  momentum: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    // ORCH-1358 — momentum card needs top breathing room from the pill
    // cluster; do not remove marginTop.
    marginTop: 16,
    marginBottom: 16,
    overflow: "hidden",
  },
  momTop: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  momCount: { fontSize: 40, fontWeight: "900", letterSpacing: -1.5, lineHeight: 42 },
  momLabel: { fontSize: 14, fontWeight: "700" },
  momSub: { fontSize: 12, fontWeight: "600", marginTop: 4 },
  meterTrack: { height: 8, borderRadius: 999, marginTop: 14, overflow: "hidden" },
  meterFill: { height: "100%", borderRadius: 999 },
});

export default OfferingMomentum;
