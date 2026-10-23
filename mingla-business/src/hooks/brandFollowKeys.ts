// Keep follow query keys independent from the stateful follow hook. Public
// pages can mock useBrandFollow without breaking the anonymous count query.
export const brandFollowKeys = {
  status: (brandId: string, userId: string) =>
    ["buyerBrand", "follow", brandId, userId] as const,
  followerCount: (brandId: string) =>
    ["buyerBrand", "followerCount", brandId] as const,
  followerCounts: (brandIds: readonly string[]) =>
    ["buyerBrand", "followerCounts", [...brandIds].sort().join(",")] as const,
  followerCountsAll: ["buyerBrand", "followerCounts"] as const,
  followerSummary: (brandId: string, userId: string) =>
    ["buyerBrand", "followerSummary", brandId, userId] as const,
};
