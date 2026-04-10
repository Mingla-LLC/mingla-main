import { useCallback, useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useCoachMarkContext } from '../contexts/CoachMarkContext';

interface UseCoachMarkResult {
  /** true if this component is the current coach target */
  isActive: boolean;
  /** Callback ref — attach to the target element's ref prop */
  targetRef: (node: View | null) => void;
}

/**
 * Hook for target components to register their position with the spotlight system.
 *
 * Usage:
 *   const coach = useCoachMark(2, 19);
 *   return <View ref={coach.targetRef} style={styles.button} />;
 *
 * The SpotlightOverlay reads measurements from context to position
 * the cutout and bubble. No styles are applied to the target element.
 */
export function useCoachMark(stepId: number, targetRadius: number = 8): UseCoachMarkResult {
  const { currentStep, registerTarget, measureVersion } = useCoachMarkContext();
  const nodeRef = useRef<View | null>(null);
  const isActive = currentStep === stepId;

  const measure = useCallback((): void => {
    const node = nodeRef.current;
    if (!node) return;

    node.measureInWindow((x: number, y: number, width: number, height: number) => {
      if (width === 0 && height === 0) return;
      registerTarget(stepId, { x, y, width, height, radius: targetRadius });
    });
  }, [stepId, targetRadius, registerTarget]);

  const targetRef = useCallback((node: View | null): void => {
    nodeRef.current = node;
    if (node) {
      requestAnimationFrame(() => measure());
    }
  }, [measure]);

  // Re-measure when this step becomes active
  useEffect(() => {
    if (isActive && nodeRef.current) {
      const timer = setTimeout(() => measure(), 100);
      return () => clearTimeout(timer);
    }
  }, [isActive, measure]);

  // Re-measure when measureVersion bumps (after scroll settles)
  useEffect(() => {
    if (measureVersion > 0 && isActive && nodeRef.current) {
      const timer = setTimeout(() => measure(), 50);
      return () => clearTimeout(timer);
    }
  }, [measureVersion, isActive, measure]);

  return { isActive, targetRef };
}
