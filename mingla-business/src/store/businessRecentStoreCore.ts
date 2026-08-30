import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { businessRecentStateStorage } from "../services/businessRecentStorage";
import {
  mergeRecentPointers,
  promoteBusinessRecentPointers,
} from "../utils/businessRecentPointerMerge";

export {
  mergeRecentPointers,
  promoteBusinessRecentPointers,
} from "../utils/businessRecentPointerMerge";

export type BusinessRecentEntityType =
  "venue" | "event" | "rsvp" | "experience" | "trip";

export interface BusinessRecentPointer {
  entityType: BusinessRecentEntityType;
  entityId: string;
  lastOpenedAt: string;
  operationId: string;
  title?: string;
  coverUrl?: string | null;
  coverPosterUrl?: string | null;
  coverType?: "image" | "video" | "gif" | null;
  status?: string | null;
  destination?: "detail" | "edit";
  startsAt?: string | null;
  endsAt?: string | null;
  pendingSync: boolean;
  localDraft: boolean;
}

export type BusinessRecentQueuePointer = Pick<
  BusinessRecentPointer,
  | "entityType"
  | "entityId"
  | "lastOpenedAt"
  | "operationId"
  | "pendingSync"
  | "localDraft"
>;

interface BusinessRecentState {
  scopes: Record<string, BusinessRecentQueuePointer[]>;
  generation: number;
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  upsert: (scope: string, pointer: BusinessRecentQueuePointer) => void;
  remove: (
    scope: string,
    entityType: BusinessRecentEntityType,
    entityId: string,
  ) => void;
  promoteDraft: (
    scope: string,
    entityType: BusinessRecentEntityType,
    localId: string,
    serverId: string,
    operationId: string,
  ) => void;
  clearScope: (scope: string) => void;
  reset: () => void;
}

const pointerKey = (
  pointer: Pick<BusinessRecentQueuePointer, "entityType" | "entityId">,
): string => `${pointer.entityType}:${pointer.entityId}`;

const queuePointer = (
  pointer: BusinessRecentQueuePointer,
): BusinessRecentQueuePointer => ({
  entityType: pointer.entityType,
  entityId: pointer.entityId,
  lastOpenedAt: pointer.lastOpenedAt,
  operationId: pointer.operationId,
  pendingSync: pointer.pendingSync,
  localDraft: pointer.localDraft,
});

export const recentScopeKey = (userId: string, brandId: string): string =>
  `${userId}:${brandId}`;

const mergeRecentQueuePointers = (
  current: BusinessRecentQueuePointer[],
  incoming: BusinessRecentQueuePointer[],
): BusinessRecentQueuePointer[] => {
  const byKey = new Map<string, BusinessRecentQueuePointer>();
  for (const pointer of [...current, ...incoming]) {
    const key = pointerKey(pointer);
    const prior = byKey.get(key);
    if (
      prior === undefined ||
      Date.parse(pointer.lastOpenedAt) >= Date.parse(prior.lastOpenedAt)
    ) {
      byKey.set(key, { ...prior, ...pointer });
    }
  }
  return Array.from(byKey.values())
    .sort((a, b) => {
      const time = Date.parse(b.lastOpenedAt) - Date.parse(a.lastOpenedAt);
      return time !== 0 ? time : pointerKey(b).localeCompare(pointerKey(a));
    })
    .slice(0, 200);
};

export const useBusinessRecentStore = create<BusinessRecentState>()(
  persist(
    (set) => ({
      scopes: {},
      generation: 0,
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),
      upsert: (scope, pointer) =>
        set((state) => ({
          scopes: {
            ...state.scopes,
            [scope]: mergeRecentQueuePointers(state.scopes[scope] ?? [], [
              queuePointer(pointer),
            ]),
          },
        })),
      remove: (scope, entityType, entityId) =>
        set((state) => ({
          scopes: {
            ...state.scopes,
            [scope]: (state.scopes[scope] ?? []).filter(
              (pointer) =>
                pointer.entityType !== entityType ||
                pointer.entityId !== entityId,
            ),
          },
        })),
      promoteDraft: (scope, entityType, localId, serverId, operationId) =>
        set((state) => {
          const existing = state.scopes[scope] ?? [];
          const promoted = promoteBusinessRecentPointers(existing, {
            entityType,
            localId,
            serverId,
            operationId,
          });
          if (promoted === existing) return state;
          return {
            scopes: {
              ...state.scopes,
              [scope]: promoted.map(queuePointer),
            },
          };
        }),
      clearScope: (scope) =>
        set((state) => {
          const scopes = { ...state.scopes };
          delete scopes[scope];
          return { scopes };
        }),
      reset: () =>
        set((state) => ({
          scopes: {},
          hasHydrated: true,
          generation: state.generation + 1,
        })),
    }),
    {
      name: "business-recent-v1",
      version: 1,
      storage: createJSONStorage(() => businessRecentStateStorage),
      skipHydration: true,
      partialize: (state) => ({
        scopes: Object.fromEntries(
          Object.entries(state.scopes).map(([scope, pointers]) => [
            scope,
            pointers.map((pointer) => ({
              entityType: pointer.entityType,
              entityId: pointer.entityId,
              lastOpenedAt: pointer.lastOpenedAt,
              operationId: pointer.operationId,
              pendingSync: pointer.pendingSync,
              localDraft: pointer.localDraft,
            })),
          ]),
        ),
      }),
      onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
    },
  ),
);

let businessRecentHydration: Promise<void> | null = null;

export const ensureBusinessRecentStoreHydrated = (): Promise<void> => {
  businessRecentHydration ??= Promise.resolve(
    useBusinessRecentStore.persist.rehydrate(),
  );
  return businessRecentHydration;
};

const businessRecentResetKey = Symbol.for("mingla.business-recent.reset");
(globalThis as unknown as Record<symbol, unknown>)[businessRecentResetKey] =
  () => useBusinessRecentStore.getState().reset();
