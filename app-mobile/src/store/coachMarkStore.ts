import { View } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CoachMarkDefinition, TargetLayout, TargetRegistration } from '../types/coachMark';
import { COACH_MARKS } from '../constants/coachMarks';

const MAX_MARKS_PER_SESSION = 3;
const COOLDOWN_MS = 5000;
const MIN_BACKGROUND_MS_FOR_RESET = 30000;

interface CoachMarkState {
  // Persisted state
  completedIds: string[];

  // Transient state (not persisted)
  isHydrated: boolean;
  sessionCount: number;
  currentMark: CoachMarkDefinition | null;
  currentTargetLayout: TargetLayout | null;
  isVisible: boolean;
  queue: CoachMarkDefinition[];
  cooldownActive: boolean;
  targets: Record<string, TargetRegistration>;
  isMeasuring: boolean;
  visitedTabs: string[];
  firedActions: string[];
  lastBackgroundedAt: number | null;

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
}

export const useCoachMarkStore = create<CoachMarkState>()(
  persist(
    (set, get) => ({
      // Persisted
      completedIds: [],

      // Transient
      isHydrated: false,
      sessionCount: 0,
      currentMark: null,
      currentTargetLayout: null,
      isVisible: false,
      queue: [],
      cooldownActive: false,
      targets: {},
      isMeasuring: false,
      visitedTabs: [],
      firedActions: [],
      lastBackgroundedAt: null,

      markCompleted: (id: string) => {
        const state = get();
        if (state.completedIds.includes(id)) return;
        set({ completedIds: [...state.completedIds, id] });
      },

      enqueue: (mark: CoachMarkDefinition) => {
        const state = get();
        // Don't enqueue if already completed, already in queue, or currently showing
        if (state.completedIds.includes(mark.id)) return;
        if (state.queue.some(m => m.id === mark.id)) return;
        if (state.currentMark?.id === mark.id) return;
        set({ queue: [...state.queue, mark].sort((a, b) => a.priority - b.priority) });
      },

      showNext: () => {
        const state = get();

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

          // Skip if already completed (may have been completed while queued)
          if (state.completedIds.includes(candidate.id)) {
            skippedIds.push(candidate.id);
            continue;
          }

          // Skip if prerequisites not met
          if (!candidate.prerequisites.every(p => state.completedIds.includes(p))) continue;

          // Check target exists and is measurable — remove from queue if not
          const target = state.targets[candidate.targetElementId];
          if (!target || !target.ref.current) {
            skippedIds.push(candidate.id);
            continue;
          }

          // Lock to prevent concurrent showNext() calls during async measurement
          set({ isMeasuring: true });

          // Re-measure the target to get current screen position
          target.ref.current.measureInWindow(
            (x: number, y: number, width: number, height: number) => {
              if (width <= 0 || height <= 0) {
                // Target is off-screen or collapsed — skip to next
                const s = get();
                set({
                  isMeasuring: false,
                  queue: s.queue.filter(m => m.id !== candidate.id),
                });
                // Try next candidate after one frame (16ms prevents CPU churn)
                setTimeout(() => get().showNext(), 16);
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
          return; // Wait for measureInWindow callback
        }

        // Queue exhausted — clean up skipped marks
        if (skippedIds.length > 0) {
          set({ queue: get().queue.filter(m => !skippedIds.includes(m.id)) });
        }
      },

      dismiss: () => {
        const state = get();
        const dismissedMark = state.currentMark;

        if (!dismissedMark) return;

        // Mark completed immediately (Zustand is sync — instant)
        const newCompleted = state.completedIds.includes(dismissedMark.id)
          ? state.completedIds
          : [...state.completedIds, dismissedMark.id];

        set({
          isVisible: false,
          currentMark: null,
          currentTargetLayout: null,
          sessionCount: state.sessionCount + 1,
          cooldownActive: true,
          completedIds: newCompleted,
        });

        // Clear cooldown after timeout, then try showing next
        setTimeout(() => {
          set({ cooldownActive: false });
          get().showNext();
        }, COOLDOWN_MS);
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

        setTimeout(() => {
          set({ cooldownActive: false });
          get().showNext();
        }, COOLDOWN_MS);
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
        // Only reset if backgrounded for longer than threshold
        // This prevents share sheets, notification banners from resetting
        if (
          state.lastBackgroundedAt &&
          Date.now() - state.lastBackgroundedAt < MIN_BACKGROUND_MS_FOR_RESET
        ) {
          return;
        }
        set({
          sessionCount: 0,
          cooldownActive: false,
          visitedTabs: [],
          firedActions: [],
          lastBackgroundedAt: null,
        });
      },

      hydrate: (completedIds: string[]) => {
        // Merge Supabase-fetched IDs with any locally-completed IDs
        // that haven't synced yet
        const state = get();
        const merged = [...new Set([...completedIds, ...state.completedIds])];
        set({ completedIds: merged, isHydrated: true });
      },
    }),
    {
      name: 'mingla_coach_mark_progress',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        completedIds: state.completedIds,
      }),
      onRehydrateStorage: () => (state) => {
        // AsyncStorage rehydration happened — but we still need Supabase hydration
        // Don't set isHydrated here; that's done by the provider after Supabase fetch
      },
    }
  )
);
