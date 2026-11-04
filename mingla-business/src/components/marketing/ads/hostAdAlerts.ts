/**
 * #4238 media-buyer, wave D — the in-app notes a buyer looks for: "still
 * learning", spending faster or slower than planned, and why an ad is
 * paused. Pure; days are counted in the page's own calendar.
 */
import { hostAdDayOf } from "./hostAdBuilderRules";
import { formatHostAdMoneyCents } from "./hostAdMoney";

const DAY_MS = 86_400_000;

function dayNumber(day: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return match
    ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS
    : null;
}

/** Day N of the run (day 1 = the day it started), in the page's zone. */
export function hostAdRunDay(
  startedAt: string | null,
  nowIso: string,
  timezone?: string | null,
): number | null {
  if (!startedAt) return null;
  const start = dayNumber(hostAdDayOf(startedAt, timezone));
  const today = dayNumber(hostAdDayOf(nowIso, timezone));
  if (start === null || today === null || today < start) return null;
  return today - start + 1;
}

/** "Still learning" for the first week of a live ad. */
export function hostAdLearningAlert(input: {
  name: string;
  live: boolean;
  startedAt: string | null;
  nowIso: string;
  timezone?: string | null;
}): { title: string; body: string } | null {
  if (!input.live) return null;
  const day = hostAdRunDay(input.startedAt, input.nowIso, input.timezone);
  if (day === null || day > 7) return null;
  return {
    title: `${input.name} is still learning`,
    body: `Day ${day}. The apps are still finding who buys. Leave it running for about a week before changing it.`,
  };
}

/**
 * Spend so far vs what the plan expected by today (daily × days run,
 * capped at the total). Within 25% either way says nothing.
 */
export function hostAdPacingAlert(input: {
  live: boolean;
  spentCents: number | null;
  dailyCents: number | null;
  capCents: number | null;
  startedAt: string | null;
  nowIso: string;
  timezone?: string | null;
  currency: string | null;
}): { title: string; body: string; tone: "slow" | "fast" } | null {
  if (!input.live || input.spentCents === null || !input.dailyCents || !input.currency) {
    return null;
  }
  const day = hostAdRunDay(input.startedAt, input.nowIso, input.timezone);
  if (day === null || day < 2) return null;
  const planned = Math.min(
    input.capCents ?? Number.MAX_SAFE_INTEGER,
    input.dailyCents * (day - 1),
  );
  if (planned <= 0) return null;
  const ratio = input.spentCents / planned;
  const money = (cents: number) => formatHostAdMoneyCents(cents, input.currency) ?? "";
  const line = `${money(input.spentCents)} spent of ${money(planned)} planned by today.`;
  if (ratio < 0.75) {
    return {
      tone: "slow",
      title: "Spending slower than planned",
      body: day <= 7
        ? `${line} This is normal in the first week.`
        : `${line} A wider audience or a higher budget usually helps.`,
    };
  }
  if (ratio > 1.25) {
    return {
      tone: "fast",
      title: "Spending faster than planned",
      body: `${line} Your total is still a hard limit; the ad stops before it goes over.`,
    };
  }
  return null;
}

/** "Paused because…" from the server's pause reason (same words as the detail page). */
export function hostAdPausedReason(reason: string | null | undefined): string | null {
  switch (reason) {
    case "destination_unavailable":
      return "Paused because the page it sends people to has ended or isn't public any more. Publish the page again, then resume.";
    case "destination_check_failed":
      return "Paused because we couldn't check that your page is still public. Your money is safe; we'll try again shortly.";
    case "end_date_passed":
      return "Paused because it reached its end date.";
    case "spend_fetch_failed":
      return "Paused because we couldn't check how much it has spent. Your money is safe; we'll try again shortly.";
    case "cap_reached":
      return "Paused because it used its budget. It won't spend more than you set.";
    case "sold_out":
      return "Paused because all its tickets sold out. Your money is safe. Add tickets to start it again.";
    default:
      return null;
  }
}

/** Live edits: once a day. The time the next edit is allowed, or null (now). */
export function hostAdNextLiveEditAt(lastEditAt: string | null, nowIso: string): string | null {
  if (!lastEditAt) return null;
  const next = Date.parse(lastEditAt) + DAY_MS;
  return Number.isFinite(next) && next > Date.parse(nowIso)
    ? new Date(next).toISOString()
    : null;
}
