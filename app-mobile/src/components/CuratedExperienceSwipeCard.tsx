import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CuratedExperienceCard } from '../types/curatedExperience';

interface Props {
  card: CuratedExperienceCard;
  onSeePlan: () => void;
}

export function CuratedExperienceSwipeCard({ card, onSeePlan }: Props) {
  const avgRating = (card.stops.reduce((s, st) => s + st.rating, 0) / card.stops.length).toFixed(1);
  const durationHrs = (card.estimatedDurationMinutes / 60).toFixed(1);
  const priceText =
    card.totalPriceMin === 0 && card.totalPriceMax === 0
      ? 'Free'
      : `$${card.totalPriceMin}–${card.totalPriceMax}`;

  return (
    <View style={styles.card}>
      {/* 3-image horizontal strip */}
      <View style={styles.imageStrip}>
        {card.stops.map((stop, idx) => (
          <View key={stop.placeId} style={styles.imageWrapper}>
            {stop.imageUrl ? (
              <Image
                source={{ uri: stop.imageUrl }}
                style={styles.stopImage}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.stopImage, styles.imagePlaceholder]} />
            )}
            <View style={styles.stopBadge}>
              <Text style={styles.stopBadgeText}>{idx + 1}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* Card info */}
      <View style={styles.infoSection}>
        {/* Category badge */}
        <View style={styles.categoryBadge}>
          <Ionicons name="compass-outline" size={12} color="#fff" />
          <Text style={styles.categoryText}>Adventurous</Text>
          <Text style={styles.stopCountText}> · {card.stops.length} stops</Text>
        </View>

        {/* Title */}
        <Text style={styles.title} numberOfLines={2}>
          {card.title}
        </Text>

        {/* Meta row */}
        <View style={styles.metaRow}>
          <Text style={styles.metaText}>{priceText}</Text>
          <Text style={styles.metaDot}> · </Text>
          <Text style={styles.metaText}>~{durationHrs} hrs</Text>
          <Text style={styles.metaDot}> · </Text>
          <Ionicons name="star" size={11} color="#F59E0B" />
          <Text style={styles.metaText}> {avgRating} avg</Text>
        </View>

        {/* CTA */}
        <TouchableOpacity style={styles.ctaButton} onPress={onSeePlan} activeOpacity={0.85}>
          <Text style={styles.ctaText}>See Full Plan</Text>
          <Ionicons name="arrow-forward" size={16} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: '#1C1C1E',
    borderRadius: 20,
    overflow: 'hidden',
  },
  imageStrip: {
    flexDirection: 'row',
    flex: 0.55,
  },
  imageWrapper: {
    flex: 1,
    position: 'relative',
  },
  stopImage: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    backgroundColor: '#2C2C2E',
  },
  stopBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  infoSection: {
    flex: 0.45,
    padding: 12,
    gap: 6,
    justifyContent: 'center',
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F59E0B',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  categoryText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  stopCountText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11,
    fontWeight: '500',
  },
  title: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 22,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
  },
  metaDot: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 13,
  },
  ctaButton: {
    backgroundColor: '#F59E0B',
    borderRadius: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
  },
  ctaText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
