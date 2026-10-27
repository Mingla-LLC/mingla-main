"use client";

import { CONSENT_KEY } from "./consent";

export { CONSENT_KEY } from "./consent";
export const CONSENT_EVENT = "mingla:analytics-consent";
const AD_CLICK_KEY = "mingla_ad_click_v1";

export type SiteEventContext = {
  siteId: string;
  brandId: string;
  publicationId: string;
};

export function analyticsAllowed(): boolean {
  return typeof window !== "undefined" &&
    window.localStorage.getItem(CONSENT_KEY) === "granted";
}

function siteConsentChoice(): "granted" | "necessary" | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(CONSENT_KEY);
  return stored === "granted" || stored === "necessary" ? stored : null;
}

function storedSiteClickId(): string | null {
  try {
    const raw = window.sessionStorage.getItem(AD_CLICK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { clickId?: unknown };
    return typeof parsed.clickId === "string" ? parsed.clickId : null;
  } catch {
    return null;
  }
}

/**
 * toward #3697 Wave 0a: first-party ad click before/after Sites consent banner.
 * "necessary" / Reject → stamp rejected when a click exists; no new vendor work.
 */
export function captureSiteAdClickIds(brandSlug?: string | null): void {
  if (typeof window === "undefined") return;
  const choice = siteConsentChoice();
  const existingClickId = storedSiteClickId();
  // toward #3697: Accept/Reject stamp the stored touch — never a second visit row.
  if (choice === "necessary") {
    if (existingClickId) {
      void fetch("/api/ad-touch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "consent",
          click_id: existingClickId,
          consent_state: "rejected",
        }),
      }).catch(() => undefined);
    }
    return;
  }
  if (choice === "granted" && existingClickId) {
    void fetch("/api/ad-touch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "consent",
        click_id: existingClickId,
        consent_state: "granted",
      }),
    }).catch(() => undefined);
    return;
  }
  try {
    const params = new URLSearchParams(window.location.search);
    const fbclid = params.get("fbclid");
    const ttclid = params.get("ttclid");
    const sccid = params.get("sccid") ?? params.get("ScCid");
    const gclid = params.get("gclid");
    const rdtCid = params.get("rdt_cid");
    const mcId = params.get("mc_id");
    const afCId = params.get("af_c_id") ?? params.get("c_id");
    const utm: Record<string, string> = {};
    for (const k of [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
    ]) {
      const v = params.get(k);
      if (v) utm[k] = v;
    }
    const external = fbclid ?? ttclid ?? sccid ?? gclid ?? rdtCid ?? null;
    if (
      external === null && mcId === null && afCId === null &&
      Object.keys(utm).length === 0
    ) {
      return;
    }
    const network = fbclid
      ? "meta"
      : ttclid
      ? "tiktok"
      : sccid
      ? "snapchat"
      : rdtCid
      ? "reddit"
      : gclid
      ? "google"
      : "other";
    const consentState = choice === "granted" ? "granted" : "pending";
    void fetch("/api/ad-touch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "touch",
        network,
        external_click_id: external,
        mc_id: mcId,
        af_c_id: afCId,
        utm,
        brand_slug: brandSlug ?? null,
        consent_state: consentState,
      }),
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { click_id?: string };
        if (typeof data.click_id === "string" && !storedSiteClickId()) {
          window.sessionStorage.setItem(
            AD_CLICK_KEY,
            JSON.stringify({ clickId: data.click_id }),
          );
        }
      })
      .catch(() => undefined);
  } catch {
    // Fail-open.
  }
}

export async function sendSiteEvent(
  context: SiteEventContext,
  eventName: string,
  fields: Record<string, string | undefined> = {},
): Promise<void> {
  // #2829 W10 — a preview (the team's or a shared link) is never counted.
  if (!analyticsAllowed() || context.publicationId.startsWith("preview-")) return;
  await fetch("/api/events", {
    method: "POST",
    // An outbound or Book click navigates away; the event still arrives.
    keepalive: true,
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
