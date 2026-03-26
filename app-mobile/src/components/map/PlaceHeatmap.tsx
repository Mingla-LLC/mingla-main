import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Marker } from 'react-native-maps';
import type { Recommendation } from '../../types/recommendation';

interface PlaceHeatmapProps {
  cards: Recommendation[];
  savedCardIds: Set<string>;
}

// Uses Marker + View instead of native Circle to avoid native component crashes
// on Expo Go / dev builds without native rebuild.
export function PlaceHeatmap({ cards, savedCardIds }: PlaceHeatmapProps) {
  const points = cards.filter(c => c.lat != null && c.lng != null);

  if (points.length === 0) return null;

  return (
    <>
      {points.map(c => {
        const isSaved = savedCardIds.has(c.id);
        return (
          <Marker
            key={`heat-${c.id}`}
            coordinate={{ latitude: c.lat!, longitude: c.lng! }}
            tracksViewChanges={false}
            anchor={{ x: 0.5, y: 0.5 }}
            opacity={0.3}
          >
            <View style={[
              styles.heatDot,
              isSaved ? styles.heatDotSaved : styles.heatDotNormal,
            ]} />
          </Marker>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  heatDot: {
    borderRadius: 999,
  },
  heatDotNormal: {
    width: 24,
    height: 24,
    backgroundColor: 'rgba(235,120,37,0.35)',
  },
  heatDotSaved: {
    width: 32,
    height: 32,
    backgroundColor: 'rgba(235,120,37,0.5)',
  },
});
