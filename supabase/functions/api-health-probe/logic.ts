// ORCH-1201 — Pure logic for the API-health probe, extracted so it is unit
// testable without Deno.serve / network / env. The handler (index.ts) composes
// these with the live probes + Supabase writes.

export type HealthStatus = "healthy" | "degraded" | "down" | "unknown";

// ORCH-1201 — Safe numeric coercion for EXTERNALLY-SOURCED values. Vendor APIs
// (Twilio Balance.json returns balance as a STRING "14.53455") and HTTP headers
// (x-ratelimit-remaining, rate-limit-available) are ALWAYS strings. A bare
// `typeof x === "number"` guard silently drops these → false-healthy. Accept a
// number OR a numeric-string; return a FINITE number or null. Guards NaN, empty
// string, whitespace-only, booleans, and non-numeric junk (no crash).
export function toNum(x: unknown): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x === "string") {
    const t = x.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export interface ProbeResult {
  ok: boolean;
  latencyMs: number | null;
  httpStatus?: number;
  status: HealthStatus;
  detail: Record<string, unknown>;
}

// ORCH-1201-R2 — Layer-A statuspage feeds (Atlassian /api/v2/status.json).
// CORRECTED to CONFIRMED feeds only (verified by curl 2026-06-22):
//   • DROPPED paystack (status.paystack.com → 404, not Atlassian — Class C, no feed),
//   • DROPPED posthog (status.posthog.com 301→posthogstatus.com HTML, not status.json),
//   • DROPPED giphy (has a feed but is Class F / synthetic per the class contract),
//   • DROPPED stripe (status.stripe.com/api/v2/status.json → 404, not Atlassian;
//       Stripe health comes from its Class-C reachability/auth/webhook probe, not a feed).
// The AUTHORITATIVE source at runtime is api_health_services.depletion_signal.status_feed
// loaded from the DB; this map is a typed FALLBACK mirror used only when the DB
// value is absent. The DB value WINS (feeds editable without a redeploy).
export const STATUS_PAGE_URLS: Record<string, string> = {
  openai: "https://status.openai.com/api/v2/status.json",
  twilio: "https://status.twilio.com/api/v2/status.json",
  mapbox: "https://status.mapbox.com/api/v2/status.json",
  sentry: "https://status.sentry.io/api/v2/status.json",
  supabase: "https://status.supabase.com/api/v2/status.json",
  vercel: "https://www.vercel-status.com/api/v2/status.json",
  revenuecat: "https://status.revenuecat.com/api/v2/status.json",
  mixpanel: "https://www.mixpanelstatus.com/api/v2/status.json",
  appsflyer: "https://status.appsflyer.com/api/v2/status.json",
  resend: "https://resend-status.com/api/v2/status.json", // verified Atlassian schema 2026-06-22
  onesignal_consumer: "https://status.onesignal.com/api/v2/status.json",
  onesignal_business: "https://status.onesignal.com/api/v2/status.json",
  // google_places handled separately (incidents.json, not Atlassian status.json)
};

// ORCH-1201-R2 — Class-B depletion matcher contract (SPEC §5.3). The SINGLE
// source for the reactive disambiguation. Mirrors api_health_services.depletion_signal
// for the unit tests + the matcher below. `http` is the status (int or array) the
// depletion arrives on; `field` selects which observation column carries the match
// token: 'type' → error_code; 'body'/'status_text' → error_text. `match` is a
// case-insensitive substring. THE LOAD-BEARING RULE: openai 'insufficient_quota'
// is depletion; 'rate_limit_exceeded' (also 429) is NOT.
export interface ClassBReactive {
  http: number | number[];
  field: "type" | "body" | "status_text";
  match: string;
}
export interface ClassBHeader {
  name: string;
  warn: number;
}
export const CLASS_B_DEPLETION: Record<
  string,
  { reactive?: ClassBReactive; header?: ClassBHeader }
> = {
  openai: { reactive: { http: 429, field: "type", match: "insufficient_quota" } },
  gemini: { reactive: { http: 429, field: "type", match: "RESOURCE_EXHAUSTED" } },
  serper: { reactive: { http: [400, 401, 402, 403, 429], field: "body", match: "Not enough credits" } },
  resend: { reactive: { http: 429, field: "type", match: "quota_exceeded" } },
  mapbox: { reactive: { http: 429, field: "status_text", match: "429" } },
  google_places: { reactive: { http: [429], field: "status_text", match: "RESOURCE_EXHAUSTED" } },
  pexels: { header: { name: "x-ratelimit-remaining", warn: 2500 } },
  ticketmaster: { header: { name: "rate-limit-available", warn: 500 } },
};

// ── Class-B reactive depletion matcher (pure) ──
// Scans real-traffic observations (api_health_observations) for the documented
// depletion fingerprint. Returns depleted=true on the FIRST matching row (quota
// exhaustion does not recover within a tick — one insufficient_quota is enough).
// A transient rate_limit_exceeded (429 but NOT matching the token) does NOT count.
export interface DepletionObs {
  http_status: number | null;
  error_code: string | null;
  error_text: string | null;
  observed_at: string;
}
export interface DepletionResult {
  depleted: boolean;
  lastErrorCode: string | null;
  lastErrorText: string | null;
}
export function matchClassBDepletion(
  signal: { reactive?: ClassBReactive; header?: ClassBHeader } | null | undefined,
  rows: DepletionObs[],
  cachedRemaining?: number | string | null,
): DepletionResult {
  const none: DepletionResult = { depleted: false, lastErrorCode: null, lastErrorText: null };
  if (!signal) return none;

  // header signal: depleted when the freshest cached remaining <= warn.
  // ORCH-1201: HTTP rate-limit headers (x-ratelimit-remaining, rate-limit-available)
  // are ALWAYS strings on the wire — accept a numeric-string too so a low remaining
  // count is never silently dropped by a `typeof === "number"`-only guard.
  if (signal.header) {
    const rem = toNum(cachedRemaining);
    if (rem != null && rem <= signal.header.warn) {
      return { depleted: true, lastErrorCode: "header_remaining", lastErrorText: `${rem} <= ${signal.header.warn}` };
    }
    return none;
  }

  const r = signal.reactive;
  if (!r) return none;
  const httpSet = Array.isArray(r.http) ? new Set(r.http) : new Set([r.http]);
  const needle = r.match.toLowerCase();
  // newest-first scan so lastError* is the most recent match.
  const sorted = [...rows].sort((a, b) =>
    new Date(b.observed_at).getTime() - new Date(a.observed_at).getTime());
  for (const row of sorted) {
    if (row.http_status == null || !httpSet.has(row.http_status)) continue;
    const hay = (r.field === "type" ? row.error_code : row.error_text) ?? "";
    if (hay.toLowerCase().includes(needle)) {
      return { depleted: true, lastErrorCode: row.error_code, lastErrorText: row.error_text };
    }
  }
  return none;
}

// Atlassian Statuspage indicator → our status. Anything else / missing → unknown
// (constitutional rule 9: never fabricate green).
export function indicatorToStatus(indicator: string | null | undefined): HealthStatus {
  switch (indicator) {
    case "none":
      return "healthy";
    case "minor":
      return "degraded";
    case "major":
    case "critical":
      return "down";
    default:
      return "unknown";
  }
}

interface MinimalCheckRow {
  layer: "status_page" | "synthetic" | "passive" | "webhook";
  status: HealthStatus;
  detail: Record<string, unknown>;
  mode?: "test" | "live" | null;
}

// Worst-of-layers rollup for a service this tick. `unknown` never counts as a
// failure. `down` worst, then `degraded`, then `healthy`. A webhook layer with
// detail.alert_on_silence===true STILL counts as a failedTick — but ORCH-1213
// made ALL current payment/info webhook callers (stripe/paystack/cloudinary/twilio)
// pass alertOnSilence=false, so this branch is now dormant. It is kept as a
// generic guard for any FUTURE webhook service intentionally registered with
// alertOnSilence=true. No code change to the branch below (lines ~196-208).
export function computeEffectiveStatus(rows: MinimalCheckRow[]): {
  effectiveStatus: HealthStatus;
  failedTick: boolean;
  failingLayer: string | null;
  failingDetail: Record<string, unknown> | null;
  mode: string | null;
} {
  const rank: Record<HealthStatus, number> = { healthy: 1, degraded: 2, down: 3, unknown: 0 };
  let worst: HealthStatus = "unknown";
  let failingLayer: string | null = null;
  let failingDetail: Record<string, unknown> | null = null;
  let mode: string | null = null;

  for (const r of rows) {
    if (r.mode) mode = r.mode;
    if (r.status === "unknown") continue;
    if (rank[r.status] > rank[worst] || worst === "unknown") {
      worst = r.status;
      failingLayer = r.layer;
      failingDetail = r.detail;
    }
  }

  // failedTick: only `down` drives alerting, EXCEPT a webhook-silence `degraded`
  // row that opted in via detail.alert_on_silence===true. Post-ORCH-1213 no
  // current caller opts in (all pass alertOnSilence=false), so the else branch
  // is dormant — kept only as a generic guard for a future opt-in caller.
  let failedTick = false;
  if (worst === "down") {
    failedTick = true;
  } else {
    // webhook-silence degraded on a webhook layer counts as failed ONLY when the
    // row carries detail.alert_on_silence===true (no current caller — dormant guard).
    const silentWebhook = rows.find(
      (r) => r.layer === "webhook" && r.status === "degraded" && r.detail?.alert_on_silence === true,
    );
    if (silentWebhook) {
      // worst is guaranteed not "down" in this branch — attribute the failure
      // to the silent webhook so the alert email points at the right layer.
      failedTick = true;
      failingLayer = "webhook";
      failingDetail = silentWebhook.detail;
    }
  }

  return { effectiveStatus: worst, failedTick, failingLayer, failingDetail, mode };
}

// ── availability state-machine decision (pure) ──
export interface AvailabilityInput {
  currentState: "ok" | "alerting";
  consecutiveFailures: number;
  lastAlertAt: string | null;
  failedTick: boolean;
  nowMs: number;
  cooldownMs: number;
}
export interface AvailabilityDecision {
  nextState: "ok" | "alerting";
  nextConsecutiveFailures: number;
  setLastAlertAt: boolean;
  setLastRecoveryAt: boolean;
  sendDownAlert: boolean;
  sendRecoveryAlert: boolean;
}

export function decideAvailabilityTransitions(input: AvailabilityInput): AvailabilityDecision {
  const { currentState, failedTick, lastAlertAt, nowMs, cooldownMs } = input;
  const nextConsecutiveFailures = failedTick ? input.consecutiveFailures + 1 : 0;

  let nextState = currentState;
  let setLastAlertAt = false;
  let setLastRecoveryAt = false;
  let sendDownAlert = false;
  let sendRecoveryAlert = false;

  if (currentState === "ok") {
    // Entry to alerting after N=2 consecutive failed ticks.
    if (nextConsecutiveFailures >= 2) {
      nextState = "alerting";
      setLastAlertAt = true;
      sendDownAlert = true;
    }
  } else {
    // currently alerting
    if (failedTick) {
      // cooldown re-alert (6h)
      const elapsed = lastAlertAt ? nowMs - new Date(lastAlertAt).getTime() : Infinity;
      if (elapsed >= cooldownMs) {
        setLastAlertAt = true;
        sendDownAlert = true;
      }
    } else {
      // recovery
      nextState = "ok";
      setLastRecoveryAt = true;
      sendRecoveryAlert = true;
    }
  }

  return {
    nextState,
    nextConsecutiveFailures,
    setLastAlertAt,
    setLastRecoveryAt,
    sendDownAlert,
    sendRecoveryAlert,
  };
}

// ── low-balance state-machine decision (pure) ──
export interface BalanceInput {
  balanceLow: boolean | null; // null = no balance signal this tick
  lastBalanceState: "ok" | "low" | "unknown";
  lastBalanceAlertAt: string | null;
  nowMs: number;
  cooldownMs: number;
}
export interface BalanceDecision {
  nextBalanceState: "ok" | "low" | "unknown";
  setLastBalanceAlertAt: boolean;
  sendLowBalanceAlert: boolean;
}

export function decideBalanceTransition(input: BalanceInput): BalanceDecision {
  const { balanceLow, lastBalanceState, lastBalanceAlertAt, nowMs, cooldownMs } = input;
  if (balanceLow === null) {
    // no signal — preserve prior state, never alert
    return { nextBalanceState: lastBalanceState, setLastBalanceAlertAt: false, sendLowBalanceAlert: false };
  }
  if (balanceLow) {
    if (lastBalanceState !== "low") {
      // ok/unknown → low: one-shot alert
      return { nextBalanceState: "low", setLastBalanceAlertAt: true, sendLowBalanceAlert: true };
    }
    // already low: re-alert at most once per cooldown (24h)
    const elapsed = lastBalanceAlertAt ? nowMs - new Date(lastBalanceAlertAt).getTime() : Infinity;
    if (elapsed >= cooldownMs) {
      return { nextBalanceState: "low", setLastBalanceAlertAt: true, sendLowBalanceAlert: true };
    }
    return { nextBalanceState: "low", setLastBalanceAlertAt: false, sendLowBalanceAlert: false };
  }
  // recovered above threshold
  return { nextBalanceState: "ok", setLastBalanceAlertAt: false, sendLowBalanceAlert: false };
}

// ── ORCH-1201-R2: pure Class-A balance evaluation (testable, no Deno env) ──
// Processors ALWAYS return {balanceLow:null}. Otherwise driven by the balance
// `kind` + warn/crit. Direction encoded by kind, never guessed. `severity` is
// 'crit' when a crit threshold is breached (drives a red dot), else 'warn'.
export interface BalanceSignal {
  kind: string;
  warn: number | null;
  crit?: number | null;
  unit?: string;
}
export interface BalanceEval {
  balanceLow: boolean | null;
  balanceText: string | null;
  severity: "warn" | "crit" | null;
}
export function evaluateBalanceForSignal(
  serviceKey: string,
  detail: Record<string, unknown>,
  balance: BalanceSignal | null | undefined,
): BalanceEval {
  // Processors: NEVER a balance alert (incl. balance 0).
  if (serviceKey === "stripe" || serviceKey === "paystack") {
    return { balanceLow: null, balanceText: null, severity: null };
  }
  if (!balance || !balance.kind) return { balanceLow: null, balanceText: null, severity: null };
  const warn = typeof balance.warn === "number" ? balance.warn : null;
  const crit = typeof balance.crit === "number" ? balance.crit : null;

  switch (balance.kind) {
    case "twilio_balance": {
      // ORCH-1201: Twilio Balance.json returns `balance` as a STRING ("14.53455").
      // A `typeof === "number"`-only guard dropped it → false-healthy at $14.53.
      const v = toNum(detail.balance);
      if (v == null || warn == null) return { balanceLow: null, balanceText: null, severity: null };
      const low = v <= warn;
      const sev = low && crit != null && v <= crit ? "crit" : (low ? "warn" : null);
      return { balanceLow: low, balanceText: `$${v} ${detail.currency ?? "USD"} (warn ≤ $${warn})`, severity: sev };
    }
    case "bunny_usage_pct": {
      // META-ORCH-1270 (Phase 2) — Bunny storage/traffic usage %.
      // VECTOR-D ROOT-CAUSE FIX: a config-present-but-unreadable usage read
      // (probeBunny sets detail.probe_unreadable=true when the account API is
      // reachable-in-principle but returns non-numeric / errors) must FIRE a
      // DISTINCT warn — it may NOT fall through to {balanceLow:null} and silently
      // resolve to green (the exact way the Cloudinary alarm went blind). A
      // config-ABSENT probe carries neither used_percent nor probe_unreadable,
      // so it still returns {balanceLow:null} (grey, pre-cutover — no alert).
      if (detail.probe_unreadable === true) {
        return {
          balanceLow: true,
          balanceText: "usage read unavailable (probe_unreadable) — alarm is blind, investigate",
          severity: "warn",
        };
      }
      const used = toNum(detail.used_percent);
      if (used == null || warn == null) return { balanceLow: null, balanceText: null, severity: null };
      const isCrit = crit != null && used >= crit;
      const low = used >= warn;
      const sevTxt = isCrit ? `crit ≥ ${crit}%` : `warn ≥ ${warn}%`;
      return { balanceLow: low, balanceText: `${used.toFixed(2)}% used (${sevTxt})`, severity: isCrit ? "crit" : (low ? "warn" : null) };
    }
    case "exchangerate_quota": {
      const rem = toNum(detail.requests_remaining);
      if (rem == null || warn == null) return { balanceLow: null, balanceText: null, severity: null };
      const low = rem <= warn;
      const sev = low && crit != null && rem <= crit ? "crit" : (low ? "warn" : null);
      return { balanceLow: low, balanceText: `${rem} requests remaining (warn ≤ ${warn})`, severity: sev };
    }
    case "sentry_stats": {
      const ratio = toNum(detail.rate_limited_ratio);
      if (ratio == null || warn == null) return { balanceLow: null, balanceText: null, severity: null };
      const low = ratio >= warn;
      const sev = low && crit != null && ratio >= crit ? "crit" : (low ? "warn" : null);
      return { balanceLow: low, balanceText: `rate_limited/accepted ${ratio.toFixed(3)} (warn ≥ ${warn})`, severity: sev };
    }
    default:
      return { balanceLow: null, balanceText: null, severity: null };
  }
}

// Helper retained for the test surface: assemble a check row tuple shape.
export function buildCheckRows<T>(rows: T[]): T[] {
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════
// Issue #1537 — LAYER-C DELIVERY-LEDGER PROVIDER → TILE MAPPING.
// ═══════════════════════════════════════════════════════════════════════════
// EXTRACTED from index.ts, where it sat inline inside the request handler. That
// file calls `serve()` unguarded at module scope, so nothing in it could be
// imported by a test — the mapping was structurally untestable, which is why the
// bug below shipped unnoticed. It lives here now so it can be executed by a test.
//
// WHAT WAS BROKEN: the ladder had `onesignal` / `resend` / `twilio` arms and a
// bare `: []` fallback. #1537 made the delivery ledger record `termii` for
// Nigerian SMS instead of the previously hardcoded `twilio` — and `termii` fell
// straight through to `[]`, so the `for (const tile of tiles)` loop iterated
// ZERO times and every Nigerian row was discarded from the health tally.
//
// The regression that created: BEFORE #1537 those rows were mislabelled `twilio`
// and were still COUNTED (under the wrong tile). AFTER #1537 they are labelled
// honestly and counted NOWHERE. Nigerian SMS health went from wrong-but-visible
// to invisible, at exactly the moment Nigeria switches on.
//
// THE SHAPE OF THE BUG IS THE POINT. A silent `: []` default is the same
// unfalsifiable-default family as #1529's `?? "US"` and #1537's own hardcoded
// provider: a value nobody mapped disappears instead of raising. So this
// function does NOT return an empty array for an unrecognised provider — it
// returns `null`, a distinguishable "nobody mapped this" that the caller is
// obliged to handle, and `tallyDeliveryRows` collects those provider names so
// the handler can log them LOUDLY. A new provider must surface, never vanish.

/** A row as selected by the Layer-C read: `select("provider,status")`. */
export interface DeliveryLedgerRow {
  provider: string | null;
  status: string;
}

export interface DeliveryTallyEntry {
  /**
   * ATTEMPTS THAT REACHED A PROVIDER. #1537 P2-4: this deliberately EXCLUDES
   * `skipped` and `suppressed`, because neither performed any provider I/O —
   * a kill-switch skip returns before the HTTP call and a `can_send` denial
   * never gets that far. Counting a non-attempt here made a deliberately dark
   * market read as `healthy` (see DELIVERY_NON_ATTEMPT_STATUSES).
   */
  total: number;
  /** Of `total`: attempts the provider reported as failed/undelivered. */
  failure: number;
  /**
   * Rows that never reached a provider. Kept — NOT discarded — so a dark market
   * is reported as "nothing attempted", not as an absence of data. Discarding
   * them would recreate the invisibility P1-1 fixed, one layer up.
   */
  skipped: number;
}

export interface DeliveryTallyResult {
  /** tile service_key → counts. */
  tally: Map<string, DeliveryTallyEntry>;
  /**
   * Providers seen in the ledger that no arm maps, DISTINCT and sorted. Non-empty
   * means the ledger is carrying traffic this probe cannot see — the caller MUST
   * surface it. This is the loud replacement for the old silent `: []`.
   */
  unmappedProviders: string[];
  /** Rows whose provider was null/blank — already skipped before #1537. */
  nullProviderRows: number;
}

/**
 * The ONE provider → health-tile mapping.
 *
 * Every value here MUST exist as an `api_health_services.service_key`, because
 * `api_health_checks.service_key` is FK-constrained to that table and the probe
 * inserts its rows in ONE batch — an unregistered key would fail the entire
 * tick's insert, not just its own row. `termii` is registered by migration
 * 20270212001538.
 */
export const DELIVERY_PROVIDER_TILES: Record<string, readonly string[]> = {
  // No per-app split in deliveries → attribute to consumer (pre-existing limitation).
  onesignal: ["onesignal_consumer"],
  resend: ["resend"],
  twilio: ["twilio"],
  // #1537 — Nigerian SMS. Its OWN tile, deliberately not folded into `twilio`:
  // merging them would recreate exactly the mislabelling #1537 removed, and a
  // Termii outage would then read as a Twilio outage.
  termii: ["termii"],
};

/** Delivery statuses that count as a failure for the tile's failure rate. */
export const DELIVERY_FAIL_STATUSES: ReadonlySet<string> = new Set([
  "failed",
  "undelivered",
]);

// ═══════════════════════════════════════════════════════════════════════════
// #1537 P2-4 — A SKIP IS NOT EVIDENCE OF PROVIDER HEALTH IN EITHER DIRECTION.
// ═══════════════════════════════════════════════════════════════════════════
// These statuses mean NO PROVIDER I/O HAPPENED:
//   • `skipped`    — the per-market kill switch returned before the HTTP call
//                    (`provider_kill_switch_off`), or there was no usable
//                    contact for the channel (`no_contact`).
//   • `suppressed` — the `can_send` policy chokepoint denied the send.
//
// They used to increment a tile's `total` while never incrementing `failure`,
// so they were arithmetically indistinguishable from successful deliveries.
// Applying the handler's own thresholds (total<5 ⇒ unknown, failRate>0.5 ⇒
// down, ≥0.25 ⇒ degraded, else healthy), six kill-switch skips — which is
// EXACTLY what a dark Nigeria produces — made the termii tile report HEALTHY
// while not one message had been delivered.
//
// That is a POSITIVE FALSE CLAIM, and it is worse than the invisibility P1-1
// fixed: invisibility prompts the question "why is there no data?", whereas
// "healthy" stops anyone asking. It is also a Constitution rule 9 violation
// (no fabricated data, no lying states) and the same swallow-the-value shape as
// #1529's `?? "US"`, #1537's hardcoded provider, and the `: []` tile fallback.
//
// Excluding them needs NO new health state and NO threshold change: a tile with
// only skips lands on `total === 0`, which the handler's existing
// `total < 5 ⇒ "unknown"` branch already reports honestly. `unknown` is the
// truthful answer — nothing was attempted, so nothing is known.
export const DELIVERY_NON_ATTEMPT_STATUSES: ReadonlySet<string> = new Set([
  "skipped",
  "suppressed",
]);

/**
 * Tiles for a ledger provider, or `null` when NOTHING maps it.
 *
 * `null` rather than `[]` is deliberate and load-bearing: `[]` is silently
 * indistinguishable from "mapped to nothing on purpose", and iterating it drops
 * the row without a trace. `null` forces the caller to decide, which is what
 * makes the omission surfaceable.
 */
export function deliveryProviderTiles(
  provider: string,
): readonly string[] | null {
  return Object.hasOwn(DELIVERY_PROVIDER_TILES, provider)
    ? DELIVERY_PROVIDER_TILES[provider]
    : null;
}

/**
 * Fold Layer-C ledger rows into per-tile totals, reporting anything unmapped.
 *
 * Pure: no clock, no env, no I/O. The handler keeps ownership of the status
 * thresholds and the DB write.
 */
export function tallyDeliveryRows(
  rows: readonly DeliveryLedgerRow[],
): DeliveryTallyResult {
  const tally = new Map<string, DeliveryTallyEntry>();
  const unmapped = new Set<string>();
  let nullProviderRows = 0;

  for (const row of rows) {
    const provider = row.provider?.trim();
    if (!provider) {
      // Pre-#1537 behaviour, preserved: an inapp row carries no provider. This
      // is a legitimate absence, not an unmapped provider, so it is counted
      // separately and never reported as a gap.
      nullProviderRows += 1;
      continue;
    }
    const tiles = deliveryProviderTiles(provider);
    if (tiles === null) {
      unmapped.add(provider);
      continue;
    }
    for (const tile of tiles) {
      const entry = tally.get(tile) ?? { total: 0, failure: 0, skipped: 0 };
      // #1537 P2-4 — a non-attempt is recorded, but NOT as an attempt. The tile
      // is still created, so "6 requested, 0 attempted" stays reportable rather
      // than the market vanishing from the probe entirely.
      if (DELIVERY_NON_ATTEMPT_STATUSES.has(row.status)) {
        entry.skipped += 1;
      } else {
        entry.total += 1;
        if (DELIVERY_FAIL_STATUSES.has(row.status)) entry.failure += 1;
      }
      tally.set(tile, entry);
    }
  }

  return {
    tally,
    unmappedProviders: [...unmapped].sort(),
    nullProviderRows,
  };
}
