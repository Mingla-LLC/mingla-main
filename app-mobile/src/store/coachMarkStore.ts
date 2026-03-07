import { View, Dimensions } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CoachMarkDefinition, TargetLayout, TargetRegistration, TutorialPage } from '../types/coachMark';
import { COACH_MARKS, TUTORIAL_SEQUENCE } from '../constants/coachMarks';

const MAX_MARKS_PER_SESSION = 5;
const COOLDOWN_MS = 3000;
const MIN_BACKGROUND_MS_FOR_RESET = 30000;
const SCREEN_HEIGHT = Dimensions.get('window').height;

interface CoachMarkState {
  // Persisted state
  completedIds: string[];
  tutorialCompleted: boolean;

  // Transient state (not persisted)
  isHydrated: boolean;
  sessionCount: number;
  currentMark: CoachMarkDefinition | null;
  currentTargetLayout: TargetLayout | null;
  isVisible: boolean;
  queue: CoachMarkDefinition[];
  cooldownActive: boolean;
  cooldownTimerId: ReturnType<typeof setTimeout> | null;
  targets: Record<string, TargetRegistration>;
  isMeasuring: boolean;
  visitedTabs: string[];
  firedActions: string[];
  lastBackgroundedAt: number | null;

  // Tutorial mode state (transient)
  isTutorialMode: boolean;
  tutorialIndex: number;
  // When set, the provider should navigate to this page before showing the next mark
  tutorialPendingPage: TutorialPage | null;

  // Replay mode state (transient) — for playing a single mark from the list
  replayMarkId: string | null;
  replayPendingPage: TutorialPage | null;

  // Actions
  markCompleted: (id: string) => void;
  enqueue: (mark: CoachMarkDefinition) => void;
  showNext: () => void;
  dismiss: () => void;
  skipGroup: (group: string) => void;
  setCurrentTargetLayout: (layout: TargetLayout) => void;
  registerTarget: (id: string, layout: TargetLayout, ref: React.RefObject<View>) => void;
  unregisterTarget: (id: string) => void;
  recordTabVisit: (tab: string) => void;
  recordAction: (action: string) => void;
  resetSession: () => void;
  setBackgrounded: () => void;
  hydrate: (completedIds: string[]) => void;
  clearCooldown: () => void;
  resetAllProgress: () => void;

  // Tutorial actions
  startTutorial: () => void;
  advanceTutorial: () => void;
  restartTutorial: () => void;
  completeTutorial: () => void;
  showTutorialMark: () => void;

  // Replay actions
  startReplay: (markId: string, page: TutorialPage) => void;
  startGroupReplay: (group: string) => void;
  clearReplay: () => void;
}

export const useCoachMarkStore = create<CoachMarkState>()(
  persist(
    (set, get) => ({
      // Persisted
      completedIds: [],
      tutorialCompleted: false,

      // Transient
      isHydrated: false,
      sessionCount: 0,
      currentMark: null,
      currentTargetLayout: null,
      isVisible: false,
      queue: [],
      cooldownActive: false,
      cooldownTimerId: null,
      targets: {},
      isMeasuring: false,
      visitedTabs: [],
      firedActions: [],
      lastBackgroundedAt: null,

      // Tutorial
      isTutorialMode: false,
      tutorialIndex: 0,
      tutorialPendingPage: null,

      // Replay
      replayMarkId: null,
      replayPendingPage: null,

      markCompleted: (id: string) => {
        const state = get();
        if (state.completedIds.includes(id)) return;
        set({ completedIds: [...state.completedIds, id] });
      },

      enqueue: (mark: CoachMarkDefinition) => {
        const state = get();
        if (state.completedIds.includes(mark.id)) return;
        if (state.queue.some(m => m.id === mark.id)) return;
        if (state.currentMark?.id === mark.id) return;
        set({ queue: [...state.queue, mark].sort((a, b) => a.priority - b.priority) });
      },

      showNext: () => {
        const state = get();

        // In tutorial mode, use showTutorialMark instead
        if (state.isTutorialMode) {
          get().showTutorialMark();
          return;
        }

        // Guard: session limit
        if (state.sessionCount >= MAX_MARKS_PER_SESSION) return;

        // Guard: already showing or measuring
        if (state.isVisible || state.isMeasuring) return;

        // Guard: cooldown
        if (state.cooldownActive) return;

        // Guard: not hydrated yet
        if (!state.isHydrated) return;

        // Find first eligible mark in queue
        const queue = [...state.queue];
        const skippedIds: string[] = [];
        while (queue.length > 0) {
          const candidate = queue.shift()!;

          if (state.completedIds.includes(candidate.id)) {
            skippedIds.push(candidate.id);
            continue;
          }

          if (!candidate.prerequisites.every(p => state.completedIds.includes(p))) continue;

          const target = state.targets[candidate.targetElementId];
          if (!target || !target.ref.current) {
            skippedIds.push(candidate.id);
            continue;
          }

          set({ isMeasuring: true });

          target.ref.current.measureInWindow(
            (x: number, y: number, width: number, height: number) => {
              if (width <= 0 || height <= 0) {
                set({ isMeasuring: false });
                setTimeout(() => get().showNext(), 16);
                return;
              }

              const centerY = y + height / 2;
              if (centerY < 0 || centerY > SCREEN_HEIGHT) {
                set({ isMeasuring: false });
                return;
              }

              set({
                isMeasuring: false,
                currentMark: candidate,
                currentTargetLayout: { x, y, width, height },
                isVisible: true,
                queue: get().queue.filter(m => m.id !== candidate.id),
              });
            }
          );
          return;
        }

        if (skippedIds.length > 0) {
          set({ queue: get().queue.filter(m => !skippedIds.includes(m.id)) });
        }
      },

      // Show the current tutorial mark. If target exists, spotlight it. If not, show centered.
      showTutorialMark: () => {
        const state = get();

        if (state.isVisible || state.isMeasuring) return;

        const step = TUTORIAL_SEQUENCE[state.tutorialIndex];
        if (!step) {
          // Tutorial complete
          get().completeTutorial();
          return;
        }

        const mark = COACH_MARKS[step.markId];
        if (!mark) {
          // Invalid mark, skip
          set({ tutorialIndex: state.tutorialIndex + 1 });
          setTimeout(() => get().showTutorialMark(), 16);
          return;
        }

        // Try to find and measure the target
        const target = state.targets[mark.targetElementId];
        if (target && target.ref.current) {
          set({ isMeasuring: true });
          target.ref.current.measureInWindow(
            (x: number, y: number, width: number, height: number) => {
              if (width > 0 && height > 0) {
                // Target found and measurable — show with spotlight
                set({
                  isMeasuring: false,
                  currentMark: mark,
                  currentTargetLayout: { x, y, width, height },
                  isVisible: true,
                });
              } else {
                // Target not measurable — show centered, no spotlight
                set({
                  isMeasuring: false,
                  currentMark: mark,
                  currentTargetLayout: null,
                  isVisible: true,
                });
              }
            }
          );
        } else {
          // Target not registered — show centered, no spotlight
          set({
            currentMark: mark,
            currentTargetLayout: null,
            isVisible: true,
          });
        }
      },

      dismiss: () => {
        const state = get();
        const dismissedMark = state.currentMark;

        if (!dismissedMark) return;

        const newCompleted = state.completedIds.includes(dismissedMark.id)
          ? state.completedIds
          : [...state.completedIds, dismissedMark.id];

        if (state.isTutorialMode) {
          // Tutorial mode: no session count, no cooldown, advance to next
          set({
            isVisible: false,
            currentMark: null,
            currentTargetLayout: null,
            completedIds: newCompleted,
          });
          // Advance tutorial (provider will orchestrate navigation)
          get().advanceTutorial();
          return;
        }

        // Normal mode
        set({
          isVisible: false,
          currentMark: null,
          currentTargetLayout: null,
          sessionCount: state.sessionCount + 1,
          cooldownActive: true,
          completedIds: newCompleted,
        });

        if (state.cooldownTimerId) {
          clearTimeout(state.cooldownTimerId);
        }

        const timerId = setTimeout(() => {
          set({ cooldownActive: false, cooldownTimerId: null });
          get().showNext();
        }, COOLDOWN_MS);
        set({ cooldownTimerId: timerId });
      },

      skipGroup: (group: string) => {
        const state = get();
        const groupMarkIds = Object.values(COACH_MARKS)
          .filter(m => m.group === group)
          .map(m => m.id);

        const newCompleted = [...new Set([...state.completedIds, ...groupMarkIds])];
        const newQueue = state.queue.filter(m => m.group !== group);

        set({
          completedIds: newCompleted,
          queue: newQueue,
          isVisible: false,
          currentMark: null,
          currentTargetLayout: null,
          sessionCount: state.sessionCount + 1,
          cooldownActive: true,
        });

        if (state.cooldownTimerId) {
          clearTimeout(state.cooldownTimerId);
        }

        const timerId = setTimeout(() => {
          set({ cooldownActive: false, cooldownTimerId: null });
          get().showNext();
        }, COOLDOWN_MS);
        set({ cooldownTimerId: timerId });
      },

      setCurrentTargetLayout: (layout: TargetLayout) => {
        set({ currentTargetLayout: layout });
      },

      registerTarget: (id: string, layout: TargetLayout, ref: React.RefObject<View>) => {
        const state = get();
        set({
          targets: {
            ...state.targets,
            [id]: { layout, ref },
          },
        });
      },

      unregisterTarget: (id: string) => {
        const state = get();
        const newTargets = { ...state.targets };
        delete newTargets[id];
        set({ targets: newTargets });
      },

      recordTabVisit: (tab: string) => {
        const state = get();
        if (!state.visitedTabs.includes(tab)) {
          set({ visitedTabs: [...state.visitedTabs, tab] });
        }
      },

      recordAction: (action: string) => {
        const state = get();
        if (!state.firedActions.includes(action)) {
          set({ firedActions: [...state.firedActions, action] });
        }
      },

      setBackgrounded: () => {
        set({ lastBackgroundedAt: Date.now() });
      },

      resetSession: () => {
        const state = get();
        // Don't reset during tutorial
        if (state.isTutorialMode) return;

        if (
          state.lastBackgroundedAt &&
          Date.now() - state.lastBackgroundedAt < MIN_BACKGROUND_MS_FOR_RESET
        ) {
          return;
        }
        if (state.cooldownTimerId) {
          clearTimeout(state.cooldownTimerId);
        }
        set({
          sessionCount: 0,
          cooldownActive: false,
          cooldownTimerId: null,
          visitedTabs: [],
          firedActions: [],
          lastBackgroundedAt: null,
        });
      },

      hydrate: (completedIds: string[]) => {
        const state = get();
        const merged = [...new Set([...completedIds, ...state.completedIds])];
        set({ completedIds: merged, isHydrated: true });
      },

      clearCooldown: () => {
        const state = get();
        if (state.cooldownTimerId) {
          clearTimeout(state.cooldownTimerId);
        }
        set({ cooldownActive: false, cooldownTimerId: null });
      },

      resetAllProgress: () => {
        const state = get();
        if (state.cooldownTimerId) {
          clearTimeout(state.cooldownTimerId);
        }
        set({
          completedIds: [],
          tutorialCompleted: false,
          sessionCount: 0,
          cooldownActive: false,
          cooldownTimerId: null,
          queue: [],
          currentMark: null,
          currentTargetLayout: null,
          isVisible: false,
          visitedTabs: [],
          firedActions: [],
          isTutorialMode: false,
          tutorialIndex: 0,
          tutorialPendingPage: null,
        });
      },

      // ═══════════════════════════════════════
      // Tutorial Actions
      // ═══════════════════════════════════════

      startTutorial: () => {
        set({
          isTutorialMode: true,
          tutorialIndex: 0,
          tutorialPendingPage: null,
          sessionCount: 0,
          cooldownActive: false,
          queue: [],
          isVisible: false,
          currentMark: null,
          currentTargetLayout: null,
        });
        // The provider will observe isTutorialMode and kick off showTutorialMark
      },

      advanceTutorial: () => {
        const state = get();
        const nextIndex = state.tutorialIndex + 1;

        if (nextIndex >= TUTORIAL_SEQUENCE.length) {
          get().completeTutorial();
          return;
        }

        const nextStep = TUTORIAL_SEQUENCE[nextIndex];
        const currentStep = TUTORIAL_SEQUENCE[state.tutorialIndex];

        // Check if we need to navigate to a different page
        const needsNavigation = nextStep.page !== currentStep?.page;

        set({
          tutorialIndex: nextIndex,
          tutorialPendingPage: needsNavigation ? nextStep.page : null,
        });

        // If no navigation needed, show the next mark after a brief delay
        if (!needsNavigation) {
          setTimeout(() => get().showTutorialMark(), 400);
        }
        // If navigation needed, the provider will handle it via tutorialPendingPage
      },

      restartTutorial: () => {
        const state = get();
        // Clear all progress and restart from the beginning
        set({
          completedIds: [],
          tutorialIndex: 0,
          isVisible: false,
          currentMark: null,
          currentTargetLayout: null,
          queue: [],
          // Navigate back to home (first step's page)
          tutorialPendingPage: 'home',
        });
      },

      completeTutorial: () => {
        set({
          isTutorialMode: false,
          tutorialCompleted: true,
          tutorialIndex: 0,
          tutorialPendingPage: null,
          isVisible: false,
          currentMark: null,
          currentTargetLayout: null,
        });
      },

      // ═══════════════════════════════════════
      // Replay Actions
      // ═══════════════════════════════════════

      startReplay: (markId: string, page: TutorialPage) => {
        set({
          replayMarkId: markId,
          replayPendingPage: page,
          isVisible: false,
          currentMark: null,
          currentTargetLayout: null,
        });
        // Provider will navigate to the page, then show the mark
      },

      startGroupReplay: (group: string) => {
        // Find all marks for this group in tutorial sequence order
        const groupSteps = TUTORIAL_SEQUENCE.filter(step => {
          const mark = COACH_MARKS[step.markId];
          return mark && mark.group === group;
        });

        if (groupSteps.length === 0) return;

        // Remove group's completed IDs so they can be reshown
        const state = get();
        const groupMarkIds = groupSteps.map(s => s.markId);
        const filteredCompleted = state.completedIds.filter(id => !groupMarkIds.includes(id));

        // Enter tutorial mode but only for this group's range
        // Find the indices in TUTORIAL_SEQUENCE
        const firstStepIndex = TUTORIAL_SEQUENCE.findIndex(s => s.markId === groupSteps[0].markId);
        const lastStepIndex = TUTORIAL_SEQUENCE.findIndex(s => s.markId === groupSteps[groupSteps.length - 1].markId);

        set({
          completedIds: filteredCompleted,
          isTutorialMode: true,
          tutorialIndex: firstStepIndex,
          tutorialPendingPage: groupSteps[0].page,
          isVisible: false,
          currentMark: null,
          currentTargetLayout: null,
          queue: [],
          sessionCount: 0,
          cooldownActive: false,
        });
      },

      clearReplay: () => {
        set({
          replayMarkId: null,
          replayPendingPage: null,
        });
      },
    }),
    {
      name: 'mingla_coach_mark_progress',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        completedIds: state.completedIds,
        tutorialCompleted: state.tutorialCompleted,
      }),
      onRehydrateStorage: () => () => {
        // AsyncStorage rehydration happened — but we still need Supabase hydration
        // Don't set isHydrated here; that's done by the provider after Supabase fetch
      },
    }
  )
);
