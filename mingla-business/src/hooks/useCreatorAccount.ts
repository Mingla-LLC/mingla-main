/**
 * useCreatorAccount — React Query hook for the signed-in user's creator_accounts row (Cycle 14).
 *
 * Per DEC-096 D-14-3: direct React Query mutation against creator_accounts via
 * existing self-write UPDATE RLS policy (creator can read/write own account).
 *
 * Const #5 server state in React Query — NOT Zustand (this is server-fetched data).
 *
 * Per Cycle 14 SPEC §4.3.1.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import { withTimeout } from "../utils/withTimeout";
import {
  updateCreatorAccount,
  type CreatorAccountUpdatePatch,
} from "../services/creatorAccount";
// ORCH-1251 — creatorAccountKeys now lives in a standalone keyless module so
// AuthContext can import it for the token-attach cache reconcile without a
// require-cycle. Imported here for internal use + re-exported below.
import { creatorAccountKeys } from "./creatorAccountKeys";

export interface CreatorAccountRow {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  marketing_opt_in: boolean;
  default_brand_id: string | null;
  deleted_at: string | null;
}

export interface CreatorAccountState {
  data: CreatorAccountRow | null;
  isLoading: boolean;
  isFetched: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}

const STALE_TIME_MS = 5 * 60 * 1000; // 5 min — account row changes are rare

// ORCH-1248 (Apple 2.1a): Edit Profile hung forever behind an untimed
// creator_accounts read on Apple's proxied/VPN review network. Bound the fetch
// so it is GUARANTEED to settle: an AbortController cancels the underlying
// supabase request and withTimeout rejects the consumer, so React Query surfaces
// isError → the screen's existing Retry state shows instead of an infinite
// spinner. 9s sits under the withTimeout DATA_FETCH ceiling yet gives a genuinely
// slow-but-real read room to succeed.
const ACCOUNT_FETCH_TIMEOUT_MS = 9000;

// ORCH-1251 — re-export from the standalone keyless module for backward compat
// so existing `import { creatorAccountKeys } from "./useCreatorAccount"` call
// sites keep working (the canonical home is now ./creatorAccountKeys).
export { creatorAccountKeys } from "./creatorAccountKeys";

const DISABLED_KEY = ["creator-account-disabled"] as const;

/**
 * ORCH-1248 (Apple 2.1a): the account read, hardened to ALWAYS settle.
 *
 * An AbortController cancels the underlying supabase request and `withTimeout`
 * rejects the consumer after ACCOUNT_FETCH_TIMEOUT_MS, so a stalled read on
 * Apple's proxied/VPN review network can NEVER leave the Edit Profile spinner
 * spinning forever — React Query surfaces isError → the existing Retry UI shows.
 * Exported for the ORCH-1248 timeout unit test.
 */
export const fetchCreatorAccount = async (
  userId: string,
): Promise<CreatorAccountRow | null> => {
  const controller = new AbortController();
  const request = supabase
    .from("creator_accounts")
    .select(
      "id, email, display_name, avatar_url, marketing_opt_in, default_brand_id, deleted_at",
    )
    .eq("id", userId)
    .abortSignal(controller.signal)
    .maybeSingle();
  try {
    const { data: row, error } = await withTimeout(
      request,
      ACCOUNT_FETCH_TIMEOUT_MS,
      "useCreatorAccount",
    );
    if (error) throw error;
    return row ?? null;
  } catch (err) {
    // On timeout, abort the in-flight socket so it doesn't linger.
    controller.abort();
    throw err;
  }
};

export const useCreatorAccount = (): CreatorAccountState => {
  const { isAuthReady, user } = useAuth();
  const userId = user?.id ?? null;
  const enabled = isAuthReady && userId !== null;

  const { data, isLoading, isFetched, isError, refetch } =
    useQuery<CreatorAccountRow | null>({
      queryKey: enabled ? creatorAccountKeys.byId(userId) : DISABLED_KEY,
      enabled,
      staleTime: STALE_TIME_MS,
      // ORCH-1248 (Apple 2.1a): force the query to run regardless of a
      // misreported navigator.onLine so a captive/offline-flap can't pause it
      // into a permanent spinner. (Also the global default, pinned here so this
      // guarantee survives an unrelated queryClient config change.)
      networkMode: "always",
      queryFn: async (): Promise<CreatorAccountRow | null> => {
        if (!enabled || userId === null) return null;
        return fetchCreatorAccount(userId);
      },
    });

  return { data: data ?? null, isLoading, isFetched, isError, refetch };
};

export interface UseUpdateCreatorAccountResult {
  mutateAsync: (patch: CreatorAccountUpdatePatch) => Promise<void>;
  isPending: boolean;
}

export const useUpdateCreatorAccount = (): UseUpdateCreatorAccountResult => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (patch: CreatorAccountUpdatePatch): Promise<void> => {
      if (user === null) throw new Error("Not signed in");
      await updateCreatorAccount(user.id, patch);
    },
    onSuccess: (_data, patch): void => {
      if (user !== null) {
        queryClient.setQueryData<CreatorAccountRow | null>(
          creatorAccountKeys.byId(user.id),
          (prev) =>
            prev === undefined || prev === null
              ? (prev ?? null)
              : { ...prev, ...patch },
        );
        queryClient.invalidateQueries({
          queryKey: creatorAccountKeys.byId(user.id),
        });
      }
    },
  });
  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending };
};
