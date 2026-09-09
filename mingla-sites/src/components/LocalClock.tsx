"use client";

import { useEffect, useState } from "react";

/*
 * #3149 wave 4 — THE ONLY LIVE CLAIM THIS SITE MAKES, AND WHAT IT COSTS TO
 * MAKE IT HONESTLY.
 *
 * "Open now · 22:03 in Lagos" was refused twice, because a block's opening
 * hours are DISPLAY STRINGS with no timezone behind them — "Open 24 hours" is
 * a sentence, not a schedule, and no amount of parsing turns it into one. A
 * site that read those strings and announced a venue was open would eventually
 * announce it at the wrong hour, in the wrong country, on a shut restaurant.
 *
 * What makes it buildable is a venue that is open ALL THE TIME. Then the only
 * moving part is the local clock, and a clock needs one fact: an IANA
 * timezone. The block carries that fact and an explicit `always_open` flag,
 * and the renderer prints nothing about opening unless BOTH are there — see
 * `hours_location` in the artifact contract. Nothing is inferred, ever.
 *
 * The time renders CLIENT-SIDE on purpose. A server-rendered clock is the
 * server's own moment, cached, and would be stale by however long the page sat
 * in front of the reader. So the markup ships an em dash — as the reference's
 * does — and the real minute replaces it on mount.
 */

/** The minute in that zone, or null when the platform cannot resolve it. */
export function localTimeIn(timezone: string, at: Date): string | null {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(at);
  } catch {
    return null;
  }
}

/**
 * "Africa/Lagos" → "Lagos".
 *
 * The city is READ OFF THE ZONE rather than typed alongside it, so the words
 * and the clock can never disagree — a brand that could type the city would
 * eventually have a page saying "in Lagos" over London's time.
 */
export function cityOfTimeZone(timezone: string): string | null {
  const last = timezone.split("/").at(-1);
  if (!last) return null;
  return last.replace(/_/g, " ");
}

const PLACEHOLDER = "—";

export function LocalClock({ timezone }: { timezone: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    // Once a minute would drift up to a minute behind the wall clock; twice is
    // enough to keep the displayed minute honest and costs nothing.
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);
  const time = now ? localTimeIn(timezone, now) : null;
  if (!time) return <span className="local-clock">{PLACEHOLDER}</span>;
  return <time className="local-clock" dateTime={time}>{time}</time>;
}

/**
 * The pill the reference carries over its hero: a live dot, the claim, the
 * local minute, and the city that minute belongs to.
 */
export function OpenNowPill({ timezone }: { timezone: string }) {
  const city = cityOfTimeZone(timezone);
  if (!city) return null;
  return (
    <p className="open-pill">
      <span className="open-pill-dot" aria-hidden="true" />
      <span>
        Open now · <LocalClock timezone={timezone} /> in {city}
      </span>
    </p>
  );
}

/**
 * The same fact inside an hours card, phrased as the reference phrases it
 * there: "Now 22:05 in Lagos".
 */
export function LocalNowLine({ timezone }: { timezone: string }) {
  const city = cityOfTimeZone(timezone);
  if (!city) return null;
  return (
    <span className="hours-now">
      Now <LocalClock timezone={timezone} /> in {city}
    </span>
  );
}
