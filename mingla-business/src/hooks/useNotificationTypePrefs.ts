/**
 * useNotificationTypePrefs — per-type push/in-app preference persistence
 * (META-ORCH-1074 Sub-C §5.C.4 / §8).
 *
 * Reads + writes `public.notification_preferences` (channel × type × opt_in,
 * unique on (user_id, channel, type)). `notify-dispatch` reads this table
 * before delivery, so toggling a type OFF here actually stops the push
 * (SC-C5). No row = opted-in (the table default is opt_in=true), so the UI
 * defaults come from BUSINESS_NOTIFICATION_TEMPLATES and an explicit row is
 * upserted whenever the user toggles.
 *
 * RLS: "User manages own notification preferences" (FOR ALL, user_id =
 * auth.uid()) — the authenticated business client writes its own rows.
 * PostgREST upsert: https://supabase.com/docs/reference/javascript/upsert
 *
 * Channels handled here: `push` + `in_app`. The 4 coarse master toggles keep
 * their existing Zustand wiring; a master OFF writes opt_in=false for all its
 * children's push+in_app rows so the backend honors the master too.
 */

import { useCallback, useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import { supabase } from "../services/supabase";
import {
  BUSINESS_NOTIFICATION_TEMPLATES,
  type BusinessNotificationType,
} from "../constants/businessNotificationTemplates";
import { useAuth } from "../context/AuthContext";

export type PrefChannel = "push" | "in_app";

export interface NotificationPrefRow {
  channel: string;
  type: string;
  opt_in: boolean;
}

export const notificationPrefKeys = {
  all: (userId: string): readonly ["notification-prefs", string] =>
    ["notification-prefs", userId] as const,
};

const DISABLED_KEY = ["notification-prefs-disabled"] as const;

/** Default opt-in for a (type, channel) from the template matrix. */
export function defaultOptIn(
  type: BusinessNotificationType,
  channel: PrefChannel,
): boolean {
  const t = BUSINESS_NOTIFICATION_TEMPLATES[type];
  return channel === "push" ? t.defaultPush : t.defaultInApp;
}

interface PrefsState {
  /** Effective opt-in for (type, channel): explicit row OR template default. */
  readonly isOn: (type: BusinessNotificationType, channel: PrefChannel) => boolean;
  readonly query: UseQueryResult<readonly NotificationPrefRow[]>;
  /** Upsert one (type, channel) opt-in row. */
  readonly setPref: (
    type: BusinessNotificationType,
    channel: PrefChannel,
    optIn: boolean,
  ) => Promise<void>;
  /** Bulk-set opt-in for every (type, channel) in `types` (master gate). */
  readonly setMany: (
    types: readonly BusinessNotificationType[],
    optIn: boolean,
  ) => Promise<void>;
}

export function useNotificationTypePrefs(userId: string | null): PrefsState {
  const queryClient = useQueryClient();
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && userId !== null;

  const query = useQuery<readonly NotificationPrefRow[]>({
    queryKey: enabled ? notificationPrefKeys.all(userId) : DISABLED_KEY,
    enabled,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<readonly NotificationPrefRow[]> => {
      if (userId === null) throw new Error("useNotificationTypePrefs: userId null");
      const { data, error } = await supabase
        .from("notification_preferences")
        .select("channel, type, opt_in")
        .eq("user_id", userId)
        .returns<NotificationPrefRow[]>();
      if (error) throw error;
      return data ?? [];
    },
  });

  const rowsData = query.data;

  // Lookup: explicit row wins; absent → template default.
  const explicit = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const r of rowsData ?? []) map.set(`${r.channel}:${r.type}`, r.opt_in);
    return map;
  }, [rowsData]);

  const isOn = useCallback(
    (type: BusinessNotificationType, channel: PrefChannel): boolean => {
      const found = explicit.get(`${channel}:${type}`);
      if (found !== undefined) return found;
      return defaultOptIn(type, channel);
    },
    [explicit],
  );

  const upsertMutation = useMutation({
    mutationFn: async (
      rowsToWrite: readonly {
        type: string;
        channel: PrefChannel;
        opt_in: boolean;
      }[],
    ): Promise<void> => {
      if (userId === null) return;
      const payload = rowsToWrite.map((r) => ({
        user_id: userId,
        channel: r.channel,
        type: r.type,
        opt_in: r.opt_in,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabase
        .from("notification_preferences")
        .upsert(payload, { onConflict: "user_id,channel,type" });
      if (error) throw error;
    },
    onSuccess: () => {
      if (userId !== null) {
        void queryClient.invalidateQueries({
          queryKey: notificationPrefKeys.all(userId),
        });
      }
    },
  });

  const optimisticPatch = useCallback(
    (
      patches: readonly { type: string; channel: PrefChannel; opt_in: boolean }[],
    ): readonly NotificationPrefRow[] | undefined => {
      if (userId === null) return undefined;
      const key = notificationPrefKeys.all(userId);
      const prev = queryClient.getQueryData<readonly NotificationPrefRow[]>(key);
      queryClient.setQueryData<readonly NotificationPrefRow[]>(key, (old = []) => {
        const next = old.slice();
        for (const p of patches) {
          const idx = next.findIndex(
            (r) => r.channel === p.channel && r.type === p.type,
          );
          if (idx >= 0) next[idx] = { ...next[idx], opt_in: p.opt_in };
          else next.push({ channel: p.channel, type: p.type, opt_in: p.opt_in });
        }
        return next;
      });
      return prev;
    },
    [userId, queryClient],
  );

  const setPref = useCallback(
    async (
      type: BusinessNotificationType,
      channel: PrefChannel,
      optIn: boolean,
    ): Promise<void> => {
      if (userId === null) return;
      const prev = optimisticPatch([{ type, channel, opt_in: optIn }]);
      try {
        await upsertMutation.mutateAsync([{ type, channel, opt_in: optIn }]);
      } catch {
        if (prev !== undefined) {
          queryClient.setQueryData(notificationPrefKeys.all(userId), prev);
        }
      }
    },
    [userId, optimisticPatch, upsertMutation, queryClient],
  );

  const setMany = useCallback(
    async (
      types: readonly BusinessNotificationType[],
      optIn: boolean,
    ): Promise<void> => {
      if (userId === null) return;
      const patches = types.flatMap((type) => [
        { type, channel: "push" as const, opt_in: optIn },
        { type, channel: "in_app" as const, opt_in: optIn },
      ]);
      const prev = optimisticPatch(patches);
      try {
        await upsertMutation.mutateAsync(patches);
      } catch {
        if (prev !== undefined) {
          queryClient.setQueryData(notificationPrefKeys.all(userId), prev);
        }
      }
    },
    [userId, optimisticPatch, upsertMutation, queryClient],
  );

  return { isOn, query, setPref, setMany };
}
