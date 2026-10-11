/**
 * useAccountDeletion — side-aware account deletion (#668 / ORCH-1240, rebuilt
 * by #3660).
 *
 * Business-side delete invokes the `delete-user` edge function with
 * `{ side: 'business' }`. The server runs the whole Host deletion as one
 * database call that either completes or changes nothing:
 *   - refused  → HTTP 409 with the list of things to finish first;
 *   - failed   → HTTP 500, nothing changed;
 *   - deleted  → HTTP 200; the login may be kept (`authRetained`).
 *
 * Deletion is final. Signing in to Host again afterwards starts an empty Host
 * account (`tryRecoverAccountIfDeleted` clears the marker; the brands stay
 * deleted).
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import {
  AccountDeletionFailedError,
  AccountDeletionUnconfirmedError,
  normalizeDeletionBlockers,
  parseDeletionFailure,
  type DeletionBlocker,
} from "../utils/accountDeletionErrors";
import { creatorAccountKeys } from "./useCreatorAccount";

export interface DeletionResponse {
  success: boolean;
  authDeleted?: boolean;
  authRetained?: boolean;
  /**
   * #2321 — present iff `authRetained === true`. The reason the auth login
   * survived. `authRetained` alone is not a signal: before #2321 the server
   * returned it for every user, including accounts with no other side at all.
   * #3660 adds `business_records_retained`: the login of anyone who owned a
   * brand is kept.
   */
  retainedReason?:
    | "business_side_active"
    | "explorer_side_active"
    | "business_records_retained";
  message?: string;
}

export interface UseRequestAccountDeletionResult {
  mutateAsync: () => Promise<DeletionResponse>;
  isPending: boolean;
}

export const accountDeletionKeys = {
  all: ["account-deletion"] as const,
  blockers: (userId: string): readonly ["account-deletion", "blockers", string] =>
    [...accountDeletionKeys.all, "blockers", userId] as const,
};

const BLOCKERS_DISABLED_KEY = ["account-deletion", "blockers-disabled"] as const;

/**
 * `functions.invoke` reports a non-2xx as an error whose `context` is the raw
 * Response. The body is where the server says WHY, so read it; anything that
 * cannot be read is a failure whose wording depends on whether the server
 * answered at all (see accountDeletionErrors).
 */
const toDeletionError = async (error: unknown): Promise<Error> => {
  const context = (error as { context?: unknown } | null)?.context;
  if (context === null || typeof context !== "object") {
    // No response at all (network error, lost response): the deletion may
    // have committed. Never "nothing was changed" here (#3660 rework, F-5).
    return new AccountDeletionUnconfirmedError();
  }
  const response = context as { status?: unknown; json?: unknown };
  // A fetch-level failure carries the thrown error as `context`, with no
  // status: 0 is read as "no answer" by parseDeletionFailure.
  const status = typeof response.status === "number" ? response.status : 0;
  if (typeof response.json !== "function") {
    return parseDeletionFailure(status, null);
  }
  try {
    const body: unknown = await (response.json as () => Promise<unknown>).call(
      context,
    );
    return parseDeletionFailure(status, body);
  } catch {
    return parseDeletionFailure(status, null);
  }
};

export const useRequestAccountDeletion = (): UseRequestAccountDeletionResult => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (): Promise<DeletionResponse> => {
      if (user === null) throw new Error("Not signed in");
      const { data, error } = await supabase.functions.invoke("delete-user", {
        method: "POST",
        body: { side: "business" },
      });
      if (error) throw await toDeletionError(error);
      if (data?.error) throw new AccountDeletionFailedError(data.error as string);
      return data as DeletionResponse;
    },
    onSuccess: (): void => {
      if (user !== null) {
        queryClient.invalidateQueries({
          queryKey: creatorAccountKeys.byId(user.id),
        });
      }
    },
  });
  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending };
};

/**
 * The server's own answer to "can this Host account be deleted right now?".
 * A preview only: the deletion re-checks under lock before it writes anything.
 * Never cached (`staleTime: 0`) — a sale can land between two looks.
 */
export const useAccountDeletionBlockers = (
  enabled: boolean,
): UseQueryResult<DeletionBlocker[], Error> => {
  const { user, isAuthReady } = useAuth();
  const userId = user?.id ?? null;
  // The RPC answers for auth.uid() only: wait until the session is attached.
  const enabledQuery = isAuthReady && enabled && userId !== null;
  return useQuery<DeletionBlocker[], Error>({
    queryKey:
      enabledQuery && userId !== null
        ? accountDeletionKeys.blockers(userId)
        : BLOCKERS_DISABLED_KEY,
    queryFn: async (): Promise<DeletionBlocker[]> => {
      const { data, error } = await supabase.rpc(
        "biz_my_host_account_deletion_blockers",
      );
      if (error) throw new Error(error.message);
      return normalizeDeletionBlockers(data);
    },
    enabled: enabledQuery,
    staleTime: 0,
    gcTime: 0,
    retry: 1,
  });
};

/**
 * Non-hook helper called from AuthContext bootstrap. If the signed-in user has
 * a non-null deleted_at, clear it and return true so the caller can greet them
 * on next mount. This does NOT bring anything back: a deleted Host account's
 * brands stay deleted, so the user lands in an empty Host account.
 */
export const tryRecoverAccountIfDeleted = async (
  userId: string,
): Promise<boolean> => {
  const { data, error } = await supabase
    .from("creator_accounts")
    .select("deleted_at")
    .eq("id", userId)
    .maybeSingle();
  if (error || data === null) return false;
  if (data.deleted_at === null) return false;
  const { error: updateError } = await supabase
    .from("creator_accounts")
    .update({ deleted_at: null })
    .eq("id", userId);
  return !updateError;
};
