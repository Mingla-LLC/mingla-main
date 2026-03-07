import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { useCoachMarkStore } from '../../store/coachMarkStore';
import { useCoachMarkEngine } from '../../hooks/useCoachMarkEngine';
import { coachMarkService } from '../../services/coachMarkService';
import { mixpanelService } from '../../services/mixpanelService';
import { COACH_MARKS, MILESTONES } from '../../constants/coachMarks';
import { MilestoneDefinition } from '../../types/coachMark';
import { CoachMarkOverlay } from './CoachMarkOverlay';
import { MilestoneCelebration } from './MilestoneCelebration';

interface CoachMarkContextValue {
  fireAction: (actionName: string) => void;
  fireElementVisible: (elementId: string) => void;
}

const CoachMarkContext = createContext<CoachMarkContextValue>({
  fireAction: () => {},
  fireElementVisible: () => {},
});

export function useCoachMarkActions() {
  return useContext(CoachMarkContext);
}

interface CoachMarkProviderProps {
  children: React.ReactNode;
  currentPage: string;
  userId: string | undefined;
}

export function CoachMarkProvider({
  children,
  currentPage,
  userId,
}: CoachMarkProviderProps) {
  const { fireAction, fireElementVisible } = useCoachMarkEngine(currentPage);
  const [activeMilestone, setActiveMilestone] = useState<MilestoneDefinition | null>(null);

  // Track when a coach mark becomes visible
  const isVisible = useCoachMarkStore(s => s.isVisible);
  const currentMark = useCoachMarkStore(s => s.currentMark);

  useEffect(() => {
    if (isVisible && currentMark) {
      mixpanelService.trackCoachMarkShown(currentMark.id, currentMark.group);
    }
  }, [isVisible, currentMark?.id]);

  // Hydrate from Supabase on mount (once)
  useEffect(() => {
    if (!userId) return;
    coachMarkService.getCompletedIds(userId).then(ids => {
      useCoachMarkStore.getState().hydrate(ids);
    });
  }, [userId]);

  // Sync completions to Supabase (fire-and-forget on each new completion)
  // Gate on isHydrated to prevent redundant INSERTs during boot:
  // AsyncStorage rehydrates completedIds before Supabase fetch completes,
  // which would trigger this effect for IDs that are already persisted.
  const prevCompletedRef = useRef<string[]>([]);
  const completedIds = useCoachMarkStore(s => s.completedIds);
  const isHydrated = useCoachMarkStore(s => s.isHydrated);

  useEffect(() => {
    if (!userId || !isHydrated) return;

    // Seed prevCompletedRef on first run after hydration to avoid
    // treating all hydrated IDs as "new"
    if (prevCompletedRef.current.length === 0 && completedIds.length > 0) {
      prevCompletedRef.current = completedIds;
      return;
    }

    const newIds = completedIds.filter(
      id => !prevCompletedRef.current.includes(id)
    );
    if (newIds.length > 0) {
      // If many IDs appeared at once, it's a group skip
      const isGroupSkip = newIds.length > 2;

      newIds.forEach(id => {
        coachMarkService.markCompleted(userId, id);

        // Skip milestone synthetic keys for individual tracking
        if (id.startsWith('milestone_')) return;

        // Look up group from the registry
        const markDef = Object.values(COACH_MARKS).find(m => m.id === id);
        const group = markDef?.group ?? 'unknown';

        if (!isGroupSkip) {
          mixpanelService.trackCoachMarkCompleted(id, group);
        }
      });

      // Track group skip as a single event
      if (isGroupSkip) {
        const firstMark = Object.values(COACH_MARKS).find(m => newIds.includes(m.id));
        if (firstMark) {
          mixpanelService.trackCoachMarkGroupSkipped(firstMark.group);
        }
      }
    }
    prevCompletedRef.current = completedIds;
  }, [completedIds, userId, isHydrated]);

  // App lifecycle: track background/foreground for session reset
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'background' || state === 'inactive') {
        useCoachMarkStore.getState().setBackgrounded();
      } else if (state === 'active') {
        useCoachMarkStore.getState().resetSession();
      }
    });
    return () => subscription.remove();
  }, []);

  // Check milestones after each completion
  useEffect(() => {
    if (completedIds.length === 0) return;

    for (const milestone of MILESTONES) {
      const milestoneKey = `milestone_${milestone.id}`;

      // Skip if milestone already celebrated
      if (completedIds.includes(milestoneKey)) continue;

      // Check if all required marks are completed
      const allCompleted = milestone.requiredIds.every(
        id => completedIds.includes(id)
      );

      if (allCompleted) {
        // Mark milestone as "completed" to prevent re-showing
        useCoachMarkStore.getState().markCompleted(milestoneKey);
        // Track and show celebration
        mixpanelService.trackMilestoneReached(milestone.id);
        setActiveMilestone(milestone);
        break; // Only one milestone at a time
      }
    }
  }, [completedIds]);

  const handleMilestoneDismiss = useCallback(() => {
    setActiveMilestone(null);
  }, []);

  return (
    <CoachMarkContext.Provider value={{ fireAction, fireElementVisible }}>
      {children}
      <CoachMarkOverlay />
      <MilestoneCelebration
        milestone={activeMilestone}
        onDismiss={handleMilestoneDismiss}
      />
    </CoachMarkContext.Provider>
  );
}
