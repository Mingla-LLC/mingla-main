import React from 'react';
import { Heatmap } from 'react-native-maps';
import type { Recommendation } from '../../types/recommendation';

interface PlaceHeatmapProps {
  cards: Recommendation[];
  savedCardIds: Set<string>;
}

export function PlaceHeatmap({ cards, savedCardIds }: PlaceHeatmapProps) {
  const points = cards
    .filter(c => c.lat != null && c.lng != null)
    .map(c => ({
      latitude: c.lat!,
      longitude: c.lng!,
      weight: savedCardIds.has(c.id) ? 3 : 1,
    }));

  if (points.length === 0) return null;

  return (
    <Heatmap
      points={points}
      radius={40}
      opacity={0.6}
      gradient={{
        colors: ['#eb782500', '#eb782580', '#eb7825CC', '#eb7825FF'],
        startPoints: [0.01, 0.1, 0.3, 0.6],
        colorMapSize: 256,
      }}
    />
  );
}
