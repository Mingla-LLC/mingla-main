/**
 * notificationPrefsStore — persisted Zustand store for notification preferences (Cycle 14).
 *
 * Per DEC-096 D-14-7: 4-toggle TRANSITIONAL state until B-cycle wires real
 * delivery (OneSignal SDK + Resend + edge fn + user_notification_prefs table).
 *
 * Marketing toggle is also synced to creator_accounts.marketing_opt_in via
 * useUpdateCreatorAccount mutation in the consumer (this store holds the
 * client-side cache for ALL 4; the marketing one is ALSO persisted to backend
 * since the schema column exists per PR #59).
 *
 * Constitutional notes:
 *   - #2 one owner per truth: notification prefs UI cache lives ONLY here
 *     (mirrors marketing schema column for the 1 already-persisted toggle).
 *   - #6 logout clears: extended via clearAllStores per SPEC §3.1.
 *   - #9 no fabricated data: store starts at DEFAULT_PREFS; never seeded.
 *
 * [TRANSITIONAL] Zustand persist holds prefs client-side. EXIT: B-cycle wires
 *   user_notification_prefs schema + OneSignal delivery + Resend email; this
 *   store contracts to a cache (or removes entirely if backend is sole authority).
 *
 * Per Cycle 14 SPEC §4.5.1.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type PersistOptions,
} from "zustand/middleware";

export interface NotificationPrefs {
  /** Order activity (transactional). Default true. */
  orderActivity: boolean;
  /** Scanner activity (transactional). Default true. */
  scannerActivity: boolean;
  /** Brand team invitations + role changes (transactional). Default true. */
  brandTeam: boolean;
  /**
   * Marketing newsletter / weekly digest. Default false (GDPR-favored).
   * ALSO synced to creator_accounts.marketing_opt_in via parent component
   * per D-14-7 double-wire pattern.
   */
  marketing: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  orderActivity: true,
  scannerActivity: true,
  brandTeam: true,
  marketing: false,
};

export interface NotificationPrefsStoreState {
  prefs: NotificationPrefs;
  setPref: (key: keyof NotificationPrefs, value: boolean) => void;
  /**
   * Hydrate marketing toggle from the canonical schema column on app load
   * (consumer calls this after useCreatorAccount resolves with marketing_opt_in).
   * Other 3 toggles are local-only TRANSITIONAL.
   */
  hydrateMarketingFromBackend: (marketingOptIn: boolean) => void;
  reset: () => void;
}

type PersistedState = Pick<NotificationPrefsStoreState, "prefs">;

const persistOptions: PersistOptions<
  NotificationPrefsStoreState,
  PersistedState
> = {
  name: "mingla-business.notificationPrefsStore.v1",
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (s): PersistedState => ({ prefs: s.prefs }),
  version: 1,
};

export const useNotificationPrefsStore = create<NotificationPrefsStoreState>()(
  persist(
    (set) => ({
      prefs: { ...DEFAULT_PREFS },
      setPref: (key, value): void => {
        set((s) => ({ prefs: { ...s.prefs, [key]: value } }));
      },
      hydrateMarketingFromBackend: (marketingOptIn): void => {
        set((s) => ({
          prefs: { ...s.prefs, marketing: marketingOptIn },
        }));
      },
      reset: (): void => {
        set({ prefs: { ...DEFAULT_PREFS } });
      },
    }),
    persistOptions,
  ),
);
