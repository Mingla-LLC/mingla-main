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

export const AnimatedPlacePin = React.memo(function AnimatedPlacePin({
  card, isSaved, isScheduled, onPress, index,
}: AnimatedPlacePinProps) {
  const scale = useRef(new Animated.Value(0)).current;
  // Start false — only enable during the 300ms spring window
  const [tracking, setTracking] = useState(false);

  useEffect(() => {
    const delay = Math.min(index * 50, 500);
    const timer = setTimeout(() => {
      setTracking(true); // enable before animation
      Animated.spring(scale, {
        toValue: 1,
        friction: 6,
        tension: 80,
        useNativeDriver: true,
      }).start(() => {
        setTracking(false); // disable after animation
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [index, scale]);

  if (card.lat == null || card.lng == null) return null;

  return (
    <Marker
      coordinate={{ latitude: card.lat, longitude: card.lng }}
      onPress={onPress}
      tracksViewChanges={tracking}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <PlacePinContent card={card} isSaved={isSaved} isScheduled={isScheduled} />
      </Animated.View>
    </Marker>
  );
});
