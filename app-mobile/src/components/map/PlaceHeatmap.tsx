import React from 'react';
import { Circle } from 'react-native-maps';
import type { Recommendation } from '../../types/recommendation';

interface PlaceHeatmapProps {
  cards: Recommendation[];
  savedCardIds: Set<string>;
}

export function PlaceHeatmap({ cards, savedCardIds }: PlaceHeatmapProps) {
  const points = cards.filter(c => c.lat != null && c.lng != null);

  if (points.length === 0) return null;

  return (
    <>
      {points.map(c => {
        const isSaved = savedCardIds.has(c.id);
        return (
          <Circle
            key={`heat-${c.id}`}
            center={{ latitude: c.lat!, longitude: c.lng! }}
            radius={isSaved ? 400 : 250}
            fillColor={isSaved ? 'rgba(235,120,37,0.18)' : 'rgba(235,120,37,0.08)'}
            strokeColor="transparent"
            zIndex={-10}
          />
        );
      })}
    </>
  );
}
