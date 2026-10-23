/**
 * toward #3697 — Snapchat campaign spend stats for admin-ad-spend-sync.
 *
 * Snap's stats endpoint with granularity=DAY only accepts start_time/end_time
 * on the AD ACCOUNT's local day boundary, in ISO 8601 with that zone's offset
 * (e.g. 2019-11-12T00:00:00-08:00), over at most 31 days
 * (https://developers.snap.com/api/marketing-api/Ads-API/measurement).
 *
 * Live bug (2026-10-20): the worker called `${apiBase}/v1/campaigns/...` on an
 * apiBase that already ends in /v1 (→ 404) with UTC midnights over 31 days,
 * so every launched Snap campaign was paused with spend_fetch_failed.
 */

import { AdApiError } from "./adChannelCore.ts";
import {
  snapchatApi,
  type SnapchatClient,
  snapchatFetchAdAccount,
} from "./snapchat.ts";

/** Days of stats per sync (inclusive of today); Snap's ceiling is 31. */
export const SNAPCHAT_STATS_WINDOW_DAYS = 28;

const DAY_MS = 86_400_000;

/** True when Intl recognises the IANA zone name. */
export function isValidTimeZone(timeZone: string | null | undefined): boolean {
  if (!timeZone || typeof timeZone !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClockAt(instantMs: number, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMs));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Zone offset in minutes (local − UTC) at a given instant. */
function offsetMinutesAt(instantMs: number, timeZone: string): number {
  const w = wallClockAt(instantMs, timeZone);
  const asUtc = Date.UTC(
    w.year,
    w.month - 1,
    w.day,
    w.hour,
    w.minute,
    w.second,
  );
  return Math.round((asUtc - Math.floor(instantMs / 1000) * 1000) / 60_000);
}

/** UTC instant of local 00:00 on the given civil date in the zone. */
function localMidnightInstant(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): number {
  const guess = Date.UTC(year, month - 1, day);
  let instant = guess - offsetMinutesAt(guess, timeZone) * 60_000;
  const corrected = guess - offsetMinutesAt(instant, timeZone) * 60_000;
  if (corrected !== instant) instant = corrected;
  return instant;
}

function pad(n: number, width = 2): string {
  return String(Math.abs(n)).padStart(width, "0");
}

/** ISO 8601 local wall-clock time with offset: 2026-10-20T00:00:00-07:00. */
function formatLocalIso(instantMs: number, timeZone: string): string {
  const w = wallClockAt(instantMs, timeZone);
  const off = offsetMinutesAt(instantMs, timeZone);
  const sign = off < 0 ? "-" : "+";
  const offAbs = Math.abs(off);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${
    pad(w.minute)
  }:${pad(w.second)}${sign}${pad(Math.floor(offAbs / 60))}:${pad(offAbs % 60)}`;
}

export interface SnapchatStatsWindow {
  /** The zone actually used (UTC when the account zone is unknown/invalid). */
  timeZone: string;
  start_time: string;
  end_time: string;
}

/**
 * Local-midnight window of `days` account days ending at the NEXT local
 * midnight (so today's partial spend is included). Unknown zone → UTC.
 */
export function snapchatStatsWindow(
  accountTimeZone: string | null | undefined,
  now: Date = new Date(),
  days: number = SNAPCHAT_STATS_WINDOW_DAYS,
): SnapchatStatsWindow {
  const timeZone = isValidTimeZone(accountTimeZone)
    ? String(accountTimeZone)
    : "UTC";
  const span = Math.max(1, Math.min(SNAPCHAT_STATS_WINDOW_DAYS, days));
  const today = wallClockAt(now.getTime(), timeZone);
  // Civil-date arithmetic on a UTC anchor (no zone math involved).
  const civil = (deltaDays: number) => {
    const d = new Date(
      Date.UTC(today.year, today.month - 1, today.day) + deltaDays * DAY_MS,
    );
    return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()] as const;
  };
  const [ey, em, ed] = civil(1);
  const [sy, sm, sd] = civil(1 - span);
  return {
    timeZone,
    start_time: formatLocalIso(
      localMidnightInstant(sy, sm, sd, timeZone),
      timeZone,
    ),
    end_time: formatLocalIso(
      localMidnightInstant(ey, em, ed, timeZone),
      timeZone,
    ),
  };
}

/** Relative path (apiBase already ends in /v1) for a campaign's daily stats. */
export function snapchatCampaignStatsPath(
  externalCampaignId: string,
  window: SnapchatStatsWindow,
): string {
  const query = new URLSearchParams({
    granularity: "DAY",
    fields: "impressions,swipes,spend",
    start_time: window.start_time,
    end_time: window.end_time,
  });
  return `campaigns/${
    encodeURIComponent(externalCampaignId)
  }/stats?${query.toString()}`;
}

/** Relative path for one ad squad's daily spend, result, reach and frequency. */
export function snapchatAdSquadStatsPath(
  externalAdSquadId: string,
  window: SnapchatStatsWindow,
): string {
  const query = new URLSearchParams({
    granularity: "DAY",
    fields:
      "impressions,reach,frequency,swipes,spend,conversion_purchases,conversion_page_views",
    start_time: window.start_time,
    end_time: window.end_time,
  });
  return `adsquads/${
    encodeURIComponent(externalAdSquadId)
  }/stats?${query.toString()}`;
}

/**
 * Account timezone, read once per ad account per sync run (cache supplied by
 * the caller). Any failure reading it resolves to null → UTC fallback; the
 * stats call itself still fails closed if Snap refuses that window.
 */
export async function resolveSnapchatAccountTimeZone(
  client: SnapchatClient,
  cache?: Map<string, string | null>,
): Promise<string | null> {
  if (cache?.has(client.adAccountId)) {
    return cache.get(client.adAccountId) ?? null;
  }
  let timeZone: string | null = null;
  try {
    const account = await snapchatFetchAdAccount(client);
    timeZone = isValidTimeZone(account.timezone) ? account.timezone : null;
  } catch {
    timeZone = null;
  }
  cache?.set(client.adAccountId, timeZone);
  return timeZone;
}

/**
 * Fetches a campaign's DAY stats payload in the account timezone. Errors are
 * rethrown as AdApiError whose message names the HTTP status and Snap's
 * error_code (token already scrubbed by snapchatApi).
 */
export async function fetchSnapchatCampaignStats(
  client: SnapchatClient,
  externalCampaignId: string,
  opts: { now?: Date; timeZoneCache?: Map<string, string | null> } = {},
): Promise<Record<string, unknown>> {
  const timeZone = await resolveSnapchatAccountTimeZone(
    client,
    opts.timeZoneCache,
  );
  const window = snapchatStatsWindow(timeZone, opts.now ?? new Date());
  const path = snapchatCampaignStatsPath(externalCampaignId, window);
  try {
    return await snapchatApi(client, "GET", path);
  } catch (err) {
    if (err instanceof AdApiError) {
      const codes = [err.code, err.subcode ? `error_code=${err.subcode}` : null]
        .filter(Boolean).join(" ");
      throw new AdApiError({
        platform: "snapchat",
        code: err.code,
        subcode: err.subcode,
        traceId: err.traceId,
        message: `snapchat_stats_fetch_failed (${
          codes || "unknown"
        }; tz=${window.timeZone}): ${err.message}`,
      });
    }
    throw err;
  }
}

/** Fetch one ad squad's per-day metrics using the same account-timezone guard. */
export async function fetchSnapchatAdSquadStats(
  client: SnapchatClient,
  externalAdSquadId: string,
  opts: { now?: Date; timeZoneCache?: Map<string, string | null> } = {},
): Promise<Record<string, unknown>> {
  const timeZone = await resolveSnapchatAccountTimeZone(
    client,
    opts.timeZoneCache,
  );
  const window = snapchatStatsWindow(timeZone, opts.now ?? new Date());
  const path = snapchatAdSquadStatsPath(externalAdSquadId, window);
  try {
    return await snapchatApi(client, "GET", path);
  } catch (err) {
    if (err instanceof AdApiError) {
      const codes = [err.code, err.subcode ? `error_code=${err.subcode}` : null]
        .filter(Boolean).join(" ");
      throw new AdApiError({
        platform: "snapchat",
        code: err.code,
        subcode: err.subcode,
        traceId: err.traceId,
        message: `snapchat_adsquad_stats_fetch_failed (${
          codes || "unknown"
        }; tz=${window.timeZone}): ${err.message}`,
      });
    }
    throw err;
  }
}
