/**
 * useAccountDeletion — React Query mutation for soft-delete + recovery (Cycle 14).
 *
 * Per DEC-096 D-14-12 (FORCED — schema already shipped): UPDATE creator_accounts
 * .deleted_at = now() via existing self-write UPDATE RLS policy. NO insert into
 * account_deletion_requests (B-cycle service-role edge fn writes that audit row).
 *
 * Per D-CYCLE14-FOR-6: recovery-on-sign-in auto-clears the marker — implemented
 * here as `tryRecoverAccountIfDeleted` non-hook helper (consumed by AuthContext
 * bootstrap per SPEC §4.7.5).
 *
 * I-35 invariant: deleted_at is the soft-delete marker; mobile UPDATE writes
 * self-only via existing RLS; recover-on-sign-in auto-clears the marker;
 * B-cycle hard-delete cron honors 30-day window.
 *
 * Per Cycle 14 SPEC §4.3.2.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import { creatorAccountKeys } from "./useCreatorAccount";

export interface UseRequestAccountDeletionResult {
  mutateAsync: () => Promise<void>;
  isPending: boolean;
}

/**
 * Mutation: soft-delete current user's account by setting deleted_at = now().
 * On success the caller fires signOut() — not done here so the mutation has a
 * clean separation of concerns (caller controls navigation post-delete).
 */
export const useRequestAccountDeletion = (): UseRequestAccountDeletionResult => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (): Promise<void> => {
      if (user === null) throw new Error("Not signed in");
      const { error } = await supabase
        .from("creator_accounts")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", user.id);
      if (error) throw error;
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
 * Non-hook helper called from AuthContext bootstrap. If the signed-in user has
 * a non-null deleted_at, clear it (auto-recovery within 30-day window) and
 * return true so the caller can show "Welcome back — your account has been
 * recovered." toast on next mount.
 *
 * Returns false if no recovery happened (deleted_at was already null OR query
 * failed — caller treats as no-op).
 *
 * Per SPEC §4.3.2 + D-CYCLE14-FOR-6 lock.
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
