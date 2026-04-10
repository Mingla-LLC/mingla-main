import { useCallback, useRef } from 'react';
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
  const { currentStep, registerTarget } = useCoachMarkContext();
  const nodeRef = useRef<View | null>(null);

  const measure = useCallback((): void => {
    const node = nodeRef.current;
    if (!node) return;

    // measureInWindow gives coordinates relative to the screen — exactly
    // what we need for the absolute-positioned overlay.
    node.measureInWindow((x: number, y: number, width: number, height: number) => {
      // Guard against unmounted/off-screen elements returning 0,0,0,0
      if (width === 0 && height === 0) return;

      registerTarget(stepId, { x, y, width, height, radius: targetRadius });
    });
  }, [stepId, targetRadius, registerTarget]);

  const targetRef = useCallback((node: View | null): void => {
    nodeRef.current = node;
    if (node) {
      // Measure after a frame to ensure layout is complete
      requestAnimationFrame(() => {
        measure();
      });

      // Also listen for layout changes and re-measure
      // We use a small timeout to batch multiple rapid layout events
      const originalOnLayout = (node as any).props?.onLayout;
      if (!originalOnLayout) {
        // Set onLayout via the ref approach — measure on every layout change
        // This is handled by the component attaching onLayout itself
      }
    }
  }, [measure]);

  const isActive = currentStep === stepId;

  return { isActive, targetRef };
}
