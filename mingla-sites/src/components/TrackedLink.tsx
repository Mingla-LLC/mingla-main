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
    // #2829 W10 — a Book / offering link is a "book click" (its own count on
    // the owner's Website overview); other calls to action stay cta_click.
    await sendSiteEvent(context, ctaKind === "offering" ? "book_click" : "cta_click", {
      cta_kind: ctaKind,
      offering_id: offeringId,
      page_path: window.location.pathname,
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
  // data-offering-id: the offering-view observer (SiteRuntimeClient) counts a
  // card once it is seen; data-mingla-tracked: never also an outbound click.
  return <a href={href} className={className} onClick={onClick} data-mingla-tracked="1" data-offering-id={ctaKind === "offering" ? offeringId : undefined}>{children}</a>;
}
