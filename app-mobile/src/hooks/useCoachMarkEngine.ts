import { useEffect, useCallback } from 'react';
import { COACH_MARKS } from '../constants/coachMarks';
import { useCoachMarkStore } from '../store/coachMarkStore';

/**
 * The brain of the education system.
 * Evaluates triggers, manages queue, coordinates showing coach marks.
 *
 * Call this hook ONCE at the top level (inside CoachMarkProvider).
 * Uses getState() inside callbacks to avoid stale closure bugs.
 */
export function useCoachMarkEngine(currentPage: string) {
  // On currentPage change: evaluate tab_first_visit triggers
  useEffect(() => {
    if (!currentPage) return;

    const state = useCoachMarkStore.getState();

    // Don't evaluate if not hydrated yet
    if (!state.isHydrated) return;

    // Record the tab visit
    state.recordTabVisit(currentPage);

    // Find all marks triggered by this tab that haven't been completed
    const eligible = Object.values(COACH_MARKS).filter(mark =>
      mark.trigger.type === 'tab_first_visit' &&
      mark.trigger.value === currentPage &&
      !state.completedIds.includes(mark.id) &&
      mark.prerequisites.every(prereq => state.completedIds.includes(prereq))
    );

    // Sort by priority, enqueue
    eligible
      .sort((a, b) => a.priority - b.priority)
      .forEach(mark => state.enqueue(mark));

    // Trigger showNext after the first eligible mark's delay
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (eligible.length > 0 && !state.isVisible && !state.cooldownActive) {
      const firstMark = eligible.sort((a, b) => a.priority - b.priority)[0];
      timer = setTimeout(() => useCoachMarkStore.getState().showNext(), firstMark.delay);
    }
    return () => { if (timer) clearTimeout(timer); };
  }, [currentPage]);

  // Re-evaluate when hydration completes
  const isHydrated = useCoachMarkStore(s => s.isHydrated);
  useEffect(() => {
    if (!isHydrated || !currentPage) return;

    const state = useCoachMarkStore.getState();
    const eligible = Object.values(COACH_MARKS).filter(mark =>
      mark.trigger.type === 'tab_first_visit' &&
      mark.trigger.value === currentPage &&
      !state.completedIds.includes(mark.id) &&
      mark.prerequisites.every(prereq => state.completedIds.includes(prereq))
    );

    eligible
      .sort((a, b) => a.priority - b.priority)
      .forEach(mark => state.enqueue(mark));

    let timer: ReturnType<typeof setTimeout> | null = null;
    if (eligible.length > 0 && !state.isVisible && !state.cooldownActive) {
      const firstMark = eligible[0];
      timer = setTimeout(() => useCoachMarkStore.getState().showNext(), firstMark.delay);
    }
    return () => { if (timer) clearTimeout(timer); };
  }, [isHydrated]);

  // Action trigger — exposed for components
  const fireAction = useCallback((actionName: string) => {
    const state = useCoachMarkStore.getState();

    if (!state.isHydrated) return;

    state.recordAction(actionName);

    const eligible = Object.values(COACH_MARKS).filter(mark =>
      mark.trigger.type === 'action' &&
      mark.trigger.value === actionName &&
      !state.completedIds.includes(mark.id) &&
      mark.prerequisites.every(prereq => state.completedIds.includes(prereq))
    );

    eligible
      .sort((a, b) => a.priority - b.priority)
      .forEach(mark => state.enqueue(mark));

    if (eligible.length > 0 && !state.isVisible && !state.cooldownActive) {
      const firstMark = eligible[0];
      setTimeout(() => useCoachMarkStore.getState().showNext(), firstMark.delay);
    }
  }, []);

  // Element visibility trigger — exposed for components
  const fireElementVisible = useCallback((elementId: string) => {
    const state = useCoachMarkStore.getState();

    if (!state.isHydrated) return;

    const eligible = Object.values(COACH_MARKS).filter(mark =>
      mark.trigger.type === 'element_first_visible' &&
      mark.trigger.value === elementId &&
      !state.completedIds.includes(mark.id) &&
      mark.prerequisites.every(prereq => state.completedIds.includes(prereq))
    );

    eligible
      .sort((a, b) => a.priority - b.priority)
      .forEach(mark => state.enqueue(mark));

    if (eligible.length > 0 && !state.isVisible && !state.cooldownActive) {
      const firstMark = eligible[0];
      setTimeout(() => useCoachMarkStore.getState().showNext(), firstMark.delay);
    }
  }, []);

  return { fireAction, fireElementVisible };
}
