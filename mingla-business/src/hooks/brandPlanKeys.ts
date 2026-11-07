export const brandPlanKeys = {
  all: ["brandPlan"] as const,
  brand: (brandId: string) => ["brandPlan", "window", brandId] as const,
  window: (brandId: string, from: string, to: string, userId: string) =>
    ["brandPlan", "window", brandId, from, to, userId] as const,
};
