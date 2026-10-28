"use client";

import { useEffect, useState } from "react";
import {
  captureSiteAdClickIds,
  CONSENT_EVENT,
  CONSENT_KEY,
  sendSiteEvent,
} from "../lib/clientAnalytics";

type Consent = "granted" | "necessary" | null;

/*
 * #2829 W7 — `subject` names who is asking, so a travel brand's site does not
 * say "this restaurant". It defaults to the original wording.
 */
export function ConsentControl({ siteId, brandId, publicationId, subject = "this restaurant" }: { siteId: string; brandId: string; publicationId: string; subject?: string }) {
  const [choice, setChoice] = useState<Consent>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = localStorage.getItem(CONSENT_KEY);
      if (stored === "granted" || stored === "necessary") setChoice(stored);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const decide = async (next: Exclude<Consent, null>) => {
    localStorage.setItem(CONSENT_KEY, next);
    document.cookie = `${CONSENT_KEY}=${next}; Path=/; Max-Age=31536000; Secure; SameSite=Lax`;
    setChoice(next);
    setExpanded(false);
    if (next === "granted") {
      await sendSiteEvent({ siteId, brandId, publicationId }, "consent_granted");
      captureSiteAdClickIds();
      window.dispatchEvent(new Event(CONSENT_EVENT));
    } else {
      // toward #3697 / #3703: stamp Reject on any first-party ad click.
      captureSiteAdClickIds();
    }
  };

  if (choice && !expanded) return <button className="consent-link" onClick={() => setExpanded(true)}>Analytics choices</button>;
  return (
    <aside className="consent" aria-label="Analytics choices">
      <div><strong>Your choice</strong><p>{`Help ${subject} understand visits with optional, privacy-safe analytics. The website works either way.`}</p></div>
      <div className="consent-actions"><button onClick={() => decide("necessary")}>Only necessary</button><button className="accent" onClick={() => decide("granted")}>Allow analytics</button></div>
    </aside>
  );
}
