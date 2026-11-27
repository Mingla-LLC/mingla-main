// #4640 — stable scheduler identities and the private form-to-booking handoff.
// Public callers may name a profile key. Calendar ids, notification addresses
// and saved form answers are read only with the service role.

export type SchedulerAudience = "host" | "creator" | "local";

export interface SchedulerProfile {
  key: string;
  name: string;
  audience: SchedulerAudience;
  calendarId: string;
  timeZone: string;
  notifyTo: string;
  durationMinutes: number;
  weekdays: number[];
  startMinute: number;
  endMinute: number;
  minNoticeMinutes: number;
  lookaheadDays: number;
  maxOpenDays: number;
}

export interface SchedulerConfig {
  supabaseUrl?: string;
  serviceKey?: string;
  defaultCalendarId?: string;
}

export interface BookingHandoff {
  submissionId: string;
  scheduler: SchedulerProfile;
  payload: Record<string, unknown>;
}

/** Restore saved answers as defaults while preserving the visitor's edits. */
export function mergeBookingHandoff(
  body: Record<string, unknown>,
  handoff: BookingHandoff,
): Record<string, unknown> {
  return {
    ...handoff.payload,
    ...body,
    audience: handoff.scheduler.audience,
    scheduler_key: handoff.scheduler.key,
    form_submission_id: handoff.submissionId,
  };
}

const KEY_RE = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

export function defaultSchedulerKey(audience: unknown): string {
  return audience === "creator"
    ? "creator-call"
    : audience === "local"
    ? "local-call"
    : "host-demo";
}

export function schedulerKey(
  value: unknown,
  audience: unknown = "host",
): string {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "";
  return KEY_RE.test(key) ? key : defaultSchedulerKey(audience);
}

/** The three pre-registry public routes stay available during a transient DB read failure. */
export function legacySchedulerProfile(
  key: string,
  config: SchedulerConfig,
): SchedulerProfile | null {
  const audience = key === "host-demo"
    ? "host"
    : key === "creator-call"
    ? "creator"
    : key === "local-call"
    ? "local"
    : null;
  if (!audience) return null;
  return {
    key,
    name: audience === "host"
      ? "Host demo"
      : audience === "creator"
      ? "Creators call"
      : "Locals call",
    audience,
    calendarId: config.defaultCalendarId || "primary",
    timeZone: "America/New_York",
    notifyTo: "seth@usemingla.com",
    durationMinutes: 20,
    weekdays: [1, 2, 3, 4, 5],
    startMinute: 300,
    endMinute: 1200,
    minNoticeMinutes: 720,
    lookaheadDays: 45,
    maxOpenDays: 31,
  };
}

function availability(
  raw: unknown,
):
  | Pick<
    SchedulerProfile,
    | "weekdays"
    | "startMinute"
    | "endMinute"
    | "minNoticeMinutes"
    | "lookaheadDays"
    | "maxOpenDays"
  >
  | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const a = raw as Record<string, unknown>;
  const weekdays = Array.isArray(a.weekdays)
    ? a.weekdays.filter((v): v is number =>
      Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 6
    )
    : [];
  const n = (key: string) =>
    typeof a[key] === "number" && Number.isInteger(a[key])
      ? Number(a[key])
      : NaN;
  const startMinute = n("start_minute");
  const endMinute = n("end_minute");
  const minNoticeMinutes = n("min_notice_minutes");
  const lookaheadDays = n("lookahead_days");
  const maxOpenDays = n("max_open_days");
  if (
    !weekdays.length || !Number.isFinite(startMinute) ||
    !Number.isFinite(endMinute) || !Number.isFinite(minNoticeMinutes) ||
    !Number.isFinite(lookaheadDays) || !Number.isFinite(maxOpenDays)
  ) return null;
  return {
    weekdays: [...new Set(weekdays)],
    startMinute,
    endMinute,
    minNoticeMinutes,
    lookaheadDays,
    maxOpenDays,
  };
}

function profileOf(
  raw: unknown,
  config: SchedulerConfig,
): SchedulerProfile | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const a = availability(r.availability);
  const key = typeof r.key === "string" ? r.key : "";
  const audience = r.audience;
  const calendarRaw = typeof r.calendar_id === "string" ? r.calendar_id : "";
  if (
    !KEY_RE.test(key) ||
    !["host", "creator", "local"].includes(String(audience)) || !a
  ) return null;
  return {
    key,
    name: String(r.name ?? key),
    audience: audience as SchedulerAudience,
    calendarId: calendarRaw === "environment-default"
      ? config.defaultCalendarId || "primary"
      : calendarRaw,
    timeZone: String(r.time_zone ?? "America/New_York"),
    notifyTo: String(r.notify_to ?? "seth@usemingla.com"),
    durationMinutes: Number(r.duration_minutes ?? 20),
    ...a,
  };
}

function restHeaders(key: string): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest)).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

export async function loadSchedulerProfile(
  key: string,
  config: SchedulerConfig,
): Promise<SchedulerProfile | null> {
  const base = (config.supabaseUrl ?? "").replace(/\/+$/, "");
  const serviceKey = config.serviceKey ?? "";
  if (!KEY_RE.test(key) || !base || !serviceKey) return null;
  try {
    const res = await fetch(
      `${base}/rest/v1/booking_scheduler_profiles?key=eq.${
        encodeURIComponent(key)
      }&enabled=eq.true&select=*`,
      { headers: restHeaders(serviceKey) },
    );
    if (!res.ok) return null;
    const rows = await res.json().catch(() => []) as unknown;
    return Array.isArray(rows) ? profileOf(rows[0], config) : null;
  } catch {
    return null;
  }
}

export async function resolveBookingHandoff(
  token: unknown,
  expectedKey: unknown,
  config: SchedulerConfig,
): Promise<BookingHandoff | null> {
  const bearer = typeof token === "string" ? token.trim() : "";
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(bearer)) return null;
  const base = (config.supabaseUrl ?? "").replace(/\/+$/, "");
  const serviceKey = config.serviceKey ?? "";
  if (!base || !serviceKey) return null;
  const expected = typeof expectedKey === "string" && KEY_RE.test(expectedKey)
    ? expectedKey
    : null;
  const res = await fetch(`${base}/rest/v1/rpc/booking_handoff_resolve`, {
    method: "POST",
    headers: restHeaders(serviceKey),
    body: JSON.stringify({
      p_token_sha256: await sha256Hex(bearer),
      p_scheduler_key: expected,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null) as
    | Record<string, unknown>
    | null;
  const scheduler = profileOf(data?.scheduler, config);
  const payload = data?.payload;
  const submissionId = typeof data?.submission_id === "string"
    ? data.submission_id
    : "";
  if (
    !scheduler || !submissionId || !payload || typeof payload !== "object" ||
    Array.isArray(payload)
  ) return null;
  return {
    submissionId,
    scheduler,
    payload: payload as Record<string, unknown>,
  };
}

export async function startBookingLifecycle(
  bookingKey: string,
  config: SchedulerConfig,
): Promise<boolean> {
  const base = (config.supabaseUrl ?? "").replace(/\/+$/, "");
  const serviceKey = config.serviceKey ?? "";
  if (!base || !serviceKey || !bookingKey) return false;
  try {
    const res = await fetch(`${base}/rest/v1/rpc/booking_lifecycle_start`, {
      method: "POST",
      headers: restHeaders(serviceKey),
      body: JSON.stringify({ p_booking_key: bookingKey }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function markBookingHandoffUsed(
  token: unknown,
  config: SchedulerConfig,
): Promise<boolean> {
  const bearer = typeof token === "string" ? token.trim() : "";
  const base = (config.supabaseUrl ?? "").replace(/\/+$/, "");
  const serviceKey = config.serviceKey ?? "";
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(bearer) || !base || !serviceKey) {
    return false;
  }
  try {
    const res = await fetch(`${base}/rest/v1/rpc/booking_handoff_mark_used`, {
      method: "POST",
      headers: restHeaders(serviceKey),
      body: JSON.stringify({ p_token_sha256: await sha256Hex(bearer) }),
    });
    return res.ok && await res.json().catch(() => false) === true;
  } catch {
    return false;
  }
}
