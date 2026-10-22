import type { DiscountDraft, DiscountFilter } from "./discountService";

export const discountKeys = {
  all: ["brand-discounts"] as const,
  access: (brandId: string) => ["brand-discounts", "access", brandId] as const,
  list: (brandId: string, filter: DiscountFilter) =>
    ["brand-discounts", "list", brandId, filter] as const,
  prices: (brandId: string) => ["brand-discounts", "prices", brandId] as const,
  preview: (brandId: string, draft: DiscountDraft) =>
    ["brand-discounts", "preview", brandId, JSON.stringify(draft)] as const,
  report: (brandId: string, from: string, to: string) =>
    ["brand-discounts", "report", brandId, from, to] as const,
  orderLines: (
    kind: "ticket" | "venue_order" | "reservation_deposit",
    orderId: string,
  ) => ["brand-discounts", "order-lines", kind, orderId] as const,
};
