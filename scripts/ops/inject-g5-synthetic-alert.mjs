#!/usr/bin/env node
/**
 * #426 G5 — inject a tagged synthetic error into Sentry for incident drill.
 *
 * Usage:
 *   export SENTRY_DSN="https://<key>@..."
 *   node scripts/ops/inject-g5-synthetic-alert.mjs
 *
 * Optional:
 *   G5_DRILL_SEVERITY=P0|P1  (default P1)
 *   SENTRY_ENVIRONMENT=staging|edge|production
 */

const dsn = process.env.SENTRY_DSN ?? process.env.SUPABASE_SENTRY_DSN;
if (!dsn) {
  console.error("Set SENTRY_DSN (or SUPABASE_SENTRY_DSN)");
  process.exit(2);
}

const severity = process.env.G5_DRILL_SEVERITY ?? "P1";
const environment = process.env.SENTRY_ENVIRONMENT ?? "staging";

function parseDsn(raw) {
  try {
    const url = new URL(raw);
    const projectId = url.pathname.replace(/^\//, "");
    const publicKey = url.username;
    if (!publicKey || !projectId) return null;
    return { publicKey, host: url.host, projectId };
  } catch {
    return null;
  }
}

const parsed = parseDsn(dsn);
if (!parsed) {
  console.error("Invalid SENTRY_DSN");
  process.exit(2);
}

const eventId = crypto.randomUUID().replace(/-/g, "");
const message =
  `[G5 drill] Synthetic ${severity} incident — safe to ignore (${new Date().toISOString()})`;

const event = {
  event_id: eventId,
  timestamp: new Date().toISOString(),
  platform: "javascript",
  level: "error",
  environment,
  tags: {
    runtime: "g5-drill",
    drill: "g5",
    "drill:g5": "true",
    severity,
  },
  extra: {
    gate: "G5",
    purpose: "synthetic-incident-drill",
  },
  exception: {
    values: [{
      type: "G5SyntheticIncident",
      value: message,
      stacktrace: {
        frames: [{ filename: "scripts/ops/inject-g5-synthetic-alert.mjs", function: "main" }],
      },
    }],
  },
};

const sentryAuth =
  `Sentry sentry_version=7, sentry_client=mingla-g5-drill/1.0, sentry_key=${parsed.publicKey}`;

const res = await fetch(`https://${parsed.host}/api/${parsed.projectId}/store/`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Sentry-Auth": sentryAuth,
  },
  body: JSON.stringify(event),
});

if (!res.ok) {
  const body = await res.text();
  console.error(`Sentry store failed: ${res.status} ${body}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  eventId,
  severity,
  environment,
  injectedUtc: new Date().toISOString(),
  message,
}));
