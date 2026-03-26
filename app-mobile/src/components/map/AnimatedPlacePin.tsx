import React, { useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';
import { Marker } from 'react-native-maps';
import { PlacePinContent } from './PlacePin';
import type { Recommendation } from '../../types/recommendation';

interface AnimatedPlacePinProps {
  card: Recommendation;
  isSaved: boolean;
  isScheduled: boolean;
  onPress: () => void;
  index: number;
}

export function AnimatedPlacePin({ card, isSaved, isScheduled, onPress, index }: AnimatedPlacePinProps) {
  const scale = useRef(new Animated.Value(0)).current;
  const [animating, setAnimating] = useState(true);

  useEffect(() => {
    const delay = Math.min(index * 50, 500);
    const timer = setTimeout(() => {
      Animated.spring(scale, {
        toValue: 1,
        friction: 6,
        tension: 80,
        useNativeDriver: true,
      }).start(() => {
        setAnimating(false);
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [index, scale]);

  if (card.lat == null || card.lng == null) return null;

  return (
    <Marker
      coordinate={{ latitude: card.lat, longitude: card.lng }}
      onPress={onPress}
      tracksViewChanges={animating}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <PlacePinContent card={card} isSaved={isSaved} isScheduled={isScheduled} />
      </Animated.View>
    </Marker>
  );
}
