import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../context/AuthContext";
import { marketingKeys } from "./marketingKeys";

type ManualGroupService = typeof import("../../services/marketing/manualGroupService");
const loadManualGroupService = (): Promise<ManualGroupService> =>
  import("../../services/marketing/manualGroupService");
const groupKeys = {
  all: (brandId: string) => [...marketingKeys.people.all(brandId), "groups"] as const,
  detail: (brandId: string, groupId: string, search: string) => [...groupKeys.all(brandId), "detail", groupId, search.trim()] as const,
};
const STALE_TIME_MS = 60_000;

export const useManualGroup = (
  brandId: string | null,
  groupId: string | null,
  search: string,
  enabled = true,
) => {
  const { isAuthReady, user } = useAuth();
  const query = useInfiniteQuery({
    queryKey: brandId && groupId
      ? groupKeys.detail(brandId, groupId, search)
      : ["marketing", "people", "group", "disabled"],
    queryFn: async ({ pageParam }) => (await loadManualGroupService()).getManualGroup({
      brandId: brandId as string,
      groupId: groupId as string,
      search,
      cursor: pageParam,
    }),
    initialPageParam: null as Record<string, unknown> | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: isAuthReady && user !== null && enabled && brandId !== null && groupId !== null,
    staleTime: STALE_TIME_MS,
  });
  const first = query.data?.pages[0];
  return {
    ...query,
    data: first
      ? {
          ...first,
          members: query.data?.pages.flatMap((page) => page.members) ?? [],
          nextCursor: query.data?.pages.at(-1)?.nextCursor ?? null,
        }
      : undefined,
  };
};

export function useManualGroupMutations(brandId: string) {
  const client = useQueryClient();
  const refresh = async (groupId?: string): Promise<void> => {
    await Promise.all([
      client.invalidateQueries({ queryKey: groupKeys.all(brandId) }),
      client.invalidateQueries({ queryKey: marketingKeys.people.all(brandId) }),
      client.invalidateQueries({ queryKey: marketingKeys.audiences.all }),
      ...(groupId
        ? [client.invalidateQueries({ queryKey: [...groupKeys.all(brandId), "detail", groupId] })]
        : []),
    ]);
  };
  return {
    remove: useMutation({ mutationFn: async (input: Parameters<ManualGroupService["removeManualGroupPeople"]>[0]) => (await loadManualGroupService()).removeManualGroupPeople(input), onSuccess: (_result, input) => refresh(input.groupId) }),
    rename: useMutation({ mutationFn: async (input: Parameters<ManualGroupService["renameManualGroup"]>[0]) => (await loadManualGroupService()).renameManualGroup(input), onSuccess: (_result, input) => refresh(input.groupId) }),
    deleteGroup: useMutation({ mutationFn: async (input: Parameters<ManualGroupService["deleteManualGroup"]>[0]) => (await loadManualGroupService()).deleteManualGroup(input), onSuccess: (_result, input) => refresh(input.groupId) }),
  };
}
