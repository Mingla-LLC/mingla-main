import React, { useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { PlacePinContent } from './PlacePin';
import type { Recommendation } from '../../types/recommendation';

interface AnimatedPlacePinProps {
  card: Recommendation;
  isSaved: boolean;
  isPairedSaved?: boolean;
  isScheduled: boolean;
  isSelected?: boolean;
  onPress: () => void;
  index: number;
}

export const AnimatedPlacePin = React.memo(function AnimatedPlacePin({
  card, isSaved, isPairedSaved = false, isScheduled, isSelected = false, onPress, index,
}: AnimatedPlacePinProps) {
  const scale = useRef(new Animated.Value(0)).current;
  // ORCH-0410: Start TRUE so Android Google Maps creates the initial bitmap.
  // On Android, custom view markers need at least one render pass with
  // tracksViewChanges=true to generate the bitmap. Starting false meant the
  // bitmap was created at scale=0 (invisible) and never updated.
  const [tracking, setTracking] = useState(true);

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
      anchor={{ x: 0.5, y: 0.27 }}
      tappable
    >
      <View collapsable={false}>
        <Animated.View style={{ transform: [{ scale }] }}>
          <PlacePinContent
            card={card}
            isSaved={isSaved}
            isPairedSaved={isPairedSaved}
            isScheduled={isScheduled}
            isSelected={isSelected}
          />
        </Animated.View>
      </View>
    </Marker>
  );
});
