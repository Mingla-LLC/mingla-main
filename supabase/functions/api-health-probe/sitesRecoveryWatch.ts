// Issue #4574 — Sites recovery watch (every 15 minutes, body {"mode":"sites_recovery"}).
//
// A NEW site's first publish needs recent recovery evidence. The gate
// (public.brand_site_authorize_operation) reads its budgets from SQL helpers,
// and public.brand_site_recovery_watch_snapshot() turns the same helpers into
// `closes_at`: the moment first publishes stop being allowed. This module
// never holds a budget of its own; it only measures hours left against that
// closing time and decides which email, if any, goes to the api_health
// recipients:
//
//   warn      at most 2 h left        "first publishes stop at HH:MM UTC"
//   critical  at most 0.5 h left      the same, urgent
//   expired   no time left            "first publishes are being refused now"
//   recovered more than 6 h left again, only after one of the above was sent
//   heartbeat no backup has completed in 18 h (once per last completion)
//   unproven  the snapshot could not be read (at most one email per 2 h;
//             never reported as ok)
//
// Dedup: an incident is one `closes_at` value. Each level emails once per
// incident; an escalation (warn -> critical -> expired) always emails.
// Between 2 h and 6 h left ("watch") nothing is sent and nothing is reset.
//
// Pure: the probe passes in the database calls and the sender, so the Deno
// test drives it with fakes. A dry run reads the snapshot and returns what it
// would send; it sends nothing and records nothing.

export const SITES_WARN_HEADROOM_H = 2;
export const SITES_CRITICAL_HEADROOM_H = 0.5;
export const SITES_RECOVERED_HEADROOM_H = 6;
export const SITES_HEARTBEAT_H = 18;
export const SITES_UNPROVEN_REPEAT_MS = 2 * 60 * 60 * 1000;
/** The pg_cron cadence (`4-59/15 * * * *`). The warn level must be wider. */
export const SITES_WATCH_CADENCE_H = 0.25;

const HOUR_MS = 60 * 60 * 1000;

export type SitesLevel = "ok" | "watch" | "warn" | "critical" | "expired" | "unproven";
export type SitesSentLevel = "warn" | "critical" | "expired" | "recovered";

export interface SitesWatchState {
  level: SitesLevel | null;
  incident_closes_at: string | null;
  last_sent_level: SitesSentLevel | null;
  last_sent_at: string | null;
  heartbeat_for: string | null;
  unproven_sent_at: string | null;
}

export interface SitesWatchSnapshot {
  gate_budget_h: number;
  manifest_budget_h: number;
  closes_at: string;
  database_backup_verified_at: string;
  object_manifest_verified_at: string;
  last_completion_at: string | null;
  state: SitesWatchState;
}

export interface SitesWatchRecord {
  level: SitesLevel;
  incident_closes_at: string | null;
  sent_level: SitesSentLevel | null;
  heartbeat_for: string | null;
  unproven_sent: boolean;
}

export interface SitesAlert {
  kind: SitesSentLevel | "heartbeat" | "unproven";
  subject: string;
  paragraphs: string[];
}

export interface SitesWatchDeps {
  snapshot(): Promise<{ data: unknown; error: string | null }>;
  record(entry: SitesWatchRecord): Promise<{ error: string | null }>;
  send(alert: SitesAlert): Promise<{ succeeded: number }>;
  nowMs(): number;
}

export interface SitesWatchOutcome {
  level: SitesLevel;
  headroom_h: number | null;
  closes_at: string | null;
  gate_budget_h: number | null;
  would_send: SitesAlert["kind"][];
  sent: SitesAlert["kind"][];
  send_failed: SitesAlert["kind"][];
  record_error: string | null;
  dry_run: boolean;
  reason: string | null;
}

const RANK: Record<"warn" | "critical" | "expired", number> = { warn: 1, critical: 2, expired: 3 };

function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string" || v.length === 0) return null;
  return Number.isFinite(Date.parse(v)) ? v : null;
}

function finitePositive(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function readState(raw: unknown): SitesWatchState {
  const r = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const sent = r.last_sent_level;
  return {
    level: typeof r.level === "string" ? r.level as SitesLevel : null,
    incident_closes_at: isoOrNull(r.incident_closes_at),
    last_sent_level: sent === "warn" || sent === "critical" || sent === "expired" || sent === "recovered" ? sent : null,
    last_sent_at: isoOrNull(r.last_sent_at),
    heartbeat_for: isoOrNull(r.heartbeat_for),
    unproven_sent_at: isoOrNull(r.unproven_sent_at),
  };
}

/** Validate the RPC's jsonb. Anything missing makes the check unproven. */
export function readSitesSnapshot(raw: unknown): { snapshot: SitesWatchSnapshot | null; reason: string | null } {
  if (!raw || typeof raw !== "object") return { snapshot: null, reason: "the snapshot was empty" };
  const r = raw as Record<string, unknown>;
  if (r.config_present !== true) return { snapshot: null, reason: "the Sites service row is missing" };
  const gate = finitePositive(r.gate_budget_h);
  const manifest = finitePositive(r.manifest_budget_h);
  const closes = isoOrNull(r.closes_at);
  const database = isoOrNull(r.database_backup_verified_at);
  const objects = isoOrNull(r.object_manifest_verified_at);
  if (gate === null || manifest === null) return { snapshot: null, reason: "the gate budget could not be read" };
  if (closes === null || database === null || objects === null) {
    return { snapshot: null, reason: "no backup evidence is recorded" };
  }
  return {
    snapshot: {
      gate_budget_h: gate,
      manifest_budget_h: manifest,
      closes_at: closes,
      database_backup_verified_at: database,
      object_manifest_verified_at: objects,
      last_completion_at: isoOrNull(r.last_completion_at),
      state: readState(r.state),
    },
    reason: null,
  };
}

export function levelForHeadroom(headroomH: number): Exclude<SitesLevel, "unproven"> {
  if (headroomH <= 0) return "expired";
  if (headroomH <= SITES_CRITICAL_HEADROOM_H) return "critical";
  if (headroomH <= SITES_WARN_HEADROOM_H) return "warn";
  if (headroomH <= SITES_RECOVERED_HEADROOM_H) return "watch";
  return "ok";
}

function hhmm(iso: string): string {
  return new Date(iso).toISOString().slice(11, 16);
}

function formatH(h: number): string {
  return h >= 10 ? `${Math.round(h)} h` : `${h.toFixed(1)} h`;
}

export function sitesAlertCopy(
  kind: SitesAlert["kind"],
  snapshot: SitesWatchSnapshot | null,
  headroomH: number | null,
  detail: string | null,
  nowMs: number,
): SitesAlert {
  const budget = snapshot
    ? `A new website's first Go live needs a database backup less than ${snapshot.gate_budget_h} h old and a backup job that finished less than ${snapshot.manifest_budget_h} h ago.`
    : "A new website's first Go live needs recent backup evidence.";
  const fix = "Fix: run the "Sites backup and restore" GitHub workflow (mode backup) on main, then check that a new nightly_backup receipt was recorded. Sites already live are not affected.";
  switch (kind) {
    case "warn":
    case "critical": {
      const closes = snapshot ? hhmm(snapshot.closes_at) : "soon";
      return {
        kind,
        subject: kind === "critical"
          ? `[SITES] URGENT: new websites stop going live at ${closes} UTC`
          : `[SITES] New websites stop going live at ${closes} UTC unless a backup lands`,
        paragraphs: [
          `First Go lives stop at ${closes} UTC (${formatH(Math.max(headroomH ?? 0, 0))} left) unless a Sites backup lands first.`,
          budget,
          fix,
        ],
      };
    }
    case "expired":
      return {
        kind,
        subject: "[SITES] New websites are being refused now",
        paragraphs: [
          `First Go lives have been refused since ${snapshot ? hhmm(snapshot.closes_at) : "an unknown time"} UTC: the backup evidence is too old.`,
          budget,
          fix,
        ],
      };
    case "recovered":
      return {
        kind,
        subject: "[SITES] New websites can go live again",
        paragraphs: [
          `A Sites backup landed. First Go lives are allowed until ${snapshot ? `${snapshot.closes_at.slice(0, 16).replace("T", " ")} UTC` : "the next closing time"} (${formatH(Math.max(headroomH ?? 0, 0))} left).`,
        ],
      };
    case "heartbeat": {
      const last = snapshot?.last_completion_at;
      const age = last ? (nowMs - Date.parse(last)) / HOUR_MS : null;
      return {
        kind,
        subject: "[SITES] The Sites backup has stopped completing",
        paragraphs: [
          last && age !== null
            ? `No Sites backup has completed for ${formatH(age)} (last at ${last.slice(0, 16).replace("T", " ")} UTC). They normally complete at least every ${SITES_HEARTBEAT_H} h.`
            : "No Sites backup completion is recorded.",
          headroomH !== null ? `First Go lives are allowed for ${formatH(Math.max(headroomH, 0))} more.` : budget,
          fix,
        ],
      };
    }
    case "unproven":
      return {
        kind,
        subject: "[SITES] The Sites backup watch cannot read its evidence",
        paragraphs: [
          `The watch could not tell whether new websites can go live: ${detail ?? "unknown error"}.`,
          "Until this is fixed nobody is told before first Go lives stop.",
        ],
      };
  }
}

/** Which emails this check should send, from the stored state alone. */
export function decideSitesAlerts(
  level: SitesLevel,
  snapshot: SitesWatchSnapshot | null,
  nowMs: number,
  storedState: SitesWatchState | null,
): SitesAlert["kind"][] {
  const kinds: SitesAlert["kind"][] = [];
  if (level === "unproven") {
    const last = storedState?.unproven_sent_at ? Date.parse(storedState.unproven_sent_at) : NaN;
    if (!(Number.isFinite(last) && nowMs - last < SITES_UNPROVEN_REPEAT_MS)) kinds.push("unproven");
    return kinds;
  }
  if (!snapshot) return kinds;
  const state = snapshot.state;
  const sameIncident = state.incident_closes_at !== null &&
    Date.parse(state.incident_closes_at) === Date.parse(snapshot.closes_at);
  const lastAlert = state.last_sent_level !== null && state.last_sent_level !== "recovered"
    ? state.last_sent_level
    : null;
  if (level === "warn" || level === "critical" || level === "expired") {
    if (!(sameIncident && lastAlert !== null && RANK[lastAlert] >= RANK[level])) kinds.push(level);
  } else if (level === "ok" && lastAlert !== null) {
    kinds.push("recovered");
  }
  const last = snapshot.last_completion_at;
  if (last === null) {
    // No completion receipt at all: the heartbeat cannot be keyed; say so
    // through the alert levels above (the gate itself will close).
  } else if (nowMs - Date.parse(last) > SITES_HEARTBEAT_H * HOUR_MS &&
    (state.heartbeat_for === null || Date.parse(state.heartbeat_for) !== Date.parse(last))) {
    kinds.push("heartbeat");
  }
  return kinds;
}

export async function runSitesRecoveryWatch(
  deps: SitesWatchDeps,
  opts: { dryRun: boolean },
): Promise<SitesWatchOutcome> {
  const nowMs = deps.nowMs();
  const snap = await deps.snapshot();
  const parsed = snap.error
    ? { snapshot: null, reason: `the snapshot failed (${snap.error})` }
    : readSitesSnapshot(snap.data);
  const snapshot = parsed.snapshot;
  const headroomH = snapshot ? (Date.parse(snapshot.closes_at) - nowMs) / HOUR_MS : null;
  const level: SitesLevel = headroomH === null ? "unproven" : levelForHeadroom(headroomH);
  const storedState = snapshot
    ? snapshot.state
    : (snap.data && typeof snap.data === "object"
      ? readState((snap.data as Record<string, unknown>).state)
      : null);
  const kinds = decideSitesAlerts(level, snapshot, nowMs, storedState);

  const outcome: SitesWatchOutcome = {
    level,
    headroom_h: headroomH === null ? null : Math.round(headroomH * 100) / 100,
    closes_at: snapshot?.closes_at ?? null,
    gate_budget_h: snapshot?.gate_budget_h ?? null,
    would_send: kinds,
    sent: [],
    send_failed: [],
    record_error: null,
    dry_run: opts.dryRun,
    reason: parsed.reason,
  };
  if (opts.dryRun) return outcome;

  for (const kind of kinds) {
    const alert = sitesAlertCopy(kind, snapshot, headroomH, parsed.reason, nowMs);
    const result = await deps.send(alert);
    if (result.succeeded > 0) outcome.sent.push(kind);
    else outcome.send_failed.push(kind);
  }

  // Only a delivered email moves the dedup state, so an undelivered alert is
  // tried again on the next check (the safe side).
  const sentLevel = outcome.sent.find((k): k is SitesSentLevel =>
    k === "warn" || k === "critical" || k === "expired" || k === "recovered") ?? null;
  const recorded = await deps.record({
    level,
    incident_closes_at: sentLevel ? snapshot?.closes_at ?? null : null,
    sent_level: sentLevel,
    heartbeat_for: outcome.sent.includes("heartbeat") ? snapshot?.last_completion_at ?? null : null,
    unproven_sent: outcome.sent.includes("unproven"),
  });
  outcome.record_error = recorded.error;
  return outcome;
}
