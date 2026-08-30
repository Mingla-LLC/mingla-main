"use client";

import type { MouseEvent, ReactNode } from "react";
import { analyticsAllowed, sendSiteEvent, type SiteEventContext } from "../lib/clientAnalytics";

export function TrackedLink({
  href,
  children,
  className,
  context,
  ctaKind,
  offeringId,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  context: SiteEventContext;
  ctaKind: "offering" | "reservation" | "checkout" | "contact" | "menu";
  offeringId?: string;
}) {
  const onClick = async (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      !analyticsAllowed()
    ) return;
    event.preventDefault();
    const target = new URL(href);
    await sendSiteEvent(context, "cta_click", {
      cta_kind: ctaKind,
      offering_id: offeringId,
    });
    try {
      const response = await fetch("/api/attribution", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...context,
          event_name: ctaKind === "reservation" ? "reservation_start" : "checkout_start",
          source_kind: "site",
          source_ref: ctaKind,
        }),
      });
      const result = await response.json();
      if (response.ok && result?.ok && typeof result.data?.token === "string") {
        target.searchParams.set("site_attribution", result.data.token);
      }
    } catch {
      // Attribution is optional and can never block canonical Mingla commerce.
    }
    window.location.assign(target.toString());
  };
  return <a href={href} className={className} onClick={onClick}>{children}</a>;
}
