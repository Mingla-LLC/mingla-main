"use client";

import { useEffect } from "react";
import {
  analyticsAllowed,
  CONSENT_EVENT,
  sendSiteEvent,
  type SiteEventContext,
} from "../lib/clientAnalytics";

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

export function SiteRuntimeClient({ context }: { context: SiteEventContext }) {
  useEffect(() => {
    let sent = false;
    const emit = () => {
      if (sent || !analyticsAllowed()) return;
      sent = true;
      const referrer_class = referrerClass();
      void sendSiteEvent(context, "site_view", { referrer_class });
      void sendSiteEvent(context, "page_view", { referrer_class });
    };
    emit();
    window.addEventListener(CONSENT_EVENT, emit);
    return () => window.removeEventListener(CONSENT_EVENT, emit);
  }, [context]);
  return null;
}
