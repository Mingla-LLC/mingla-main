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

export interface CreatorAccountRow {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  marketing_opt_in: boolean;
  deleted_at: string | null;
}

export interface CreatorAccountUpdatePatch {
  display_name?: string;
  avatar_url?: string | null;
  marketing_opt_in?: boolean;
}

export interface CreatorAccountState {
  data: CreatorAccountRow | null;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}

const STALE_TIME_MS = 5 * 60 * 1000; // 5 min — account row changes are rare

export const creatorAccountKeys = {
  all: ["creator-account"] as const,
  byId: (userId: string): readonly [string, string] =>
    ["creator-account", userId] as const,
};

const DISABLED_KEY = ["creator-account-disabled"] as const;

export const useCreatorAccount = (): CreatorAccountState => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const enabled = userId !== null;

  const { data, isLoading, isError, refetch } = useQuery<CreatorAccountRow | null>({
    queryKey: enabled ? creatorAccountKeys.byId(userId) : DISABLED_KEY,
    enabled,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<CreatorAccountRow | null> => {
      if (!enabled || userId === null) return null;
      const { data: row, error } = await supabase
        .from("creator_accounts")
        .select(
          "id, email, display_name, avatar_url, marketing_opt_in, deleted_at",
        )
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      return row ?? null;
    },
  });

  return { data: data ?? null, isLoading, isError, refetch };
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
      const { error } = await supabase
        .from("creator_accounts")
        .update(patch)
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
