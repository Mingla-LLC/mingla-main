"use client";

import { useEffect } from "react";
import {
  analyticsAllowed,
  captureSiteAdClickIds,
  CONSENT_EVENT,
  sendSiteEvent,
  type SiteEventContext,
} from "../lib/clientAnalytics";
import { outboundTarget } from "../lib/outboundLinks";

function referrerClass(): string {
  if (!document.referrer) return "direct";
  try {
    const host = new URL(document.referrer).hostname.toLowerCase();
    if (host === window.location.hostname) return "direct";
    if (host === "usemingla.com" || host.endsWith(".usemingla.com")) return "mingla";
    if (["google.com", "bing.com", "duckduckgo.com", "yahoo.com"].some((name) => host === name || host.endsWith(`.${name}`))) return "search";
    if (["instagram.com", "facebook.com", "tiktok.com", "x.com", "twitter.com"].some((name) => host === name || host.endsWith(`.${name}`))) return "social";
  } catch {
    return "other";
  }
  return "other";
}

/** A page address only (never the query or fragment), as the events route accepts it. */
function pagePath(): string | undefined {
  const path = window.location.pathname;
  return /^\/[A-Za-z0-9._~/-]{0,299}$/.test(path) ? path : undefined;
}

/*
 * #2829 W10 — every visitor event waits for consent (analyticsAllowed: the
 * visitor chose "Allow analytics"); nothing is queued from before it. The
 * visit and page view are sent once per page; offering cards count once when
 * half seen; a click on a link to another site counts as an outbound click
 * (Book links count as book clicks in TrackedLink instead).
 */
export function SiteRuntimeClient({ context }: { context: SiteEventContext }) {
  useEffect(() => {
    // toward #3697: first-party ad click may run before Sites analytics grant.
    captureSiteAdClickIds();
    let sent = false;
    let observer: IntersectionObserver | null = null;
    const seen = new Set<string>();
    const watchOfferings = () => {
      if (observer || typeof IntersectionObserver === "undefined") return;
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.offeringId;
          if (!entry.isIntersecting || !id || seen.has(id) || !analyticsAllowed()) continue;
          seen.add(id);
          observer?.unobserve(entry.target);
          void sendSiteEvent(context, "offering_view", { offering_id: id, page_path: pagePath() });
        }
      }, { threshold: 0.5 });
      document.querySelectorAll<HTMLElement>("[data-offering-id]").forEach((node) => observer?.observe(node));
    };
    const emit = () => {
      if (analyticsAllowed()) {
        captureSiteAdClickIds();
      }
      if (sent || !analyticsAllowed()) return;
      sent = true;
      const referrer_class = referrerClass();
      void sendSiteEvent(context, "site_view", { referrer_class });
      void sendSiteEvent(context, "page_view", { referrer_class, page_path: pagePath() });
      watchOfferings();
    };
    const onClick = (event: MouseEvent) => {
      if (!analyticsAllowed()) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.dataset.minglaTracked === "1") return;
      const target = outboundTarget(anchor.href, window.location.origin);
      if (!target) return;
      // keepalive: the visit continues on the other site.
      void sendSiteEvent(context, "outbound_click", { page_path: pagePath() });
    };
    emit();
    window.addEventListener(CONSENT_EVENT, emit);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener(CONSENT_EVENT, emit);
      document.removeEventListener("click", onClick, true);
      observer?.disconnect();
    };
  }, [context]);
  return null;
}
