/**
 * GuestAvatarCluster — ORCH-1340 [card-real-avatars] (META-ORCH-1337).
 *
 * THE ONE disk system (photo-in-disk | glyph-in-disk | +N-in-disk | see-row |
 * Pressable group) rendered by BOTH momentum cards (RsvpMomentumDecision +
 * OfferingMomentum). One shared cluster block so the two cards can never drift
 * ("the disk is the atom" — DESIGN §1.1).
 *
 * PAYLOAD IS THE PRIVACY BOUNDARY (I-PROPOSED-1340-GUEST-IDENTITY-PRIVACY-GATED):
 * this component receives ONLY the server-filtered avatar sample
 * (`pg_public_social_proof().sample` — visibility public|friends, avatar-bearing,
 * blocked pairs excluded, empty under privateGuestList). It must never grow a
 * name/username/id prop — names belong to the authed guest-list sheet
 * (ORCH-1341). The glyph disk is the honest loading/fallback/anonymous state,
 * and a PRIVATE guest is visually INDISTINGUISHABLE from a guest with no photo
 * or a failed photo load — exactly ONE glyph-disk treatment exists in this
 * file, deliberately (a dim/badge/"hidden" marker would leak the one bit a
 * private guest chose to hide).
 *
 * Affordance rule (Constitution #1 — no dead taps): `onSeeWhosGoing` present ⇒
 * the WHOLE block is ONE <Pressable> (clusterRow + seeRow, ~60pt ≥44pt target)
 * and the visible "See who's going" row IS the affordance. Absent ⇒ plain
 * non-pressable <View>, NO seeRow, no tap surface at all.
 *
 * Pure: react + react-native + react-native-svg + themePalette/designTokens
 * only. NO data fetch, NO app import (I-MOR-0827-PACKAGE-ISOLATION). Every
 * color is a `palette.*` read (THEME-DIAL — the see-row label is
 * `palette.primaryText`, NOT accent: 13px is below the WCAG large-text
 * threshold and accent only guarantees 3.15:1 vs the page; the accent lives on
 * the chevron, a ≥3:1 UI mark — DESIGN §1.4). Android: photo disks are opaque
 * by nature, the glyph disk is solid accent, and the +N chip fill is
 * HOST-SUPPLIED via `chipFill` (each card passes its own opaqueCardFill result,
 * keeping the Platform switch single-owned in the cards — SPEC §4.2/OQ-2).
 * The photo fade carries `isInteraction: false` (ORCH-1303 starvation class).
 */

import React, { useCallback, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import { boldFontFamily, type ThemePalette } from "./themePalette";
import { type ResolvedTheme } from "./designTokens";
import { type SocialProofSampleEntry } from "./socialProofTypes";

// ─────────────────────────────── glyphs (SVG) ───────────────────────────────

/** FACELESS person glyph — the honest loading/fallback/anonymous disk fill.
 * Moved here from the two momentum cards (the glyph's single home since
 * ORCH-1340; the orch_1340 guard suite pins it in this file). */
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

/** See-row chevron — the accent "go" mark (≥3:1 UI component; DESIGN §1.1). */
const ChevronGlyph: React.FC<{ color: string }> = ({ color }) => (
  <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
    <Path
      d="M9 6l6 6-6 6"
      stroke={color}
      strokeWidth={2.4}
      strokeLinecap="round"
    />
  </Svg>
);

// ───────────────────────────── props contract ───────────────────────────────

export interface GuestAvatarClusterProps {
  palette: ThemePalette;
  theme: ResolvedTheme;
  /** Disk count from the host's derivation (momentum.shownAvatars /
   * shownGlyphs) — disk-count math stays owned by the derivations. */
  shownCount: number;
  /** Drives the "+N" overflow chip (0 → no chip). Unchanged semantics. */
  overflowCount: number;
  /** Confirmed-going headcount — the a11y group label only. */
  goingCount: number;
  /** ORCH-1338 server-filtered sample. Disk i renders `guestSample[i]`'s photo
   * when present, else the glyph (photos lead, glyphs trail — server order). */
  guestSample?: ReadonlyArray<SocialProofSampleEntry>;
  /** The cluster tail note ("are pulling up" …) — each card supplies its own
   * so the 1339 copy table stays the single owner. */
  clusterNote: string;
  /** Opaque "+N" chip fill, HOST-supplied (the card's opaqueCardFill result) —
   * keeps the Android-opaque Platform switch single-owned in the cards. */
  chipFill: string;
  /** Present ⇒ ONE Pressable block + the "See who's going" row. Absent ⇒
   * inert non-pressable View, NO see-row, NO dead tap (DESIGN §1.5). */
  onSeeWhosGoing?: () => void;
  /** Hosts pass their existing cluster testIDs through. */
  testID?: string;
}

// ───────────────────────────── the disk (atom) ──────────────────────────────

/** One 30×30 disk. The glyph renders ALWAYS (it IS the loading state); a photo
 * — when the sample provides one — mounts invisibly above it and fades in on
 * load (160ms, isInteraction:false). onError unmounts the photo permanently:
 * failed ≡ no-photo ≡ private, indistinguishable by design. */
const AvatarDisk: React.FC<{
  palette: ThemePalette;
  avatarUrl: string | null;
  first: boolean;
}> = ({ palette, avatarUrl, first }) => {
  const [failed, setFailed] = useState<boolean>(false);
  const fade = useRef(new Animated.Value(0)).current;

  const handleLoad = useCallback((): void => {
    Animated.timing(fade, {
      toValue: 1,
      duration: 160,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
      // ORCH-1303 — scheduling-only flag; a timing without it can transiently
      // hold an InteractionManager handle (web: useNativeDriver nullified ⇒
      // isInteraction defaults TRUE) and re-starve runAfterInteractions.
      isInteraction: false,
    }).start();
  }, [fade]);
  const handleError = useCallback((): void => setFailed(true), []);

  const showPhoto = avatarUrl !== null && avatarUrl.length > 0 && !failed;

  return (
    <View
      style={[
        styles.disk,
        {
          backgroundColor: palette.accent,
          borderColor: palette.page,
          marginLeft: first ? 0 : -8,
        },
      ]}
    >
      <PersonGlyph color={palette.accentText} />
      {showPhoto ? (
        <Animated.View style={[styles.photoLayer, { opacity: fade }]}>
          <Image
            source={{ uri: avatarUrl }}
            style={styles.photo}
            resizeMode="cover"
            onLoad={handleLoad}
            onError={handleError}
          />
          <View
            pointerEvents="none"
            style={[styles.photoHairline, { borderColor: palette.panelBorder }]}
          />
        </Animated.View>
      ) : null}
    </View>
  );
};

// ─────────────────────────────── component ──────────────────────────────────

export const GuestAvatarCluster: React.FC<GuestAvatarClusterProps> = ({
  palette,
  theme,
  shownCount,
  overflowCount,
  goingCount,
  guestSample = [],
  clusterNote,
  chipFill,
  onSeeWhosGoing,
  testID,
}) => {
  const boldFamily = boldFontFamily(theme);

  const clusterRow = (
    <View style={styles.clusterRow}>
      {Array.from({ length: shownCount }).map((_, i) => (
        <AvatarDisk
          key={i}
          palette={palette}
          avatarUrl={guestSample[i]?.avatarUrl ?? null}
          first={i === 0}
        />
      ))}
      {overflowCount > 0 ? (
        <View
          style={[
            styles.disk,
            { backgroundColor: chipFill, borderColor: palette.page, marginLeft: -8 },
          ]}
        >
          <Text style={[styles.chipText, { color: palette.secondaryText }]}>
            +{overflowCount}
          </Text>
        </View>
      ) : null}
      <Text style={[styles.note, { color: palette.tertiaryText }]}>
        {clusterNote}
      </Text>
    </View>
  );

  if (onSeeWhosGoing === undefined) {
    // Inert cluster — today's plain View, no see-row, no tap surface at all.
    return (
      <View
        style={styles.clusterBlock}
        accessibilityLabel={`${goingCount} people going`}
        testID={testID}
      >
        {clusterRow}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onSeeWhosGoing}
      accessibilityRole="button"
      accessibilityLabel={`${goingCount} going. See who's going`}
      style={({ pressed }) => [styles.clusterBlock, pressed ? styles.pressed : null]}
      testID={testID}
    >
      {/* The group label carries everything — disks + note + label are hidden
          from the a11y tree (3 unlabeled disks would be screen-reader noise). */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {clusterRow}
        <View style={styles.seeRow}>
          <Text
            style={[
              styles.seeLabel,
              { color: palette.primaryText, fontFamily: boldFamily },
            ]}
          >
            See who's going
          </Text>
          <ChevronGlyph color={palette.accent} />
        </View>
      </View>
    </Pressable>
  );
};

GuestAvatarCluster.displayName = "GuestAvatarCluster";

const styles = StyleSheet.create({
  // marginTop 14 moved here off the old cards' cluster style — the meter→cluster
  // rhythm stays byte-identical (DESIGN §1.1).
  clusterBlock: { marginTop: 14 },
  pressed: { opacity: 0.7 },
  clusterRow: { flexDirection: "row", alignItems: "center" },
  disk: {
    width: 30,
    height: 30,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  photoLayer: { ...StyleSheet.absoluteFillObject },
  photo: { ...StyleSheet.absoluteFillObject },
  photoHairline: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontSize: 11, fontWeight: "800" },
  note: { marginLeft: 12, fontSize: 12, fontWeight: "600" },
  seeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 10,
    minHeight: 20,
  },
  seeLabel: { fontSize: 13, letterSpacing: 0.2 },
});

export default GuestAvatarCluster;
