import { useRef, useCallback, useEffect } from 'react';
import { View } from 'react-native';
import { useCoachMarkStore } from '../store/coachMarkStore';

/**
 * Hook for components to register their position as a coach mark target.
 *
 * Returns a ref and onLayout handler. Attach both to the View you want to spotlight.
 *
 * Usage:
 *   const { ref, onLayout } = useCoachMarkTarget('explore-preferences-gear');
 *   <Pressable ref={ref} onLayout={onLayout} ...>
 */
export function useCoachMarkTarget(elementId: string) {
  const ref = useRef<View>(null);
  const registerTarget = useCoachMarkStore(s => s.registerTarget);
  const unregisterTarget = useCoachMarkStore(s => s.unregisterTarget);

  useEffect(() => {
    return () => unregisterTarget(elementId);
  }, [elementId, unregisterTarget]);

  const onLayout = useCallback(() => {
    ref.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) {
        registerTarget(elementId, { x, y, width, height }, ref);
      }
    });
  }, [elementId, registerTarget]);

  return { ref, onLayout };
}
