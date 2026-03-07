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
import { COACH_MARKS, MILESTONES, TUTORIAL_SEQUENCE } from '../../constants/coachMarks';
import { MilestoneDefinition, TutorialPage } from '../../types/coachMark';
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
  onNavigate?: (page: TutorialPage) => void;
}

export function CoachMarkProvider({
  children,
  currentPage,
  userId,
  onNavigate,
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

  // ═══════════════════════════════════════
  // Tutorial auto-navigation orchestration
  // ═══════════════════════════════════════

  const isTutorialMode = useCoachMarkStore(s => s.isTutorialMode);
  const tutorialPendingPage = useCoachMarkStore(s => s.tutorialPendingPage);
  const replayPendingPage = useCoachMarkStore(s => s.replayPendingPage);
  const replayMarkId = useCoachMarkStore(s => s.replayMarkId);

  // Auto-start tutorial on first launch after hydration
  const tutorialCompleted = useCoachMarkStore(s => s.tutorialCompleted);
  const hasTriggeredTutorialRef = useRef(false);

  useEffect(() => {
    if (!isHydrated) return;
    if (hasTriggeredTutorialRef.current) return;
    if (tutorialCompleted) return;
    if (isTutorialMode) return;

    // Only trigger if no marks have been completed yet (truly first launch)
    const state = useCoachMarkStore.getState();
    if (state.completedIds.length > 0) return;

    hasTriggeredTutorialRef.current = true;
    // Brief delay to let the home screen render and register targets
    setTimeout(() => {
      useCoachMarkStore.getState().startTutorial();
    }, 800);
  }, [isHydrated, tutorialCompleted, isTutorialMode]);

  // Handle tutorialPendingPage: navigate then show mark after arrival
  useEffect(() => {
    if (!tutorialPendingPage) return;
    if (!onNavigate) return;

    // Navigate to the pending page
    onNavigate(tutorialPendingPage);
  }, [tutorialPendingPage, onNavigate]);

  // When currentPage matches the pending page, clear it and show the mark
  useEffect(() => {
    const state = useCoachMarkStore.getState();

    // Handle tutorial pending navigation
    if (state.tutorialPendingPage && currentPage === state.tutorialPendingPage) {
      // Clear the pending page
      useCoachMarkStore.setState({ tutorialPendingPage: null });
      // Wait for targets to register after navigation
      setTimeout(() => {
        useCoachMarkStore.getState().showTutorialMark();
      }, 600);
      return;
    }

    // Handle replay pending navigation
    if (state.replayPendingPage && currentPage === state.replayPendingPage) {
      const markId = state.replayMarkId;
      useCoachMarkStore.setState({ replayPendingPage: null, replayMarkId: null });

      if (markId) {
        const mark = COACH_MARKS[markId];
        if (mark) {
          // Remove from completed so it can be reshown
          const filtered = state.completedIds.filter(id => id !== markId);
          useCoachMarkStore.setState({ completedIds: filtered });

          // Wait for targets to register, then show
          setTimeout(() => {
            const s = useCoachMarkStore.getState();
            const target = s.targets[mark.targetElementId];
            if (target && target.ref.current) {
              target.ref.current.measureInWindow(
                (x: number, y: number, width: number, height: number) => {
                  if (width > 0 && height > 0) {
                    useCoachMarkStore.setState({
                      currentMark: mark,
                      currentTargetLayout: { x, y, width, height },
                      isVisible: true,
                    });
                  } else {
                    useCoachMarkStore.setState({
                      currentMark: mark,
                      currentTargetLayout: null,
                      isVisible: true,
                    });
                  }
                }
              );
            } else {
              useCoachMarkStore.setState({
                currentMark: mark,
                currentTargetLayout: null,
                isVisible: true,
              });
            }
          }, 600);
        }
      }
      return;
    }
  }, [currentPage]);

  // Handle replayPendingPage navigation
  useEffect(() => {
    if (!replayPendingPage) return;
    if (!onNavigate) return;

    onNavigate(replayPendingPage);
  }, [replayPendingPage, onNavigate]);

  // When tutorial mode starts and we're already on the right page, kick off first mark
  useEffect(() => {
    if (!isTutorialMode) return;

    const state = useCoachMarkStore.getState();
    // If no pending page and not already visible, show the first mark
    if (!state.tutorialPendingPage && !state.isVisible && !state.isMeasuring) {
      setTimeout(() => {
        useCoachMarkStore.getState().showTutorialMark();
      }, 600);
    }
  }, [isTutorialMode]);

  // Check milestones after each completion (skip during tutorial mode)
  useEffect(() => {
    if (completedIds.length === 0) return;
    if (isTutorialMode) return;

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
  }, [completedIds, isTutorialMode]);

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
