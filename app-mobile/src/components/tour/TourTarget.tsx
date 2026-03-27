import React, { useCallback, useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useAppStore } from '../../store/appStore';
import { useTourTargets } from '../../contexts/TourTargetContext';

interface TourTargetProps {
  id: string;
  children: React.ReactNode;
  active?: boolean;
}

/**
 * Wraps children in a View that measures its absolute screen position
 * and reports it to TourTargetContext for spotlight overlay positioning.
 * Only measures when the tour is active (or when `active` prop is true).
 */
export function TourTarget({ id, children, active }: TourTargetProps) {
  const tourMode = useAppStore((s) => s.tourMode);
  const { registerTarget, unregisterTarget } = useTourTargets();
  const viewRef = useRef<View>(null);
  const shouldMeasure = active ?? tourMode;

  const measure = useCallback(() => {
    if (!shouldMeasure || !viewRef.current) return;
    viewRef.current.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) {
        registerTarget(id, { x, y, width, height });
      }
    });
  }, [shouldMeasure, id, registerTarget]);

  useEffect(() => {
    if (shouldMeasure) {
      // Delay initial measurement to ensure layout is complete
      const timer = setTimeout(measure, 100);
      return () => clearTimeout(timer);
    } else {
      unregisterTarget(id);
    }
  }, [shouldMeasure, measure, id, unregisterTarget]);

  const handleLayout = useCallback(() => {
    if (shouldMeasure) {
      // Re-measure on layout changes
      requestAnimationFrame(() => measure());
    }
  }, [shouldMeasure, measure]);

  return (
    <View ref={viewRef} onLayout={handleLayout} collapsable={false}>
      {children}
    </View>
  );
}
