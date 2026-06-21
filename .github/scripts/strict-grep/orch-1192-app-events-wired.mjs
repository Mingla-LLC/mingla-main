#!/usr/bin/env node

/**
 * ORCH-1192 [app analytics instrumentation gaps] — app_opened + checkout_started
 * wired across BOTH native apps (follow-on to META-ORCH-1187 Phase 1).
 *
 * Auto-discovered strict-grep gate (runs in CI alongside the I-PROPOSED-1187
 * gates). Proves the TWO new PostHog events are wired at their real call sites
 * via the existing postHogService facade — NOT a new analytics infra — mirroring
 * the Phase-1 capture pattern. NATIVE-ONLY: zero web-analytics files touched.
 *
 *   EVENT 1 — `app_opened` { cold_start, surface }:
 *     consumer cold     → app-mobile/app/index.tsx (after initialize().then)
 *     consumer warm     → app-mobile/src/hooks/useForegroundRefresh.ts
 *                         (after the background→active resume guard)
 *     business cold     → mingla-business/app/_layout.tsx (after initialize().then)
 *     business warm     → mingla-business/app/_layout.tsx AppState handler,
 *                         guarded by prevAppStateRef so the first 'active'
 *                         (cold start) + iOS inactive→active do NOT double-fire.
 *
 *   EVENT 2 — `checkout_started` { event_id, offering_type, value?, currency }:
 *     consumer event    → app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx
 *                         (before the payment sheet opens, before purchase_completed)
 *     business event    → mingla-business/app/checkout/[eventId]/payment.tsx
 *     business trip     → mingla-business/app/checkout-trip/[tripEventId]/payment.tsx
 *     business exp      → mingla-business/app/checkout-experience/[experienceEventId]/payment.tsx
 *                         (top of handlePay, before the pay event + purchase_completed)
 *
 * FAILS-ON-REVERT: deleting any capture call site fails this gate (true line
 * deletion verified at implement time). ADD-ALONGSIDE: every existing
 * purchase_completed capture must remain present.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const errors = [];

function read(rel) {
  try {
    return fs.readFileSync(path.join(repoRoot, rel), "utf8");
  } catch {
    return null;
  }
}
function squish(src) {
  return src.replace(/\s+/g, " ");
}
function need(rel, raw, regex, label) {
  if (raw === null) {
    errors.push(`${rel}: MISSING — cannot verify ${label}.`);
    return;
  }
  if (!regex.test(squish(raw))) {
    errors.push(`${rel}: ${label} NOT found.`);
  }
}
function order(rel, raw, beforeNeedle, afterNeedle, label) {
  if (raw === null) return;
  const a = raw.indexOf(beforeNeedle);
  const b = raw.indexOf(afterNeedle);
  if (a >= 0 && b >= 0 && a > b) {
    errors.push(`${rel}: ${label}.`);
  }
}

// ── EVENT 1 — app_opened ───────────────────────────────────────────────────
// consumer cold
{
  const rel = "app-mobile/app/index.tsx";
  const raw = read(rel);
  need(
    rel,
    raw,
    /postHogService\.initialize\(\)\.then\(\s*\(\s*\)\s*=>\s*\{\s*postHogService\.capture\(\s*"app_opened",\s*\{\s*cold_start:\s*true,\s*surface:\s*"consumer_app",?\s*\}\s*\)/,
    'cold-start app_opened { cold_start:true, surface:"consumer_app" } chained off initialize().then',
  );
}
// consumer warm
{
  const rel = "app-mobile/src/hooks/useForegroundRefresh.ts";
  const raw = read(rel);
  need(
    rel,
    raw,
    /postHogService\.capture\(\s*"app_opened",\s*\{\s*cold_start:\s*false,\s*surface:\s*"consumer_app",?\s*\}\s*\)/,
    'foreground app_opened { cold_start:false, surface:"consumer_app" }',
  );
  need(
    rel,
    raw,
    /if\s*\(\s*!wasBackground\s*\|\|\s*!isNowActive\s*\)\s*return;/,
    "genuine-resume guard (wasBackground && isNowActive) present",
  );
  // Guard must come BEFORE the capture (guardIdx < captureIdx).
  order(
    rel,
    raw,
    "if (!wasBackground || !isNowActive) return;",
    'postHogService.capture("app_opened"',
    "foreground app_opened fires BEFORE the resume guard (double-fire risk)",
  );
}
// business cold + warm (same file)
{
  const rel = "mingla-business/app/_layout.tsx";
  const raw = read(rel);
  need(
    rel,
    raw,
    /postHogService\.initialize\(\)\.then\(\s*\(\s*\)\s*=>\s*\{\s*postHogService\.capture\(\s*"app_opened",\s*\{\s*cold_start:\s*true,\s*surface:\s*"business_app",?\s*\}\s*\)/,
    'cold-start app_opened { cold_start:true, surface:"business_app" } chained off initialize().then',
  );
  need(
    rel,
    raw,
    /postHogService\.capture\(\s*"app_opened",\s*\{\s*cold_start:\s*false,\s*surface:\s*"business_app",?\s*\}\s*\)/,
    'foreground app_opened { cold_start:false, surface:"business_app" }',
  );
  need(
    rel,
    raw,
    /const\s+wasBackground\s*=\s*prevAppStateRef\.current\s*===\s*"background";/,
    "prevAppStateRef background→active resume guard present",
  );
}

// ── EVENT 2 — checkout_started ─────────────────────────────────────────────
// consumer event
{
  const rel = "app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx";
  const raw = read(rel);
  need(
    rel,
    raw,
    /postHogService\.capture\(\s*"checkout_started",\s*\{\s*event_id:\s*seed\.eventId,\s*offering_type:\s*"event",\s*value:\s*payload\.totalCents\s*\/\s*100,\s*currency:\s*seed\.currency,\s*surface:\s*"consumer_app",?\s*\}\s*\)/,
    "checkout_started capture with event_id/offering_type/value/currency/surface",
  );
  order(
    rel,
    raw,
    'postHogService.capture("checkout_started"',
    "setCheckoutInFlight(true)",
    "checkout_started fires AFTER setCheckoutInFlight(true) — must precede the payment sheet",
  );
  order(
    rel,
    raw,
    'postHogService.capture("checkout_started"',
    'postHogService.capture("purchase_completed"',
    "checkout_started fires AFTER purchase_completed — ordering wrong",
  );
  need(
    rel,
    raw,
    /postHogService\.capture\(\s*"purchase_completed"/,
    "existing purchase_completed capture must remain (add-alongside)",
  );
}
// business event / trip / experience
const bizCheckout = [
  {
    rel: "mingla-business/app/checkout/[eventId]/payment.tsx",
    id: "eventId",
    offering: "event",
  },
  {
    rel: "mingla-business/app/checkout-trip/[tripEventId]/payment.tsx",
    id: "tripEventId",
    offering: "trip",
  },
  {
    rel: "mingla-business/app/checkout-experience/[experienceEventId]/payment.tsx",
    id: "experienceEventId",
    offering: "experience",
  },
];
for (const { rel, id, offering } of bizCheckout) {
  const raw = read(rel);
  const captureRe = new RegExp(
    `postHogService\\.capture\\(\\s*"checkout_started",\\s*\\{\\s*event_id:\\s*${id},\\s*offering_type:\\s*"${offering}",[\\s\\S]*?currency:\\s*totals\\.currency,\\s*surface:\\s*"business_app",?\\s*\\}\\s*\\)`,
  );
  need(rel, raw, captureRe, `checkout_started offering_type:${offering}`);
  // value is conditional on the server all-in preview being present.
  need(
    rel,
    raw,
    /allInPreviewCents\s*!==\s*null\s*\?\s*\{\s*value:\s*allInPreviewCents\s*\/\s*100\s*\}\s*:\s*\{\s*\}/,
    "conditional value off allInPreviewCents",
  );
  // Fires at the top of handlePay — before the first ticket_checkout_pay_started.
  order(
    rel,
    raw,
    'postHogService.capture("checkout_started"',
    'mixpanelService.track("ticket_checkout_pay_started"',
    "checkout_started fires AFTER ticket_checkout_pay_started — must be at the top of handlePay",
  );
}

if (errors.length > 0) {
  console.error("FAIL: ORCH-1192-APP-EVENTS-WIRED");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  "OK: ORCH-1192-APP-EVENTS-WIRED — app_opened (cold+warm) + checkout_started wired across both native apps",
);
