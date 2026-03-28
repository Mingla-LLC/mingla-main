import React, { useCallback, useEffect, useRef } from 'react';
import { View, ViewStyle } from 'react-native';
import { useAppStore } from '../../store/appStore';
import { useTourTargets } from '../../contexts/TourTargetContext';

interface Insets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

interface TourTargetProps {
  id: string;
  children: React.ReactNode;
  active?: boolean;
  style?: ViewStyle;
  /** Shrink the measured spotlight rectangle inward. Positive values crop. */
  inset?: Insets;
}

/**
 * Wraps children in a View that measures its absolute screen position
 * and reports it to TourTargetContext for spotlight overlay positioning.
 * Only measures when the tour is active (or when `active` prop is true).
 *
 * Use the `inset` prop to tighten the spotlight around the key content
 * when the wrapper is larger than the element being described.
 */
export function TourTarget({ id, children, active, style, inset }: TourTargetProps) {
  const tourMode = useAppStore((s) => s.tourMode);
  const { registerTarget, unregisterTarget } = useTourTargets();
  const viewRef = useRef<View>(null);
  const shouldMeasure = active ?? tourMode;

  const measure = useCallback(() => {
    if (!shouldMeasure || !viewRef.current) return;
    viewRef.current.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) {
        const t = inset?.top ?? 0;
        const r = inset?.right ?? 0;
        const b = inset?.bottom ?? 0;
        const l = inset?.left ?? 0;
        registerTarget(id, {
          x: x + l,
          y: y + t,
          width: Math.max(1, width - l - r),
          height: Math.max(1, height - t - b),
        });
      }
    });
  }, [shouldMeasure, id, registerTarget, inset?.top, inset?.right, inset?.bottom, inset?.left]);

  useEffect(() => {
    if (shouldMeasure) {
      // Delay initial measurement to ensure layout is complete
      const timer = setTimeout(measure, 100);
      return () => {
        clearTimeout(timer);
        unregisterTarget(id);
      };
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
    <View ref={viewRef} onLayout={handleLayout} collapsable={false} style={style}>
      {children}
    </View>
  );
}
