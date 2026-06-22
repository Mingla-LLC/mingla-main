// ORCH-1199 — Pure logic for the API-health probe, extracted so it is unit
// testable without Deno.serve / network / env. The handler (index.ts) composes
// these with the live probes + Supabase writes.

export type HealthStatus = "healthy" | "degraded" | "down" | "unknown";

export interface ProbeResult {
  ok: boolean;
  latencyMs: number | null;
  httpStatus?: number;
  status: HealthStatus;
  detail: Record<string, unknown>;
}

// Layer-A statuspage feeds (Atlassian /api/v2/status.json). Confirmed in SPEC §2.1.
export const STATUS_PAGE_URLS: Record<string, string> = {
  stripe: "https://status.stripe.com/api/v2/status.json",
  paystack: "https://status.paystack.com/api/v2/status.json",
  openai: "https://status.openai.com/api/v2/status.json",
  mapbox: "https://status.mapbox.com/api/v2/status.json",
  onesignal_consumer: "https://status.onesignal.com/api/v2/status.json",
  onesignal_business: "https://status.onesignal.com/api/v2/status.json",
  resend: "https://resend-status.com/api/v2/status.json",
  twilio: "https://status.twilio.com/api/v2/status.json",
  cloudinary: "https://status.cloudinary.com/api/v2/status.json",
  supabase: "https://status.supabase.com/api/v2/status.json",
  vercel: "https://www.vercel-status.com/api/v2/status.json",
  sentry: "https://status.sentry.io/api/v2/status.json",
  posthog: "https://status.posthog.com/api/v2/status.json",
  giphy: "https://status.giphy.com/api/v2/status.json",
};

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
// failure. `down` worst, then `degraded`, then `healthy`. Webhook-silence
// `degraded` for stripe/paystack DOES count as a failedTick (matches the
// existing 6h-silence alert behavior).
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

  // failedTick: only `down` drives alerting, EXCEPT webhook-silence degraded.
  let failedTick = false;
  if (worst === "down") {
    failedTick = true;
  } else {
    // webhook-silence degraded on a webhook layer counts as failed.
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

// Helper retained for the test surface: assemble a check row tuple shape.
export function buildCheckRows<T>(rows: T[]): T[] {
  return rows;
}
