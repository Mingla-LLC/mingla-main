/**
 * useBusinessNotifications — Mingla Business notification inbox.
 *
 * Per B2a Path C V3 SPEC §6 + I-PROPOSED-W (notifications app-type-prefix
 * filtering) + META-ORCH-1074 Sub-C (unread + mark-read).
 *
 * Reads `public.notifications` for the calling user, INCLUDING ONLY rows
 * where `type` matches `stripe.%` OR `business.%`. Consumer notifications
 * (the unprefixed types like `session_match`, `friend_request_received`)
 * are excluded — they belong to the consumer Mingla app's inbox.
 *
 * Strict-grep gate I-PROPOSED-W enforces this filter shape; do NOT remove
 * the `.or('type.like.stripe.%,type.like.business.%')` clause.
 *
 * Realtime subscription invalidates the cache when new business
 * notifications land (INSERT) and patches the cache on UPDATE (a read
 * elsewhere reflects live).
 *
 * META-ORCH-1074 Sub-C adds:
 *   - `useBusinessNotifications` return is unchanged (backward compatible).
 *   - `useBusinessNotificationsInbox(userId)` — the rich hook the inbox + bell
 *     use: query + `unreadCount` + optimistic `markAsRead` / `markAllAsRead`.
 *     Built on the SAME query key so the two stay in cache lockstep.
 */

import { useCallback, useEffect, useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import { supabase } from "../services/supabase";
import { clearNotificationBadge } from "../services/oneSignalService";
import { useAuth } from "../context/AuthContext";

export interface BusinessNotification {
  id: string;
  user_id: string;
  brand_id: string | null;
  type: string;
  title: string;
  body: string;
  deep_link: string | null;
  read_at: string | null;
  /**
   * ORCH-1142 soft-delete timestamp. NULL = active (visible); non-NULL = hidden
   * from the operator inbox but PRESERVED server-side (reference value). The
   * fetch + realtime patch EXCLUDE soft-deleted rows; never hard-delete.
   */
  deleted_at: string | null;
  created_at: string;
  /** JSONB payload from notify-dispatch (entity ids, bold token, etc.). */
  data?: Record<string, unknown> | null;
}

const STALE_TIME_MS = 30 * 1000;
const FETCH_LIMIT = 50;

export const businessNotificationKeys = {
  all: (userId: string): readonly ["business-notifications", string] =>
    ["business-notifications", userId] as const,
};

const DISABLED_KEY = ["business-notifications-disabled"] as const;

const SELECT_COLUMNS =
  "id, user_id, brand_id, type, title, body, deep_link, read_at, deleted_at, created_at, data";

function isBusinessType(type: string | undefined | null): boolean {
  const t = type ?? "";
  return t.startsWith("stripe.") || t.startsWith("business.");
}

/**
 * Subscribe to Realtime INSERT (invalidate) + UPDATE (patch) for this user's
 * business notifications. Shared by both the legacy read hook and the inbox
 * hook so a single mount owns one channel.
 */
function useBusinessNotificationsRealtime(
  userId: string | null,
  enabled: boolean,
): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    // ORCH-1202: gate the subscription on the same auth-readiness as the query
    // so it does not open a pre-auth channel before the JWT attaches.
    if (!enabled || userId === null) return;
    // Unique channel name per mount — prevents Supabase Realtime "after
    // subscribe" rejection on StrictMode double-mount. Same pattern as
    // useBrandStripeStatus per ORCH-V3-runtime-1.
    const channelName = `business-notifications-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const newRow = payload.new as { type?: string } | null;
          if (isBusinessType(newRow?.type)) {
            queryClient.invalidateQueries({
              queryKey: businessNotificationKeys.all(userId),
            });
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const updated = payload.new as BusinessNotification | null;
          if (updated === null || !isBusinessType(updated.type)) return;
          // ORCH-1142: a soft-delete that arrives over realtime (e.g. the
          // operator deleted on another device) must DROP the row from cache,
          // not patch it in place — keeps multi-device inboxes consistent.
          if (updated.deleted_at !== null && updated.deleted_at !== undefined) {
            queryClient.setQueryData<readonly BusinessNotification[]>(
              businessNotificationKeys.all(userId),
              (old = []) => old.filter((n) => n.id !== updated.id),
            );
            return;
          }
          queryClient.setQueryData<readonly BusinessNotification[]>(
            businessNotificationKeys.all(userId),
            (old = []) => old.map((n) => (n.id === updated.id ? updated : n)),
          );
        },
      )
      .subscribe();

    return (): void => {
      void supabase.removeChannel(channel);
    };
  }, [userId, enabled, queryClient]);
}

async function fetchBusinessNotifications(
  userId: string,
): Promise<readonly BusinessNotification[]> {
  // I-PROPOSED-W: business-app reads MUST include the stripe.% or
  // business.% prefix filter. The `.or()` clause uses Postgrest syntax to
  // express the disjunction. Strict-grep gate W will fail if this clause is
  // removed or altered.
  // ORCH-1142: exclude soft-deleted rows. The row persists server-side
  // (reference value) but is hidden from the operator inbox. Do NOT remove
  // this `.is("deleted_at", null)` filter — without it, swiped/cleared rows
  // resurface on refetch (defeats the feature). I-PROPOSED-BH.
  const { data, error } = await supabase
    .from("notifications")
    .select(SELECT_COLUMNS)
    .eq("user_id", userId)
    .or("type.like.stripe.%,type.like.business.%")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(FETCH_LIMIT)
    .returns<BusinessNotification[]>();

  if (error) throw error;
  return data ?? [];
}

/**
 * Legacy read-only hook — backward compatible. Returns the React Query result
 * directly. New callers should prefer `useBusinessNotificationsInbox`.
 */
export function useBusinessNotifications(
  userId: string | null,
): UseQueryResult<readonly BusinessNotification[]> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && userId !== null;
  useBusinessNotificationsRealtime(userId, enabled);

  return useQuery<readonly BusinessNotification[]>({
    queryKey: enabled ? businessNotificationKeys.all(userId) : DISABLED_KEY,
    enabled,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<readonly BusinessNotification[]> => {
      if (userId === null) {
        throw new Error("useBusinessNotifications: enabled but userId null");
      }
      return fetchBusinessNotifications(userId);
    },
  });
}

export interface BusinessNotificationsInbox {
  readonly query: UseQueryResult<readonly BusinessNotification[]>;
  readonly notifications: readonly BusinessNotification[];
  /** Count of business rows with `read_at === null`. */
  readonly unreadCount: number;
  /** Optimistically mark a single row read; reverts on server error. */
  readonly markAsRead: (id: string) => Promise<void>;
  /** Optimistically mark every unread business row read; reverts on error. */
  readonly markAllAsRead: () => Promise<void>;
  /**
   * ORCH-1142: optimistically soft-delete a single row (hide from inbox);
   * reverts on error. Targets by primary key.
   */
  readonly softDelete: (id: string) => Promise<void>;
  /**
   * ORCH-1142: optimistically soft-delete every READ business row (the
   * "Clear read" bulk action). Scoped to read + business-type ONLY — never
   * unread, never consumer rows. Reverts on error.
   */
  readonly clearRead: () => Promise<void>;
  /** True when at least one business row is read (gates the "Clear read" action). */
  readonly hasRead: boolean;
}

/**
 * Rich inbox hook — query + unread derivation + optimistic mark-read.
 * The bell badge and the inbox screen both call this.
 */
export function useBusinessNotificationsInbox(
  userId: string | null,
): BusinessNotificationsInbox {
  const queryClient = useQueryClient();
  const query = useBusinessNotifications(userId);
  const notifications = useMemo(
    () => query.data ?? [],
    [query.data],
  );

  const unreadCount = useMemo(
    () => notifications.filter((n) => n.read_at === null).length,
    [notifications],
  );

  // ORCH-1142: gates the header "Clear read" action — true when ≥1 read row.
  const hasRead = useMemo(
    () => notifications.some((n) => n.read_at !== null),
    [notifications],
  );

  const markOneMutation = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      // The strict-grep I-PROPOSED-W gate exempts `.update(` chains; this
      // mutation targets by primary key `id`, so it cannot cross-contaminate
      // app types.
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
  });

  const markAsRead = useCallback(
    async (id: string): Promise<void> => {
      if (userId === null) return;
      const key = businessNotificationKeys.all(userId);
      const prev = queryClient.getQueryData<readonly BusinessNotification[]>(key);
      const nowIso = new Date().toISOString();
      // Optimistic patch.
      queryClient.setQueryData<readonly BusinessNotification[]>(key, (old = []) =>
        old.map((n) => (n.id === id ? { ...n, read_at: n.read_at ?? nowIso } : n)),
      );
      // Reset the iOS app-icon badge when this clears the last unread.
      const after = queryClient.getQueryData<readonly BusinessNotification[]>(key);
      if ((after ?? []).every((n) => n.read_at !== null)) {
        clearNotificationBadge();
      }
      try {
        await markOneMutation.mutateAsync(id);
      } catch (err) {
        // Silent revert (a transient blip isn't worth alarming an operator —
        // SUB-C_DESIGN §5 state 8 "degraded"). Restore the prior cache.
        if (prev !== undefined) {
          queryClient.setQueryData(key, prev);
        } else {
          void queryClient.invalidateQueries({ queryKey: key });
        }
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.warn("[useBusinessNotifications] markAsRead failed:", err);
        }
      }
    },
    [userId, queryClient, markOneMutation],
  );

  const markAllAsRead = useCallback(async (): Promise<void> => {
    if (userId === null) return;
    const key = businessNotificationKeys.all(userId);
    const prev = queryClient.getQueryData<readonly BusinessNotification[]>(key);
    const nowIso = new Date().toISOString();
    queryClient.setQueryData<readonly BusinessNotification[]>(key, (old = []) =>
      old.map((n) => ({ ...n, read_at: n.read_at ?? nowIso })),
    );
    clearNotificationBadge();
    // Scope the bulk update to business types so it never marks a consumer
    // row read (I-PROPOSED-W intent at the mutation layer). PostgREST update
    // docs: https://supabase.com/docs/reference/javascript/update
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: nowIso })
      .eq("user_id", userId)
      .is("read_at", null)
      .or("type.like.stripe.%,type.like.business.%");
    if (error) {
      if (prev !== undefined) {
        queryClient.setQueryData(key, prev);
      } else {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.warn("[useBusinessNotifications] markAllAsRead failed:", error.message);
      }
    }
  }, [userId, queryClient]);

  // ORCH-1142 — per-row soft-delete (swipe-to-delete native / web trash).
  // Supersedes META-ORCH-1074 SUB-C_DESIGN §4.4 "NO swipe-to-dismiss" for the
  // operator inbox VIEW only: soft-delete PRESERVES the row server-side (sets
  // `deleted_at`), so reference value is intact. Do NOT convert to a hard
  // delete and do NOT drop the `deleted_at IS NULL` fetch filter. I-PROPOSED-BH.
  const softDelete = useCallback(
    async (id: string): Promise<void> => {
      if (userId === null) return;
      const key = businessNotificationKeys.all(userId);
      const prev = queryClient.getQueryData<readonly BusinessNotification[]>(key);
      // Optimistically remove the row from cache (it disappears immediately).
      queryClient.setQueryData<readonly BusinessNotification[]>(key, (old = []) =>
        old.filter((n) => n.id !== id),
      );
      // Reset the iOS app-icon badge if no unread remain after removal.
      const after = queryClient.getQueryData<readonly BusinessNotification[]>(key);
      if ((after ?? []).every((n) => n.read_at !== null)) {
        clearNotificationBadge();
      }
      // The strict-grep I-PROPOSED-W gate exempts `.update(` chains; this
      // targets by primary key `id`, so it cannot cross-contaminate app types.
      const { error } = await supabase
        .from("notifications")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) {
        // Silent revert (transient blip isn't worth alarming an operator —
        // same grammar as markAsRead). Restore the prior cache + order.
        if (prev !== undefined) {
          queryClient.setQueryData(key, prev);
        } else {
          void queryClient.invalidateQueries({ queryKey: key });
        }
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.warn("[useBusinessNotifications] softDelete failed:", error.message);
        }
      }
    },
    [userId, queryClient],
  );

  // ORCH-1142 — bulk soft-delete of READ business rows ("Clear read").
  // EXACT scope: this user's rows that are read (read_at IS NOT NULL), not
  // already soft-deleted, AND business-type only (stripe.%/business.%). NEVER
  // touches unread rows; NEVER touches consumer rows. Same supersession +
  // soft-delete-preserves-reference-value contract as softDelete. I-PROPOSED-BH.
  const clearRead = useCallback(async (): Promise<void> => {
    if (userId === null) return;
    const key = businessNotificationKeys.all(userId);
    const prev = queryClient.getQueryData<readonly BusinessNotification[]>(key);
    const nowIso = new Date().toISOString();
    // Optimistically remove all READ rows from cache (unread stay).
    queryClient.setQueryData<readonly BusinessNotification[]>(key, (old = []) =>
      old.filter((n) => n.read_at === null),
    );
    // Bulk update scoped to read + business-type. `.update(` is gate-exempt
    // (I-PROPOSED-W); the `.or(...)` keeps it from ever hitting consumer rows.
    const { error } = await supabase
      .from("notifications")
      .update({ deleted_at: nowIso })
      .eq("user_id", userId)
      .not("read_at", "is", null)
      .is("deleted_at", null)
      .or("type.like.stripe.%,type.like.business.%");
    if (error) {
      if (prev !== undefined) {
        queryClient.setQueryData(key, prev);
      } else {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.warn("[useBusinessNotifications] clearRead failed:", error.message);
      }
    }
  }, [userId, queryClient]);

  return {
    query,
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    softDelete,
    clearRead,
    hasRead,
  };
}
