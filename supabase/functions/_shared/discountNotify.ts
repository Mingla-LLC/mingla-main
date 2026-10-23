// Issue #3872 — pure copy and delivery adapter for discount maintenance.

import { notifyBrandRoles } from "./businessNotifyTriggers.ts";

export const DISCOUNT_NOTIFICATION_ROLES = [
  "brand_owner",
  "brand_admin",
  "finance_manager",
  "marketing_manager",
] as const;

export interface DiscountNotice {
  discountId: string;
  brandId: string;
  type:
    | "business.discount_limit_80"
    | "business.discount_ended"
    | "business.discount_needs_attention";
  name: string;
  left?: number | null;
  reason?: string | null;
}

export function discountNoticeCopy(notice: DiscountNotice): {
  title: string;
  body: string;
} {
  if (notice.type === "business.discount_limit_80") {
    return {
      title: "Discount almost used up",
      body: `${notice.name} has ${Math.max(0, Number(notice.left) || 0)} left.`,
    };
  }
  if (notice.type === "business.discount_ended") {
    const reason = notice.reason === "count"
      ? "it sold its limit"
      : notice.reason === "uses"
      ? "all uses are taken"
      : "its end date passed";
    return {
      title: "Discount ended",
      body: `${notice.name} has ended (${reason}).`,
    };
  }
  const reason = notice.reason === "currency_mismatch"
    ? "no longer matches your currency"
    : "lost an item it applied to";
  return {
    title: "A discount needs attention",
    body: `${notice.name} ${reason}. Open Discounts to fix it.`,
  };
}

export async function sendDiscountNotice(
  client: unknown,
  notice: DiscountNotice,
): Promise<void> {
  const copy = discountNoticeCopy(notice);
  await notifyBrandRoles(client as Parameters<typeof notifyBrandRoles>[0], {
    brandId: notice.brandId,
    roles: DISCOUNT_NOTIFICATION_ROLES,
    type: notice.type,
    title: copy.title,
    body: copy.body,
    data: { discountId: notice.discountId },
    relatedId: notice.discountId,
    relatedType: "discount",
    idempotencyKey: `discount:${notice.discountId}:${notice.type}`,
    deepLink:
      `mingla-business://brand/${notice.brandId}/discounts?focus=${notice.discountId}`,
  });
}
