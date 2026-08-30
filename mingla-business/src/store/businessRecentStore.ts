import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

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
  startsAt?: string | null;
  endsAt?: string | null;
  pendingSync: boolean;
  localDraft: boolean;
}

interface BusinessRecentState {
  scopes: Record<string, BusinessRecentPointer[]>;
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  upsert: (scope: string, pointer: BusinessRecentPointer) => void;
  replaceScope: (scope: string, pointers: BusinessRecentPointer[]) => void;
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
  pointer: Pick<BusinessRecentPointer, "entityType" | "entityId">,
): string => `${pointer.entityType}:${pointer.entityId}`;

export const recentScopeKey = (userId: string, brandId: string): string =>
  `${userId}:${brandId}`;

export const mergeRecentPointers = (
  current: BusinessRecentPointer[],
  incoming: BusinessRecentPointer[],
): BusinessRecentPointer[] => {
  const byKey = new Map<string, BusinessRecentPointer>();
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
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),
      upsert: (scope, pointer) =>
        set((state) => ({
          scopes: {
            ...state.scopes,
            [scope]: mergeRecentPointers(state.scopes[scope] ?? [], [pointer]),
          },
        })),
      replaceScope: (scope, pointers) =>
        set((state) => ({
          scopes: {
            ...state.scopes,
            [scope]: mergeRecentPointers([], pointers),
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
          const local = existing.find(
            (pointer) =>
              pointer.entityType === entityType && pointer.entityId === localId,
          );
          if (local === undefined) return state;
          const withoutAliases = existing.filter(
            (pointer) =>
              pointer.entityType !== entityType ||
              (pointer.entityId !== localId && pointer.entityId !== serverId),
          );
          return {
            scopes: {
              ...state.scopes,
              [scope]: mergeRecentPointers(withoutAliases, [
                {
                  ...local,
                  entityId: serverId,
                  operationId,
                  pendingSync: true,
                  localDraft: false,
                },
              ]),
            },
          };
        }),
      clearScope: (scope) =>
        set((state) => {
          const scopes = { ...state.scopes };
          delete scopes[scope];
          return { scopes };
        }),
      reset: () => set({ scopes: {}, hasHydrated: true }),
    }),
    {
      name: "business-recent-v1",
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ scopes: state.scopes }),
      onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
    },
  ),
);
