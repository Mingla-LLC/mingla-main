import { useInfiniteQuery } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  listBrandGroupMedia,
  type BrandGroupMediaCursor,
  type BrandGroupMediaKind,
} from "../services/brandGroupMediaService";
import { brandGroupMediaKeys } from "./brandGroupMediaKeys";

export { brandGroupMediaKeys } from "./brandGroupMediaKeys";

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
