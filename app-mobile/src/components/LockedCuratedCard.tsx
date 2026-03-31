import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { BlurView } from 'expo-blur';
import { Icon } from './ui/Icon';
import type { CuratedExperienceCard } from '../types/curatedExperience';
import { colors, spacing, radius, typography, fontWeights } from '../constants/designSystem';

// ─────────────────────────────────────────────────────────────────────────────
// Icon map (mirrors CuratedExperienceSwipeCard)
// ─────────────────────────────────────────────────────────────────────────────

const CURATED_ICON_MAP: Record<string, string> = {
  'Adventurous':   'compass-outline',
  'First Date':    'sparkles',
  'Romantic':      'heart',
  'Group Fun':     'people',
  'Picnic Dates':  'sandwich',
  'Take a Stroll': 'walk-outline',
};

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface LockedCuratedCardProps {
  card: CuratedExperienceCard;
  onUpgrade: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A blurred, locked overlay for curated experience cards.
 * Shows a teaser (title, category, stop count, price range) behind a blur
 * layer with a prominent "Unlock with Pro" CTA.
 */
export function LockedCuratedCard({ card, onUpgrade }: LockedCuratedCardProps) {
  const categoryLabel = card.categoryLabel || 'Adventurous';
  const categoryIcon = CURATED_ICON_MAP[categoryLabel] || 'compass-outline';
  const stopCount = card.stops?.length ?? 0;

  // Use teaser text (set by server for free users), never reveal the real title
  const teaserText = card.teaserText
    || (card._locked && card.title) // server already replaced title with teaser
    || `A ${categoryLabel.toLowerCase()} experience with ${stopCount} curated stops`;

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.9}
      onPress={onUpgrade}
    >
      {/* Background blur layer */}
      <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />

      {/* Dark overlay */}
      <View style={styles.darkOverlay} />

      {/* Content */}
      <View style={styles.content}>
        {/* Category badge */}
        <View style={styles.categoryBadge}>
          <Icon name={categoryIcon} size={12} color="#fff" />
          <Text style={styles.categoryText}>{categoryLabel}</Text>
        </View>

        {/* Stop count pill */}
        <View style={styles.stopPill}>
          <Icon name="location-outline" size={12} color="#fff" />
          <Text style={styles.stopPillText}>
            {stopCount} {stopCount === 1 ? 'spot' : 'stops'}
          </Text>
        </View>

        {/* Teaser title — never the real itinerary name */}
        <Text style={styles.teaserText} numberOfLines={2}>
          {teaserText}
        </Text>

        {/* Lock icon */}
        <Icon
          name="lock-closed"
          size={32}
          color="rgba(255,255,255,0.6)"
          style={styles.lockIcon}
        />

        {/* CTA button */}
        <View style={styles.ctaButton}>
          <Icon name="lock-open-outline" size={16} color="#fff" />
          <Text style={styles.ctaText}>Unlock with Pro</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: '#1C1C1E',
    borderRadius: 20,
    overflow: 'hidden',
  },
  darkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245,158,11,0.8)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    gap: 4,
  },
  categoryText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: fontWeights.bold,
    letterSpacing: 0.3,
  },
  stopPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    gap: 4,
  },
  stopPillText: {
    color: '#fff',
    fontSize: typography.xs.fontSize,
    fontWeight: fontWeights.medium,
  },
  teaserText: {
    color: '#fff',
    fontSize: typography.md.fontSize,
    fontWeight: fontWeights.semibold,
    textAlign: 'center',
    lineHeight: typography.md.lineHeight,
    marginVertical: spacing.xs,
  },
  lockIcon: {
    marginVertical: spacing.sm,
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary[500],
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  ctaText: {
    color: '#fff',
    fontSize: typography.md.fontSize,
    fontWeight: fontWeights.bold,
  },
});
