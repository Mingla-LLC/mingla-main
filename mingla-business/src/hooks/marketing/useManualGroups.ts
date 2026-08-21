import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../context/AuthContext";
import { marketingKeys } from "./marketingKeys";

type ManualGroupService = typeof import("../../services/marketing/manualGroupService");
const loadManualGroupService = (): Promise<ManualGroupService> =>
  import("../../services/marketing/manualGroupService");
const groupKeys = {
  all: (brandId: string) => [...marketingKeys.people.all(brandId), "groups"] as const,
  list: (brandId: string) => [...groupKeys.all(brandId), "list"] as const,
  detail: (brandId: string, groupId: string, search: string) => [...groupKeys.all(brandId), "detail", groupId, search.trim()] as const,
  picker: (brandId: string, groupId: string | null, search: string) => [...groupKeys.all(brandId), "picker", groupId ?? "new", search.trim()] as const,
};

const STALE_TIME_MS = 60_000;

export const useManualGroups = (brandId: string | null, enabled: boolean) => {
  const { isAuthReady, user } = useAuth();
  const enabledQuery = isAuthReady && user !== null && enabled && brandId !== null;
  return useQuery({ queryKey: brandId ? groupKeys.list(brandId) : ["marketing", "people", "groups", "disabled"],
    queryFn: async () => (await loadManualGroupService()).listManualGroups(brandId as string), enabled: enabledQuery, staleTime: STALE_TIME_MS });
};

export const useManualGroup = (brandId: string | null, groupId: string | null, search: string, enabled = true) => {
  const { isAuthReady, user } = useAuth();
  const enabledQuery = isAuthReady && user !== null && enabled && brandId !== null && groupId !== null;
  const query = useInfiniteQuery({
    queryKey: brandId && groupId ? groupKeys.detail(brandId, groupId, search) : ["marketing", "people", "group", "disabled"],
    queryFn: async ({ pageParam }) => (await loadManualGroupService()).getManualGroup({ brandId: brandId as string, groupId: groupId as string, search, cursor: pageParam }),
    initialPageParam: null as Record<string, unknown> | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: enabledQuery,
    staleTime: STALE_TIME_MS,
  });
  const first = query.data?.pages[0];
  return { ...query, data: first ? { ...first, members: query.data?.pages.flatMap((page) => page.members) ?? [], nextCursor: query.data?.pages.at(-1)?.nextCursor ?? null } : undefined };
};

export const useManualGroupBookPicker = (brandId: string | null, groupId: string | null, search: string, enabled = true) => {
  const { isAuthReady, user } = useAuth();
  const enabledQuery = isAuthReady && user !== null && enabled && brandId !== null;
  const query = useInfiniteQuery({
    queryKey: brandId ? groupKeys.picker(brandId, groupId, search) : ["marketing", "people", "group-picker", "disabled"],
    queryFn: async ({ pageParam }) => (await loadManualGroupService()).getManualGroupBookPicker({ brandId: brandId as string, groupId, search, cursor: pageParam }),
    initialPageParam: null as Record<string, unknown> | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: enabledQuery,
    staleTime: STALE_TIME_MS,
  });
  return { ...query, data: query.data ? { rows: query.data.pages.flatMap((page) => page.rows), nextCursor: query.data.pages.at(-1)?.nextCursor ?? null } : undefined };
};

export function useManualGroupMutations(brandId: string) {
  const client = useQueryClient();
  const refresh = async (groupId?: string): Promise<void> => {
    await Promise.all([
      client.invalidateQueries({ queryKey: groupKeys.all(brandId) }),
      client.invalidateQueries({ queryKey: marketingKeys.people.all(brandId) }),
      client.invalidateQueries({ queryKey: marketingKeys.audiences.all }),
      ...(groupId ? [client.invalidateQueries({ queryKey: [...groupKeys.all(brandId), "detail", groupId] })] : []),
    ]);
  };
  return {
    create: useMutation({ mutationFn: async (input: Parameters<ManualGroupService["createManualGroup"]>[0]) => (await loadManualGroupService()).createManualGroup(input), onSuccess: (r) => refresh(r.group.groupId) }),
    add: useMutation({ mutationFn: async (input: Parameters<ManualGroupService["addManualGroupPeople"]>[0]) => (await loadManualGroupService()).addManualGroupPeople(input), onSuccess: (r) => refresh(r.group.groupId) }),
    remove: useMutation({ mutationFn: async (input: Parameters<ManualGroupService["removeManualGroupPeople"]>[0]) => (await loadManualGroupService()).removeManualGroupPeople(input), onSuccess: (_r, v) => refresh(v.groupId) }),
    rename: useMutation({ mutationFn: async (input: Parameters<ManualGroupService["renameManualGroup"]>[0]) => (await loadManualGroupService()).renameManualGroup(input), onSuccess: (_r, v) => refresh(v.groupId) }),
    deleteGroup: useMutation({ mutationFn: async (input: Parameters<ManualGroupService["deleteManualGroup"]>[0]) => (await loadManualGroupService()).deleteManualGroup(input), onSuccess: (_r, v) => refresh(v.groupId) }),
  };
}
