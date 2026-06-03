/**
 * CollabLocationChips — ORCH-1058 [Collab deck location chips + smarter no-overlap feedback]
 *
 * A read-only row of status chips for the collab-deck `intersection_empty`
 * empty state. One chip per participant; chips are separated by SPACING ONLY
 * (a row gap) — ORCH-1059 removed the inter-chip bullet/period separator that
 * earlier shipped. These are STATUS chips, not pressable filters — no press
 * state, no sheet.
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

// ORCH-1059: chips are separated by spacing only — no bullet glyph, no period
// separator. The container's `gap` provides even horizontal + vertical spacing
// across wrapped rows, so VoiceOver reads each chip's a11yLabel cleanly with no
// decorative punctuation to hide.
export const CollabLocationChips: React.FC<CollabLocationChipsProps> = ({ chips }) => {
  if (chips.length === 0) return null;
  return (
    <View style={styles.container}>
      {chips.map((chip) => (
        <SingleChip key={chip.id} chip={chip} />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    // ORCH-1059: gap-only separation (no bullet). rowGap handles wrapped lines,
    // columnGap handles between-chip horizontal spacing.
    rowGap: spacing.sm,
    columnGap: spacing.sm,
    marginTop: spacing.sm,
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
});

export default CollabLocationChips;
