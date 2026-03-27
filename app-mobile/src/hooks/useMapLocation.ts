import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import { supabase } from '../services/supabase';
import { useAppStore } from '../store/appStore';

export function useMapLocation(enabled: boolean) {
  const tourMode = useAppStore((s) => s.tourMode);
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const lastUpdateRef = useRef<number>(0);

  useEffect(() => {
    // Tour mode: skip GPS tracking entirely
    if (!enabled || tourMode) {
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
      return;
    }

    (async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') return;

      subscriptionRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 100,
          timeInterval: 60_000,
        },
        (location) => {
          const now = Date.now();
          if (now - lastUpdateRef.current < 60_000) return;
          lastUpdateRef.current = now;

          supabase.functions.invoke('update-map-location', {
            body: {
              lat: location.coords.latitude,
              lng: location.coords.longitude,
            },
          }).catch(() => {});
        }
      );
    })();

    return () => {
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
    };
  }, [enabled, tourMode]);
}
