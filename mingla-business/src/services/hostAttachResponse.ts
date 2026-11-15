/**
 * #4238 W3-3 — the host-attribution-attach answer, one owner for both apps'
 * services (appsFlyerService.ts, appsFlyerService.web.ts) and the host web
 * attach chunk (hostAttributionAttach.web.ts). Pure; imports nothing.
 */

/** What host-attribution-attach answered. newHost null = unknown. */
export interface HostAttachResult {
  newHost: boolean | null;
  hostSignupEventId: string | null;
}

/** Pure: the server answer, or null when it is not a success. */
export function parseHostAttachResponse(data: unknown): HostAttachResult | null {
  if (!data || typeof data !== "object") return null;
  const body = data as { ok?: unknown; new_host?: unknown; host_signup_event_id?: unknown };
  if (body.ok !== true) return null;
  return {
    newHost: typeof body.new_host === "boolean" ? body.new_host : null,
    hostSignupEventId:
      typeof body.host_signup_event_id === "string" ? body.host_signup_event_id : null,
  };
}
