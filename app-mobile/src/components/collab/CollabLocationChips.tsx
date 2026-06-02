/**
 * CollabLocationChips — ORCH-1058 [Collab deck location chips + smarter no-overlap feedback]
 *
 * A read-only row of status chips for the collab-deck `intersection_empty`
 * empty state. One chip per participant; chips are separated by a bullet `•`.
 * These are STATUS chips, not pressable filters — no press state, no sheet.
 *
 * Styled entirely from the canonical `glass.discover.chip` tokens (same block
 * TripFilterChips uses) — no new visual system, no hardcoded colors. Honors
 * the Android opaque-glass fallback. Spec §4 + §8.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Icon, type IconName } from '../ui/Icon';
import {
  glass,
  spacing,
  ANDROID_GLASS_USES_OPAQUE_FALLBACK,
} from '../../constants/designSystem';
import type { ParticipantLocationKind } from '../../utils/formatLocationLabel';

const g = glass.discover;
const isAndroidOpaque = ANDROID_GLASS_USES_OPAQUE_FALLBACK;

export type CollabLocationChip = {
  id: string;
  /** Visible label (City/ST, GPS phrase, or pending phrase). */
  label: string;
  kind: ParticipantLocationKind;
  /** Screen-reader label, e.g. "Maya: Raleigh, North Carolina". */
  a11yLabel: string;
};

interface CollabLocationChipsProps {
  chips: CollabLocationChip[];
}

// Leading glyph per kind. GPS vs place vs pending is legible without color
// (accessibility-safe). `locate-outline`/`resize-outline` from the spec are not
// in the ICON_MAP; `hourglass-outline` is the mapped "waiting" glyph.
const ICON_BY_KIND: Record<ParticipantLocationKind, IconName> = {
  gps: 'navigate-outline',
  place: 'location-outline',
  pending: 'hourglass-outline',
};

const SingleChip: React.FC<{ chip: CollabLocationChip }> = ({ chip }) => (
  <View
    style={styles.chip}
    accessible
    accessibilityLabel={chip.a11yLabel}
  >
    <Icon
      name={ICON_BY_KIND[chip.kind]}
      size={14}
      color={g.chip.inactive.labelColor}
    />
    <Text style={styles.chipLabel} numberOfLines={1}>
      {chip.label}
    </Text>
  </View>
);

// The bullet is decorative punctuation — hidden from the a11y tree so VoiceOver
// reads "Raleigh, NC. London, UK." not "...bullet...".
const BulletSeparator: React.FC = () => (
  <Text
    style={styles.bullet}
    accessibilityElementsHidden
    importantForAccessibility="no"
  >
    {'•'}
  </Text>
);

export const CollabLocationChips: React.FC<CollabLocationChipsProps> = ({ chips }) => {
  if (chips.length === 0) return null;
  return (
    <View style={styles.container}>
      {chips.map((chip, index) =>
        index === 0 ? (
          <SingleChip key={chip.id} chip={chip} />
        ) : (
          // Group bullet+chip in a non-wrapping inner row so a bullet never
          // orphans at the start of a wrapped line (spec §4 layout).
          <View key={chip.id} style={styles.pairGroup}>
            <BulletSeparator />
            <SingleChip chip={chip} />
          </View>
        ),
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    rowGap: spacing.sm,
    marginTop: spacing.sm,
  },
  pairGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: g.chip.iconLabelGap,
    height: g.chip.height,
    borderRadius: g.chip.radius,
    paddingHorizontal: g.chip.paddingHorizontal,
    backgroundColor: isAndroidOpaque
      ? g.chip.inactive.fallbackSolid
      : g.chip.inactive.bg,
    borderWidth: 1,
    borderColor: g.chip.inactive.border,
    overflow: 'hidden',
  },
  chipLabel: {
    fontSize: g.chip.labelFontSize,
    fontWeight: g.chip.labelFontWeight,
    color: g.chip.inactive.labelColor,
    maxWidth: 160,
  },
  bullet: {
    color: 'rgba(255, 255, 255, 0.40)',
    fontSize: 14,
    marginHorizontal: spacing.sm,
  },
});

export default CollabLocationChips;
