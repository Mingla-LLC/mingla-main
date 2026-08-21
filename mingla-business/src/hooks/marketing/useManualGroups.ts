import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { marketingKeys } from "./marketingKeys";
import {
  addManualGroupPeople,
  createManualGroup,
  deleteManualGroup,
  getManualGroup,
  getManualGroupBookPicker,
  listManualGroups,
  removeManualGroupPeople,
  renameManualGroup,
} from "../../services/marketing/manualGroupService";

const STALE_TIME_MS = 60_000;

export const useManualGroups = (brandId: string | null, enabled: boolean) =>
  useQuery({ queryKey: brandId ? marketingKeys.people.groups.list(brandId) : ["marketing", "people", "groups", "disabled"],
    queryFn: () => listManualGroups(brandId as string), enabled: enabled && !!brandId, staleTime: STALE_TIME_MS });

export const useManualGroup = (brandId: string | null, groupId: string | null, search: string, enabled = true) => {
  const query = useInfiniteQuery({
    queryKey: brandId && groupId ? marketingKeys.people.groups.detail(brandId, groupId, search) : ["marketing", "people", "group", "disabled"],
    queryFn: ({ pageParam }) => getManualGroup({ brandId: brandId as string, groupId: groupId as string, search, cursor: pageParam }),
    initialPageParam: null as Record<string, unknown> | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: enabled && !!brandId && !!groupId,
    staleTime: STALE_TIME_MS,
  });
  const first = query.data?.pages[0];
  return { ...query, data: first ? { ...first, members: query.data?.pages.flatMap((page) => page.members) ?? [], nextCursor: query.data?.pages.at(-1)?.nextCursor ?? null } : undefined };
};

export const useManualGroupBookPicker = (brandId: string | null, groupId: string | null, search: string, enabled = true) => {
  const query = useInfiniteQuery({
    queryKey: brandId ? marketingKeys.people.groups.picker(brandId, groupId, search) : ["marketing", "people", "group-picker", "disabled"],
    queryFn: ({ pageParam }) => getManualGroupBookPicker({ brandId: brandId as string, groupId, search, cursor: pageParam }),
    initialPageParam: null as Record<string, unknown> | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: enabled && !!brandId,
    staleTime: STALE_TIME_MS,
  });
  return { ...query, data: query.data ? { rows: query.data.pages.flatMap((page) => page.rows), nextCursor: query.data.pages.at(-1)?.nextCursor ?? null } : undefined };
};

export function useManualGroupMutations(brandId: string) {
  const client = useQueryClient();
  const refresh = async (groupId?: string): Promise<void> => {
    await Promise.all([
      client.invalidateQueries({ queryKey: marketingKeys.people.groups.all(brandId) }),
      client.invalidateQueries({ queryKey: marketingKeys.people.all(brandId) }),
      client.invalidateQueries({ queryKey: marketingKeys.audiences.all }),
      ...(groupId ? [client.invalidateQueries({ queryKey: [...marketingKeys.people.groups.all(brandId), "detail", groupId] })] : []),
    ]);
  };
  return {
    create: useMutation({ mutationFn: createManualGroup, onSuccess: (r) => refresh(r.group.groupId) }),
    add: useMutation({ mutationFn: addManualGroupPeople, onSuccess: (r) => refresh(r.group.groupId) }),
    remove: useMutation({ mutationFn: removeManualGroupPeople, onSuccess: (_r, v) => refresh(v.groupId) }),
    rename: useMutation({ mutationFn: renameManualGroup, onSuccess: (_r, v) => refresh(v.groupId) }),
    deleteGroup: useMutation({ mutationFn: deleteManualGroup, onSuccess: (_r, v) => refresh(v.groupId) }),
  };
}
