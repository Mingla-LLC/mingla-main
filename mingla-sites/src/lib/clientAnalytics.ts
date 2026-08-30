"use client";

import { CONSENT_KEY } from "./consent";

export { CONSENT_KEY } from "./consent";
export const CONSENT_EVENT = "mingla:analytics-consent";

export type SiteEventContext = {
  siteId: string;
  brandId: string;
  publicationId: string;
};

export function analyticsAllowed(): boolean {
  return typeof window !== "undefined" &&
    window.localStorage.getItem(CONSENT_KEY) === "granted";
}

export async function sendSiteEvent(
  context: SiteEventContext,
  eventName: string,
  fields: Record<string, string | undefined> = {},
): Promise<void> {
  if (!analyticsAllowed()) return;
  await fetch("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event_name: eventName,
      occurred_at: new Date().toISOString(),
      site_id: context.siteId,
      brand_id: context.brandId,
      publication_id: context.publicationId,
      page_role: "home",
      consent_policy_version: "sites-v1",
      event_id: crypto.randomUUID(),
      ...fields,
    }),
  }).catch(() => undefined);
}
