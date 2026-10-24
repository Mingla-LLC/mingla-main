// Keep follow query keys independent from the stateful follow hook. Public
// screens can mock useBrandFollow without breaking the anonymous count query.
export const brandFollowKeys = {
  status: (brandId: string, userId: string) =>
    ["consumerBrand", "follow", brandId, userId] as const,
  list: (userId: string) => ["consumerBrand", "followList", userId] as const,
  followerCount: (brandId: string) =>
    ["consumerBrand", "followerCount", brandId] as const,
  followerCounts: (brandIds: readonly string[]) =>
    [
      "consumerBrand",
      "followerCounts",
      [...brandIds].sort().join(","),
    ] as const,
  followerCountsAll: ["consumerBrand", "followerCounts"] as const,
};
