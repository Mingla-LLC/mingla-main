import type { BrandGroupMediaKind } from "../services/brandGroupMediaService";

export const brandGroupMediaKeys = {
  all: ["brandGroupMedia"] as const,
  list: (conversationId: string, kind: BrandGroupMediaKind, userId: string) =>
    ["brandGroupMedia", "list", conversationId, kind, userId] as const,
  meta: (conversationId: string, fileIds: readonly string[], userId: string) =>
    ["brandGroupMedia", "meta", conversationId, [...fileIds].sort().join(","), userId] as const,
};
