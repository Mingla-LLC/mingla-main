import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  fileMeta,
  listBrandGroupMedia,
  type BrandGroupMediaCursor,
  type BrandGroupMediaKind,
} from "../services/brandGroupMediaService";

export const brandGroupMediaKeys = {
  all: ["brandGroupMedia"] as const,
  list: (conversationId: string, kind: BrandGroupMediaKind, userId: string) =>
    ["brandGroupMedia", "list", conversationId, kind, userId] as const,
  meta: (conversationId: string, fileIds: readonly string[], userId: string) =>
    ["brandGroupMedia", "meta", conversationId, [...fileIds].sort().join(","), userId] as const,
};

export function useBrandGroupMediaPages(conversationId: string | null, kind: BrandGroupMediaKind) {
  const { isAuthReady, user } = useAuth();
  const userId = user?.id ?? null;
  const enabled = isAuthReady && userId !== null && conversationId !== null;
  return useInfiniteQuery({
    queryKey: enabled && conversationId && userId
      ? brandGroupMediaKeys.list(conversationId, kind, userId)
      : (["brandGroupMedia", "list-disabled", kind] as const),
    enabled,
    initialPageParam: null as BrandGroupMediaCursor | null,
    queryFn: ({ pageParam }) => {
      if (!conversationId) throw new Error("brand_group_conversation_required");
      return listBrandGroupMedia({ conversationId, kind, cursor: pageParam });
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 30_000,
  });
}

export function useBrandGroupFileMeta(conversationId: string | null, fileIds: readonly string[]) {
  const { isAuthReady, user } = useAuth();
  const userId = user?.id ?? null;
  const enabled = isAuthReady && userId !== null && conversationId !== null && fileIds.length > 0;
  return useQuery({
    queryKey: enabled && conversationId && userId
      ? brandGroupMediaKeys.meta(conversationId, fileIds, userId)
      : (["brandGroupMedia", "meta-disabled"] as const),
    enabled,
    queryFn: () => {
      if (!conversationId) throw new Error("brand_group_conversation_required");
      return fileMeta(conversationId, fileIds);
    },
    staleTime: 30_000,
  });
}
