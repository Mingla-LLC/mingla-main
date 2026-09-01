"use client";

import { useEffect, useState } from "react";
import { CONSENT_EVENT, CONSENT_KEY, sendSiteEvent } from "../lib/clientAnalytics";

type Consent = "granted" | "necessary" | null;

export function ConsentControl({ siteId, brandId, publicationId }: { siteId: string; brandId: string; publicationId: string }) {
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
      window.dispatchEvent(new Event(CONSENT_EVENT));
    }
  };

  if (choice && !expanded) return <button className="consent-link" onClick={() => setExpanded(true)}>Analytics choices</button>;
  return (
    <aside className="consent" aria-label="Analytics choices">
      <div><strong>Your choice</strong><p>Help this restaurant understand visits with optional, privacy-safe analytics. The website works either way.</p></div>
      <div className="consent-actions"><button onClick={() => decide("necessary")}>Only necessary</button><button className="accent" onClick={() => decide("granted")}>Allow analytics</button></div>
    </aside>
  );
}
