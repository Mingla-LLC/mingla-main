// ORCH-1270 [SMS quiet-hours DEFER + idempotency] — implementor Deno tests.
//
// Run locally:
//   deno test --allow-read supabase/functions/marketing-send/orch-1270-defer.test.ts
//
// Angle: BEHAVIOR + SOURCE-CONTRACT. Two proofs:
//   RC-1 disposition matrix — an out-of-window recipient with a RESOLVABLE tz
//     DEFERS (never terminal-fails); an unresolvable tz FAILS immediately; the
//     defer is bounded (24 h / 30 attempts) so it can't loop forever.
//   RC-3 idempotency — across two cron passes over a mixed-tz audience, each
//     recipient is dispatched to the (mock) provider AT MOST ONCE and ends with
//     exactly one terminal row; a recipient who already has a terminal 'sent'
//     row is SKIPPED entirely.
//
// This file re-implements the shipped decision + terminal-skip logic (the
// sibling quiet-hours-tz.test.ts does the same) because importing index.ts boots
// its top-level serve() HTTP listener, which trips Deno's test resource
// sanitizer. The fails-on-revert teeth are the SOURCE-CONTRACT block at the
// bottom: it reads the deployed index.ts and asserts the exported
// decideSmsDisposition helper, the `status: "deferred"` write, the terminal-skip
// guard, the `.upsert(... onConflict: "campaign_id,recipient_phone")`, and the
// mkt_finalize_campaign RPC are all present — so a TRUE line-deletion of the fix
// fails this test.

import { assert, assertEquals } from "jsr:@std/assert@1";

const SRC_PATH = "supabase/functions/marketing-send/index.ts";
const SRC = await Deno.readTextFile(SRC_PATH);

// ─── Re-implementation of the deployed disposition logic (SPEC §5.1) ──────────
const QUIET_HOURS = {
  US: { startHour: 8, endHour: 21 },
  NG: { startHour: 8, endHour: 20 },
} as const;
const MAX_DEFER_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_DEFER_ATTEMPTS = 30;
const MIN_DEFER_INTERVAL_MS = 5 * 60 * 1000;
const SMS_TERMINAL_STATUSES = [
  "sent", "delivered", "opened", "clicked",
  "failed", "bounced", "unsubscribed", "preview_skipped",
];

const US_AREACODE_TZ: Record<string, string> = {
  "212": "America/New_York",
  "415": "America/Los_Angeles",
  "312": "America/Chicago",
};

function resolveRecipientTz(phone: string, cc: string | null): string | null {
  const C = (cc ?? "").toUpperCase();
  if (C === "NG") return "Africa/Lagos";
  if (C === "US") {
    const digits = phone.replace(/[^0-9]/g, "");
    const national = digits.startsWith("1") ? digits.slice(1) : digits;
    return US_AREACODE_TZ[national.slice(0, 3)] ?? null;
  }
  return null;
}
function isWithinQuietHours(phone: string, cc: string | null, now: Date): boolean {
  const C = (cc ?? "").toUpperCase();
  if (C !== "US" && C !== "NG") return false;
  const tz = resolveRecipientTz(phone, cc);
  if (tz === null) return false;
  const market: "US" | "NG" = C === "NG" ? "NG" : "US";
  const { startHour, endHour } = QUIET_HOURS[market];
  let h: number;
  try {
    h = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(now), 10);
    if (Number.isNaN(h)) return false;
  } catch {
    return false;
  }
  return h >= startHour && h < endHour;
}
function countryFromE164(phone: string): string | null {
  const t = phone.trim();
  if (t.startsWith("+234")) return "NG";
  if (t.startsWith("+1")) return "US";
  return null;
}

type SmsDisposition =
  | { action: "send" }
  | { action: "defer"; next_attempt_at: string; attempt_count: number }
  | { action: "fail"; reason: "unknown_timezone" | "quiet_hours_unreachable" };

function decideSmsDisposition(
  phone: string,
  cc: string | null,
  now: Date,
  existing: { status?: string | null; attempt_count?: number | null; created_at?: string | null } | null,
): SmsDisposition {
  const tz = resolveRecipientTz(phone, cc);
  if (tz === null) return { action: "fail", reason: "unknown_timezone" };
  if (isWithinQuietHours(phone, cc, now)) return { action: "send" };
  const attempt = (existing?.attempt_count ?? 0) + 1;
  const ageMs = existing?.created_at ? now.getTime() - new Date(existing.created_at).getTime() : 0;
  if (ageMs > MAX_DEFER_AGE_MS || attempt > MAX_DEFER_ATTEMPTS) {
    return { action: "fail", reason: "quiet_hours_unreachable" };
  }
  const C = (cc ?? "").toUpperCase();
  const market: "US" | "NG" = C === "NG" ? "NG" : "US";
  const { startHour } = QUIET_HOURS[market];
  let localHour: number = startHour;
  try {
    const p = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(now), 10);
    if (!Number.isNaN(p)) localHour = p;
  } catch { /* keep startHour */ }
  const hoursUntilOpen = (startHour - localHour + 24) % 24;
  const deltaMs = Math.max(hoursUntilOpen * 60 * 60 * 1000, MIN_DEFER_INTERVAL_MS);
  return { action: "defer", next_attempt_at: new Date(now.getTime() + deltaMs).toISOString(), attempt_count: attempt };
}

// ─── RC-1: disposition matrix ─────────────────────────────────────────────────

// 12:00 UTC in July: 08:00 America/New_York (in window) == 05:00 Los_Angeles (out).
const NOW = new Date("2026-07-15T12:00:00Z");

Deno.test("in-window recipient → send", () => {
  assertEquals(decideSmsDisposition("+12125550000", "US", NOW, null).action, "send");
});

Deno.test("out-of-window resolvable tz (415 @ 05:00 PT) → DEFER (not fail), next_attempt_at in the future, attempt_count=1", () => {
  const d = decideSmsDisposition("+14155550000", "US", NOW, null);
  assertEquals(d.action, "defer");
  if (d.action !== "defer") throw new Error("unreachable");
  assert(new Date(d.next_attempt_at).getTime() > NOW.getTime(), "next_attempt_at must be after now");
  assertEquals(d.attempt_count, 1, "fresh recipient starts at attempt 1");
  // 05:00 PT → 8:00 PT is ~3 h out.
  const deltaMs = new Date(d.next_attempt_at).getTime() - NOW.getTime();
  assert(deltaMs >= MIN_DEFER_INTERVAL_MS && deltaMs <= MAX_DEFER_AGE_MS, "defer delta is bounded");
});

Deno.test("defer increments attempt_count off the existing deferred row", () => {
  const existing = { status: "deferred", attempt_count: 2, created_at: NOW.toISOString() };
  const d = decideSmsDisposition("+14155550000", "US", NOW, existing);
  assertEquals(d.action, "defer");
  if (d.action !== "defer") throw new Error("unreachable");
  assertEquals(d.attempt_count, 3);
});

Deno.test("unknown timezone (unrecognized area code) → FAIL(unknown_timezone), never defer", () => {
  const d = decideSmsDisposition("+15005550000", "US", NOW, null); // 500 not a real NANP area code
  assertEquals(d.action, "fail");
  if (d.action !== "fail") throw new Error("unreachable");
  assertEquals(d.reason, "unknown_timezone");
});

Deno.test("unknown market (null country) → FAIL(unknown_timezone)", () => {
  const d = decideSmsDisposition("+448000000000", null, NOW, null);
  assertEquals(d.action, "fail");
});

Deno.test("aged past 24 h → FAIL(quiet_hours_unreachable) instead of looping", () => {
  const existing = {
    status: "deferred",
    attempt_count: 3,
    created_at: new Date(NOW.getTime() - (25 * 60 * 60 * 1000)).toISOString(),
  };
  const d = decideSmsDisposition("+14155550000", "US", NOW, existing); // still out of window
  assertEquals(d.action, "fail");
  if (d.action !== "fail") throw new Error("unreachable");
  assertEquals(d.reason, "quiet_hours_unreachable");
});

Deno.test("attempt_count past 30 → FAIL(quiet_hours_unreachable)", () => {
  const existing = { status: "deferred", attempt_count: 30, created_at: NOW.toISOString() };
  const d = decideSmsDisposition("+14155550000", "US", NOW, existing); // attempt would be 31
  assertEquals(d.action, "fail");
  if (d.action !== "fail") throw new Error("unreachable");
  assertEquals(d.reason, "quiet_hours_unreachable");
});

// ─── RC-3: two-pass idempotency (mock adapter, in-memory upsert store) ─────────

interface Row { status: string; created_at: string; attempt_count?: number; next_attempt_at?: string | null; }

Deno.test("cron re-invocation never double-dispatches: defer→send across two passes, one call + one row per recipient", () => {
  const campaign = "camp-1";
  const store = new Map<string, Row>(); // key = campaign|phone (the uq_mkt_msg_campaign_phone identity)
  const adapterCalls = new Map<string, number>();

  // Pre-seed a recipient that already SENT on a prior run — must be skipped.
  store.set(`${campaign}|+13125550000`, { status: "sent", created_at: NOW.toISOString() });

  const audience = ["+12125550000", "+14155550000", "+2348000000000", "+13125550000"];

  function runPass(now: Date) {
    for (const phone of audience) {
      const key = `${campaign}|${phone}`;
      const existing = store.get(key) ?? null;
      // In-loop terminal-skip guard (SPEC §5.1 rule 1).
      if (existing !== null && SMS_TERMINAL_STATUSES.includes(existing.status)) continue;
      const cc = countryFromE164(phone);
      const d = decideSmsDisposition(phone, cc, now, existing);
      const created_at = existing?.created_at ?? now.toISOString();
      if (d.action === "fail") {
        store.set(key, { status: "failed", created_at });
      } else if (d.action === "defer") {
        store.set(key, { status: "deferred", created_at, attempt_count: d.attempt_count, next_attempt_at: d.next_attempt_at });
      } else {
        adapterCalls.set(phone, (adapterCalls.get(phone) ?? 0) + 1); // mock provider send
        store.set(key, { status: "sent", created_at });
      }
    }
  }

  // Pass 1 — dead of night for 212/415/234 (04:39 UTC): all three defer, adapter untouched.
  const PASS1 = new Date("2026-06-29T04:39:00Z");
  runPass(PASS1);
  assertEquals(store.get(`${campaign}|+12125550000`)?.status, "deferred");
  assertEquals(store.get(`${campaign}|+14155550000`)?.status, "deferred");
  assertEquals(store.get(`${campaign}|+2348000000000`)?.status, "deferred");
  assertEquals(adapterCalls.size, 0, "no provider calls while everyone is out of window");
  // The pre-seeded sent recipient was skipped (not re-processed).
  assertEquals(store.get(`${campaign}|+13125550000`)?.status, "sent");

  // Pass 2 — 16:00 UTC (ET 12:00 / PT 09:00 / WAT 17:00): all three in window → send once.
  const PASS2 = new Date("2026-06-29T16:00:00Z");
  runPass(PASS2);
  assertEquals(store.get(`${campaign}|+12125550000`)?.status, "sent");
  assertEquals(store.get(`${campaign}|+14155550000`)?.status, "sent");
  assertEquals(store.get(`${campaign}|+2348000000000`)?.status, "sent");
  assertEquals(adapterCalls.get("+12125550000"), 1);
  assertEquals(adapterCalls.get("+14155550000"), 1);
  assertEquals(adapterCalls.get("+2348000000000"), 1);
  // The already-sent recipient was NEVER dispatched by this run.
  assertEquals(adapterCalls.has("+13125550000"), false);

  // Pass 3 — a redundant re-pick after everyone is terminal: ZERO new calls.
  runPass(PASS2);
  assertEquals(adapterCalls.get("+12125550000"), 1, "terminal-skip prevents a second dispatch");
  assertEquals(adapterCalls.get("+14155550000"), 1);
  assertEquals(adapterCalls.get("+2348000000000"), 1);

  // Exactly one row per distinct recipient (the uq_mkt_msg_campaign_phone identity).
  assertEquals(store.size, 4);
});

// ─── fails-on-revert: SOURCE-CONTRACT on the deployed index.ts ────────────────
function srcHas(needle: string, why: string) {
  assert(SRC.includes(needle), `marketing-send/index.ts must contain \`${needle}\` (${why})`);
}

Deno.test("source carries the RC-1 defer + idempotency machinery (anti-revert)", () => {
  srcHas("export function decideSmsDisposition", "the pure, exported disposition helper must exist (SPEC §5.1)");
  srcHas('status: "deferred"', "out-of-window recipients must be written status='deferred', not terminal failed");
  srcHas("quiet_hours_unreachable", "the bounded-termination fail reason must exist");
  srcHas("unknown_timezone", "the unresolvable-tz fail reason must exist");
  srcHas("MAX_DEFER_AGE_MS", "the 24 h age bound must exist");
  srcHas("MAX_DEFER_ATTEMPTS", "the 30-attempt bound must exist");
  // The in-loop terminal-skip idempotency guard.
  srcHas("SMS_TERMINAL_STATUSES", "the terminal-status skip list must exist");
  srcHas('onConflict: "campaign_id,recipient_phone"', "SMS writes must upsert on the (campaign,phone) unique index (double-send guard)");
  // RC-2 finalizer replaced the inline unconditional campaign 'sent' UPDATE.
  srcHas("mkt_finalize_campaign", "the honest-status finalizer RPC must be called");
});

Deno.test("the OLD terminal-fail-on-quiet-hours pattern is GONE (anti-revert)", () => {
  // The pre-ORCH-1270 defect wrote an INSERT with status:'failed' +
  // failure_reason:'quiet_hours_deferred'. Deferred rows now use status
  // 'deferred'; the only 'quiet_hours_deferred' left is an informational
  // failure_reason on the DEFERRED write. Assert no insert pairs a 'failed'
  // status directly with the quiet-hours label.
  const strippedFailedInsert = /status:\s*["']failed["'][^}]*failure_reason:\s*["']quiet_hours_deferred["']/;
  assert(
    !strippedFailedInsert.test(SRC),
    "quiet-hours recipients must DEFER, not be written status:'failed' with failure_reason:'quiet_hours_deferred'",
  );
});
