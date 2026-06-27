/**
 * useAccountDeletion — side-aware account deletion (#668 / ORCH-1240).
 *
 * Business-side delete invokes the `delete-user` edge function with
 * `{ side: 'business' }` so Stripe offboarding + brand soft-delete run
 * server-side while the auth login survives when the explorer side remains.
 *
 * Recovery-on-sign-in (D-CYCLE14-FOR-6) still clears creator_accounts.deleted_at
 * when the user signs in within the 30-day window.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import { creatorAccountKeys } from "./useCreatorAccount";

export interface DeletionResponse {
  success: boolean;
  authDeleted?: boolean;
  authRetained?: boolean;
  message?: string;
}

export interface UseRequestAccountDeletionResult {
  mutateAsync: () => Promise<DeletionResponse>;
  isPending: boolean;
}

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
      if (error) throw error;
      if (data?.error) throw new Error(data.error as string);
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
 * Non-hook helper called from AuthContext bootstrap. If the signed-in user has
 * a non-null deleted_at, clear it (auto-recovery within 30-day window) and
 * return true so the caller can show "Welcome back — your account has been
 * recovered." toast on next mount.
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
