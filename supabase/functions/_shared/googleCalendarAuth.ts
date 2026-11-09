// #4339 — the Google Calendar OAuth helper shared by growth-tools-book (makes
// the booking) and growth-tools-calendar-sync (reads its changes back).
//
// Both use the same OAuth REFRESH TOKEN for the booking calendar's account,
// packed in the governed GOOGLE_CALENDAR_KEYS bundle as
// "client_id|client_secret|refresh_token" (#3720 may append one opaque Drive
// segment, which Calendar ignores). This module reads NO environment: each
// function reads GOOGLE_CALENDAR_KEYS itself and passes the packed string in,
// so the env contract stays per function.
//
// Never logs a credential or a token: only the HTTP status of a failed refresh.

export interface CalendarKeys {
  clientId: string;
  clientSecret: string;
  refresh: string;
}

export function parseCalendarKeys(packed: string): CalendarKeys | null {
  // Governed manifest fields: calendar_client_id, calendar_client_secret,
  // calendar_refresh_token.
  const parts = packed.split("|");
  // #3720 extends this governed bundle with one opaque Drive segment. Calendar
  // deliberately keeps consuming exactly its original first three values.
  if (![3, 4].includes(parts.length) || parts.slice(0, 3).some((s) => s.length === 0)) return null;
  return { clientId: parts[0], clientSecret: parts[1], refresh: parts[2] };
}

/** Refresh token → access token. Null (logged by status only) on any failure. */
export async function refreshCalendarAccessToken(
  keys: CalendarKeys,
  options: { logTag: string; fetchImpl?: typeof fetch },
): Promise<string | null> {
  const doFetch = options.fetchImpl ?? fetch;
  try {
    const res = await doFetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: keys.clientId,
        client_secret: keys.clientSecret,
        refresh_token: keys.refresh,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) {
      console.error(`[${options.logTag}] token refresh failed`, res.status);
      return null;
    }
    const body = await res.json() as { access_token?: string };
    return body.access_token ?? null;
  } catch (err) {
    console.error(
      `[${options.logTag}] token refresh threw`,
      err instanceof Error ? err.name : "error",
    );
    return null;
  }
}
