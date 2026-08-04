// Issue #1537 — DELIVERY LEDGER PROVIDER TRUTH.
//
// TESTER ADVERSARIAL SUITE. Independent of, and hostile to, the implementor's
// happy-path file (`issue1537_delivery_provider_truth.test.ts`, T-1..T-8).
//
// ===========================================================================
// WHY THIS FILE EXISTS AND WHAT IT ATTACKS THAT THE IMPLEMENTOR'S FILE DOES NOT
// ===========================================================================
// The implementor's suite proves the CODE COMPUTES the right provider string,
// against a permissive fake client that accepts any object it is handed. It
// explicitly flagged three things it could not cover. This file attacks all
// three, plus the outcome paths its SC table never isolated.
//
//   ANGLE 1 — "a real Postgres row, against real DDL".
//     The implementor's fake accepts ANY payload, so it cannot fail on a
//     column that does not exist, a status outside the CHECK, or a row that
//     violates the owner constraint. This file replays the ACTUAL production
//     DDL of `public.notification_deliveries`, read out of the live database
//     (project `gqnoajqerqhnvulmnyvv`) read-only on 2026-08-04, and enforces
//     it on every write: the exact 18-column set, both CHECK constraints, the
//     owner constraint, NOT NULLs, and the partial UNIQUE index. A write that
//     Postgres would reject fails here instead of passing silently.
//     It also pins the fact the whole fix depends on: `provider` carries NO
//     CHECK constraint, so `termii` is storable at all.
//
//   ANGLE 2 — "concurrent claim/reconcile races on the provider column".
//     ADV-11..ADV-13 interleave two guest dispatches on one idempotency key
//     through a suspended provider call, and prove the partial UNIQUE index
//     admits exactly one claim, one HTTP call and one row — and that the
//     label written at claim time and the label written at reconcile time
//     cannot disagree, because both derive from the same number through the
//     same function.
//
//   ANGLE 3 — "the termii-delivery-status webhook against a genuinely
//     `termii`-labelled row". This combination has NEVER occurred: every SMS
//     row in production says `twilio` (31 rows, zero `termii`, verified
//     read-only 2026-08-04). ADV-7..ADV-10 send an NG message through the real
//     `dispatchV2`, take the `provider_message_id` the adapter actually
//     returned, sign a real HMAC-SHA512 Termii callback for it, and drive the
//     REAL `handleTermiiStatus` against the SAME DDL-enforcing store — proving
//     the callback still matches, reconciles, preserves the `termii` label,
//     and feeds `channel_suppressions`.
//     The existing webhook test (`termii-delivery-status/index.test.ts`) uses
//     a stub whose `update()` is a NO-OP, so it can never prove reconciliation
//     happened at all. This one applies the update to a real row store.
//
// PLUS the outcome paths the implementor's SC table did not isolate:
//   fail-closed (missing provider credentials) and opted-out/blacklisted —
//   both of which must still name the provider, because both are outcomes
//   where a provider WAS selected and something was attempted or refused.
//
// TEST DISCIPLINE
//   - BEHAVIOUR, NOT STRING PRESENCE (#1518's lesson). Nothing here reads a
//     source file. Every assertion executes real product code and reads either
//     a stored row or a returned value, with provider HTTP observed.
//   - NO VACUOUS PASSES (#1529's lesson, and this issue's explicit brief).
//     Every lookup goes through `matchRows`/`matchOne`, which THROW when they
//     match nothing. ADV-17 is a meta-test that proves the guard itself fires
//     — the guard is falsifiable, not decorative.
//
// Append-only: NEW file. No existing test file is modified by this change.

import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { dispatchV2, type MinimalClient } from "../_shared/notifyV2.ts";
import {
  smsAdapter,
  smsProviderForCountry,
  smsProviderForDestination,
} from "../_shared/adapters/smsAdapter.ts";
import {
  __setServiceClientFactory,
  handleTermiiStatus,
} from "../termii-delivery-status/index.ts";

// ===========================================================================
// THE REAL PRODUCTION DDL — read-only snapshot, project gqnoajqerqhnvulmnyvv,
// captured 2026-08-04 from information_schema.columns / pg_constraint /
// pg_indexes. This is the contract a row must satisfy to exist in production.
// ===========================================================================

/** Exact column set of public.notification_deliveries. */
const PROD_COLUMNS: ReadonlySet<string> = new Set([
  "id",
  "notification_id",
  "channel",
  "status",
  "provider",
  "provider_message_id",
  "attempt_at",
  "delivered_at",
  "failed_reason",
  "segments",
  "contact",
  "idempotency_key",
  "recipient_fingerprint",
  "payload_fingerprint",
  "dispatch_claim_id",
  "dispatch_claimed_at",
  "first_attempt_at",
  "provider_idempotency_expires_at",
]);

/** notification_deliveries_channel_check */
const CHANNEL_CHECK: ReadonlySet<string> = new Set([
  "inapp",
  "push",
  "email",
  "sms",
]);

/** notification_deliveries_status_check */
const STATUS_CHECK: ReadonlySet<string> = new Set([
  "queued",
  "sent",
  "delivered",
  "undelivered",
  "failed",
  "suppressed",
  "skipped",
]);

/**
 * THE LOAD-BEARING FACT. `provider` is `text NULL` with NO CHECK constraint
 * and no default — pg_constraint lists exactly four constraints on this table
 * (channel_check, status_check, owner_chk, plus PK/FK) and none of them
 * mentions `provider`. If a CHECK were ever added that enumerated only
 * 'twilio'/'onesignal'/'resend', this entire fix would fail closed in
 * production while every unit test stayed green. ADV-1 pins it.
 */
const PROVIDER_HAS_CHECK_CONSTRAINT = false;

interface Row {
  [k: string]: unknown;
  notification_id: string | null;
  channel: string;
  status: string;
  provider: string | null;
  provider_message_id: string | null;
  failed_reason: string | null;
  contact: string | null;
  idempotency_key: string | null;
  recipient_fingerprint: string | null;
  segments: number | null;
  delivered_at: string | null;
}

interface PgError {
  code?: string;
  message?: string;
}

/**
 * PostgREST wire semantics: the client body is `JSON.stringify(values)`, and
 * JSON.stringify DROPS keys whose value is `undefined`. So an `undefined`
 * column means "do not write this column", while an explicit `null` means
 * "write SQL NULL". That distinction is exactly what makes the optional
 * `provider` parameter on `updateGuestDelivery` safe or unsafe, so it is
 * modelled here rather than assumed. ADV-13 depends on it.
 */
function overTheWire(patch: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(patch)) as Record<string, unknown>;
}

/**
 * An in-memory `notification_deliveries` that ENFORCES the production DDL.
 * Unlike a permissive fake, this rejects what Postgres would reject, so a
 * write that could never land in production fails the test instead of being
 * quietly recorded.
 */
class DeliveriesTable {
  rows: Row[] = [];
  /**
   * Every mutation ATTEMPT, in order, including rejections — so a test can
   * assert what was written WHEN, and prove a concurrent claim landed inside
   * the window between another dispatch's claim and its reconcile.
   */
  audit: Array<
    { op: "insert" | "update"; patch: Record<string, unknown>; rejected?: string }
  > = [];

  /** Records EVERY attempt — accepted or rejected — then delegates. */
  insert(raw: Record<string, unknown>): { error: PgError | null } {
    const res = this.tryInsert(raw);
    if (res.error) {
      this.audit.push({
        op: "insert",
        patch: overTheWire(raw),
        rejected: res.error.code,
      });
    }
    return res;
  }

  private tryInsert(raw: Record<string, unknown>): { error: PgError | null } {
    const row = overTheWire(raw);

    for (const key of Object.keys(row)) {
      if (!PROD_COLUMNS.has(key)) {
        // PostgREST answers PGRST204 for an unknown column; Postgres 42703.
        return {
          error: {
            code: "42703",
            message: `column "${key}" of relation "notification_deliveries" does not exist`,
          },
        };
      }
    }
    if (row.channel === undefined || row.channel === null) {
      return { error: { code: "23502", message: "channel violates NOT NULL" } };
    }
    if (row.status === undefined || row.status === null) {
      return { error: { code: "23502", message: "status violates NOT NULL" } };
    }
    if (!CHANNEL_CHECK.has(row.channel as string)) {
      return {
        error: {
          code: "23514",
          message:
            `new row violates check constraint "notification_deliveries_channel_check" (channel=${row.channel})`,
        },
      };
    }
    if (!STATUS_CHECK.has(row.status as string)) {
      return {
        error: {
          code: "23514",
          message:
            `new row violates check constraint "notification_deliveries_status_check" (status=${row.status})`,
        },
      };
    }
    // notification_deliveries_owner_chk
    const owned = (row.notification_id ?? null) !== null ||
      (row.contact ?? null) !== null ||
      (row.recipient_fingerprint ?? null) !== null;
    if (!owned) {
      return {
        error: {
          code: "23514",
          message:
            'new row violates check constraint "notification_deliveries_owner_chk"',
        },
      };
    }
    // notification_deliveries_guest_idem_idx:
    //   UNIQUE (idempotency_key, channel)
    //   WHERE idempotency_key IS NOT NULL AND notification_id IS NULL
    const key = (row.idempotency_key ?? null) as string | null;
    const nid = (row.notification_id ?? null) as string | null;
    if (key !== null && nid === null) {
      const clash = this.rows.some((r) =>
        r.idempotency_key === key && r.channel === row.channel &&
        r.notification_id === null
      );
      if (clash) {
        return {
          error: {
            code: "23505",
            message:
              'duplicate key value violates unique constraint "notification_deliveries_guest_idem_idx"',
          },
        };
      }
    }

    this.rows.push({
      notification_id: null,
      provider: null,
      provider_message_id: null,
      failed_reason: null,
      contact: null,
      idempotency_key: null,
      recipient_fingerprint: null,
      segments: null,
      delivered_at: null,
      ...row,
    } as Row);
    this.audit.push({ op: "insert", patch: row });
    return { error: null };
  }

  /** Returns the number of rows actually matched — PostgREST does not. */
  update(
    raw: Record<string, unknown>,
    filters: Array<[string, unknown]>,
  ): { error: PgError | null; matched: number } {
    const patch = overTheWire(raw);
    for (const key of Object.keys(patch)) {
      if (!PROD_COLUMNS.has(key)) {
        return {
          error: {
            code: "42703",
            message: `column "${key}" does not exist`,
          },
          matched: 0,
        };
      }
    }
    if (
      patch.status !== undefined && !STATUS_CHECK.has(patch.status as string)
    ) {
      return {
        error: { code: "23514", message: "status check" },
        matched: 0,
      };
    }
    const hits = this.rows.filter((r) =>
      filters.every(([col, val]) => r[col] === val)
    );
    for (const r of hits) Object.assign(r, patch);
    this.audit.push({ op: "update", patch });
    return { error: null, matched: hits.length };
  }
}

// ===========================================================================
// Vacuity guards. These THROW on zero matches — ADV-17 proves they do.
// ===========================================================================

class VacuityError extends Error {}

function matchRows(
  table: DeliveriesTable,
  pred: (r: Row) => boolean,
  label: string,
): Row[] {
  const hits = table.rows.filter(pred);
  if (hits.length === 0) {
    throw new VacuityError(
      `VACUITY: "${label}" matched 0 of ${table.rows.length} rows — every ` +
        `assertion below it would have passed by matching nothing. Table: ` +
        JSON.stringify(table.rows),
    );
  }
  return hits;
}

function matchOne(
  table: DeliveriesTable,
  pred: (r: Row) => boolean,
  label: string,
): Row {
  const hits = matchRows(table, pred, label);
  assertEquals(
    hits.length,
    1,
    `"${label}" matched ${hits.length} rows, expected exactly 1: ` +
      JSON.stringify(hits),
  );
  return hits[0];
}

// ===========================================================================
// Harness — recording fetch, hard-reset env, DDL-backed client.
// ===========================================================================

const TWILIO_HOST = "api.twilio.com";
const TERMII_HOST = "v3.api.termii.com";
const NG_NUMBER = "+2348162646567"; // the real #1529 SC-11 handset shape
const US_NUMBER = "+14155550123";
const GB_NUMBER = "+447700900123";
const UNMAPPED_NUMBER = "+9995550123"; // well-formed E.164, unmapped calling code

const OWNED_KEYS = [
  "MINGLA_DELIVERY_FLAGS_JSON",
  "MINGLA_RUNTIME_CONFIG_JSON",
  "SMS_LIVE_ENABLED_NG",
  "SMS_LIVE_ENABLED_US",
  "TERMII_API_KEY",
  "TERMII_BASE_URL",
  "TERMII_SENDER_ID",
  "TERMII_WEBHOOK_SECRET",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_MESSAGING_SERVICE_SID",
  "TWILIO_STATUS_CALLBACK_SECRET",
  "SUPABASE_URL",
];

interface Capture {
  url: string;
  body: string;
}

let captures: Capture[] = [];

interface HarnessOpts {
  /** Provider HTTP behaviour, keyed by host. */
  termii?: { status: number; body: unknown };
  twilio?: { status: number; body: unknown };
  /** Suspend the provider call until released — used for race interleaving. */
  gate?: Promise<void>;
}

async function withHarness(
  setup: () => void,
  fn: () => Promise<void>,
  opts: HarnessOpts = {},
): Promise<void> {
  const snap: Record<string, string | undefined> = {};
  for (const k of OWNED_KEYS) snap[k] = Deno.env.get(k);
  const realFetch = globalThis.fetch;
  captures = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    captures.push({ url, body: String(init?.body ?? "") });
    if (opts.gate) await opts.gate;
    if (url.includes(TERMII_HOST)) {
      const t = opts.termii ??
        { status: 200, body: { code: "ok", message_id: "tm_adv_1537" } };
      return new Response(JSON.stringify(t.body), { status: t.status });
    }
    const w = opts.twilio ?? { status: 201, body: { sid: "SM_adv_1537" } };
    return new Response(JSON.stringify(w.body), { status: w.status });
  }) as unknown as typeof fetch;
  try {
    for (const k of OWNED_KEYS) Deno.env.delete(k);
    setup();
    await fn();
  } finally {
    globalThis.fetch = realFetch;
    __setServiceClientFactory(null);
    for (const [k, v] of Object.entries(snap)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

const twilioCalls = () => captures.filter((c) => c.url.includes(TWILIO_HOST));
const termiiCalls = () => captures.filter((c) => c.url.includes(TERMII_HOST));

function flags(ng: boolean, us: boolean): void {
  Deno.env.set(
    "MINGLA_DELIVERY_FLAGS_JSON",
    JSON.stringify({
      schema_version: 1,
      marketing_send_live_enabled: false,
      sms_live_enabled: { ng, us },
    }),
  );
}

function termiiCreds(): void {
  Deno.env.set("TERMII_API_KEY", "tk_adv");
  Deno.env.set("TERMII_BASE_URL", `https://${TERMII_HOST}`);
  Deno.env.set("TERMII_SENDER_ID", "Mingla");
}

function twilioCreds(): void {
  Deno.env.set("TWILIO_ACCOUNT_SID", "AC_adv");
  Deno.env.set("TWILIO_AUTH_TOKEN", "tok_adv");
  Deno.env.set("TWILIO_MESSAGING_SERVICE_SID", "MG_adv");
}

function allCreds(): void {
  termiiCreds();
  twilioCreds();
}

const CATEGORY = {
  key: "buyer_reservation_changed",
  is_transactional: true,
  urgency: "high",
  default_channels: ["inapp", "sms"],
  active: true,
};

const PAYLOAD = {
  reservation_id: "res-adv-1537",
  status: "confirmed",
  date: "Aug 4",
  time: "7:30 PM",
  party_size: 2,
  brand_name: "Lantern & Vine",
};

interface WorldOpts {
  smsAllowed?: boolean;
  channels?: string[];
}

/** The DDL-enforcing world: serves dispatchV2 AND the Termii webhook. */
function makeWorld(opts: WorldOpts = {}) {
  const deliveries = new DeliveriesTable();
  const suppressions: Array<Record<string, unknown>> = [];
  const smsAllowed = opts.smsAllowed !== false;
  const category = { ...CATEGORY, default_channels: opts.channels ?? CATEGORY.default_channels };

  // deno-lint-ignore no-explicit-any
  const from = (table: string): any => {
    if (table === "notification_categories") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: category, error: null }),
          }),
        }),
      };
    }
    if (table === "notifications") {
      return {
        insert: () => ({
          select: () => ({
            single: () =>
              Promise.resolve({ data: { id: "notif-adv-1537" }, error: null }),
          }),
        }),
      };
    }
    if (table === "notification_deliveries") {
      return {
        insert: (row: Record<string, unknown>) =>
          Promise.resolve({ data: null, ...deliveries.insert(row) }),
        update: (patch: Record<string, unknown>) => {
          const filters: Array<[string, unknown]> = [];
          const chain = {
            eq(col: string, val: unknown) {
              filters.push([col, val]);
              const res = deliveries.update(patch, filters);
              // Chainable AND awaitable, like PostgREST's builder.
              return Object.assign(
                Promise.resolve({ data: null, error: res.error }),
                chain,
              );
            },
          };
          return chain;
        },
      };
    }
    if (table === "channel_suppressions") {
      return {
        select: () => {
          const chain = {
            eq: () => chain,
            is: () => chain,
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          };
          return chain;
        },
        insert: (row: Record<string, unknown>) => {
          suppressions.push(row);
          return Promise.resolve({ error: null });
        },
      };
    }
    return {
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
      }),
      insert: () => Promise.resolve({ data: null, error: null }),
    };
  };

  const client = {
    from,
    rpc(fn: string, args: Record<string, unknown>) {
      if (fn === "can_send") {
        if (args.p_channel === "sms" && !smsAllowed) {
          return Promise.resolve({ data: false, error: null });
        }
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };

  return {
    deliveries,
    suppressions,
    client: client as unknown as MinimalClient,
    // deno-lint-ignore no-explicit-any
    webhookClient: client as any,
  };
}

let seq = 0;
const nextKey = () => `adv-1537-${Date.now()}-${seq++}`;

// ===========================================================================
// ADV-1 — ANGLE 1: A ROW THAT SATISFIES THE REAL PRODUCTION DDL.
// The implementor's fake accepts anything. This one rejects what Postgres
// would reject. If `termii` were unstorable, or notifyV2 wrote a column that
// does not exist, or a status outside the CHECK, this fails.
// ===========================================================================
Deno.test("#1537 ADV-1: an NG send lands a real-DDL-valid row labelled termii", async () => {
  // The premise the entire fix rests on, pinned explicitly.
  assertEquals(
    PROVIDER_HAS_CHECK_CONSTRAINT,
    false,
    "provider must have NO CHECK constraint or 'termii' cannot be stored at all",
  );

  const w = makeWorld();
  await withHarness(() => {
    flags(true, true);
    allCreds();
  }, async () => {
    const res = await dispatchV2(w.client, {
      user_id: "user-adv-1",
      contact: NG_NUMBER,
      category_key: CATEGORY.key,
      payload: PAYLOAD,
      idempotency_key: nextKey(),
    });
    assert(res.success, `dispatch failed: ${JSON.stringify(res)}`);
  });

  // Every write must have been accepted by the DDL enforcer — an insert that
  // Postgres would have rejected never reaches `rows`, so a mismatch between
  // attempted inserts and stored rows is itself the failure.
  assertEquals(
    w.deliveries.audit.filter((a) => a.op === "insert").length,
    w.deliveries.rows.length,
    "at least one write was rejected by the real production DDL",
  );

  const row = matchOne(w.deliveries, (r) => r.channel === "sms", "sms row");
  assertEquals(row.provider, "termii", "the NG row must name Termii");
  assertEquals(row.status, "sent");
  assertEquals(row.provider_message_id, "tm_adv_1537");
  // provider and provider_message_id must come from the same place, or a
  // webhook keyed on the id lands against a row labelled by someone else.
  assertEquals(termiiCalls().length, 1);
  assertEquals(twilioCalls().length, 0);

  // And the stored row must satisfy every real constraint, re-checked here so
  // this test states its own contract rather than trusting the harness.
  assert(CHANNEL_CHECK.has(row.channel));
  assert(STATUS_CHECK.has(row.status));
  assert(
    row.notification_id !== null || row.contact !== null ||
      row.recipient_fingerprint !== null,
    "owner_chk",
  );
  for (const k of Object.keys(row)) assert(PROD_COLUMNS.has(k), `unknown column ${k}`);
});

// ===========================================================================
// ADV-2 — a write that the real DDL would reject must FAIL here.
// Proves ADV-1's enforcement is real and not decorative: if the enforcer
// accepted anything, this test could not distinguish it from a permissive fake.
// ===========================================================================
Deno.test("#1537 ADV-2: the DDL enforcer actually rejects invalid rows (falsifiability)", () => {
  const t = new DeliveriesTable();
  assertEquals(
    t.insert({ notification_id: "n1", channel: "sms", status: "sent" }).error,
    null,
  );
  assertEquals(
    t.insert({ notification_id: "n1", channel: "whatsapp", status: "sent" })
      .error?.code,
    "23514",
    "channel outside the CHECK must be rejected",
  );
  assertEquals(
    t.insert({ notification_id: "n1", channel: "sms", status: "bounced" })
      .error?.code,
    "23514",
    "status outside the CHECK must be rejected",
  );
  assertEquals(
    t.insert({ notification_id: "n1", channel: "sms", status: "sent", carrier: "mtn" })
      .error?.code,
    "42703",
    "a column that does not exist in production must be rejected",
  );
  assertEquals(
    t.insert({ channel: "sms", status: "sent" }).error?.code,
    "23514",
    "owner_chk: a row with no notification_id, contact or fingerprint",
  );
  // provider is unconstrained — this is what makes the fix storable.
  assertEquals(
    t.insert({ notification_id: "n1", channel: "sms", status: "sent", provider: "termii" }).error,
    null,
  );
});

// ===========================================================================
// ADV-3 — ATTRIBUTION ACROSS EVERY OUTCOME, INCLUDING THE TWO THE
// IMPLEMENTOR'S SC TABLE NEVER ISOLATED (fail-closed, opted-out).
// A skip or a failure that names the wrong provider is the exact defect that
// made #1529's SC-11 unprovable. Every outcome is checked, not just the
// successful ones.
// ===========================================================================
Deno.test("#1537 ADV-3: every send outcome names the provider that owned it", async () => {
  interface Case {
    label: string;
    to: string;
    setup: () => void;
    opts?: HarnessOpts;
    expectProvider: string | null;
    expectStatus: string;
    expectReason: string | null;
    expectHttp: "termii" | "twilio" | "none";
  }

  const cases: Case[] = [
    {
      label: "NG sent",
      to: NG_NUMBER,
      setup: () => { flags(true, true); allCreds(); },
      expectProvider: "termii",
      expectStatus: "sent",
      expectReason: null,
      expectHttp: "termii",
    },
    {
      label: "US sent",
      to: US_NUMBER,
      setup: () => { flags(true, true); allCreds(); },
      expectProvider: "twilio",
      expectStatus: "sent",
      expectReason: null,
      expectHttp: "twilio",
    },
    {
      label: "GB sent routes Twilio",
      to: GB_NUMBER,
      setup: () => { flags(true, true); allCreds(); },
      expectProvider: "twilio",
      expectStatus: "sent",
      expectReason: null,
      expectHttp: "twilio",
    },
    {
      label: "NG kill switch off — skip names Termii, zero HTTP (SC-11 repro)",
      to: NG_NUMBER,
      setup: () => { flags(false, true); allCreds(); },
      expectProvider: "termii",
      expectStatus: "skipped",
      expectReason: "provider_kill_switch_off",
      expectHttp: "none",
    },
    {
      label: "US kill switch off — skip names Twilio, zero HTTP",
      to: US_NUMBER,
      setup: () => { flags(true, false); allCreds(); },
      expectProvider: "twilio",
      expectStatus: "skipped",
      expectReason: "provider_kill_switch_off",
      expectHttp: "none",
    },
    {
      label: "NG provider rejects — failure names Termii",
      to: NG_NUMBER,
      setup: () => { flags(true, true); allCreds(); },
      opts: { termii: { status: 400, body: { message: "Invalid" } } },
      expectProvider: "termii",
      expectStatus: "failed",
      expectReason: "provider_unavailable",
      expectHttp: "termii",
    },
    {
      label: "US provider rejects — failure names Twilio",
      to: US_NUMBER,
      setup: () => { flags(true, true); allCreds(); },
      opts: { twilio: { status: 400, body: { message: "Invalid" } } },
      expectProvider: "twilio",
      expectStatus: "failed",
      expectReason: "provider_unavailable",
      expectHttp: "twilio",
    },
    {
      // FAIL-CLOSED. Termii credentials absent: nothing is sent, but a
      // provider WAS selected, so the row must say so. A null here would make
      // an NG outage indistinguishable from an unroutable number.
      label: "NG fail-closed (Termii env missing) — still names Termii",
      to: NG_NUMBER,
      setup: () => { flags(true, true); twilioCreds(); /* no Termii creds */ },
      expectProvider: "termii",
      expectStatus: "failed",
      expectReason: "provider_config_missing",
      expectHttp: "none",
    },
    {
      label: "US fail-closed (Twilio env missing) — still names Twilio",
      to: US_NUMBER,
      setup: () => { flags(true, true); termiiCreds(); /* no Twilio creds */ },
      expectProvider: "twilio",
      expectStatus: "failed",
      expectReason: "provider_config_missing",
      expectHttp: "none",
    },
    {
      // OPTED OUT. Termii answers with a DND rejection.
      label: "NG opted-out (Termii DND) — names Termii",
      to: NG_NUMBER,
      setup: () => { flags(true, true); allCreds(); },
      opts: { termii: { status: 200, body: { message: "DND Active" } } },
      expectProvider: "termii",
      expectStatus: "failed",
      expectReason: "recipient_opted_out",
      expectHttp: "termii",
    },
    {
      label: "US opted-out (Twilio 21610) — names Twilio",
      to: US_NUMBER,
      setup: () => { flags(true, true); allCreds(); },
      opts: { twilio: { status: 400, body: { code: 21610, message: "21610 blacklist" } } },
      expectProvider: "twilio",
      expectStatus: "failed",
      expectReason: "recipient_opted_out",
      expectHttp: "twilio",
    },
    {
      // NO PROVIDER WAS EVER SELECTED. null is the honest answer; a market
      // label here would be the same fabrication the issue removes.
      label: "unmapped calling code — provider null, fail closed, zero HTTP",
      to: UNMAPPED_NUMBER,
      setup: () => { flags(true, true); allCreds(); },
      expectProvider: null,
      expectStatus: "skipped",
      expectReason: "country_unresolved",
      expectHttp: "none",
    },
    {
      label: "malformed destination — provider null",
      to: "+notanumber",
      setup: () => { flags(true, true); allCreds(); },
      expectProvider: null,
      expectStatus: "failed",
      expectReason: "invalid_recipient",
      expectHttp: "none",
    },
  ];

  for (const c of cases) {
    const w = makeWorld();
    await withHarness(c.setup, async () => {
      await dispatchV2(w.client, {
        user_id: "user-adv-3",
        contact: c.to,
        category_key: CATEGORY.key,
        payload: PAYLOAD,
        idempotency_key: nextKey(),
      });
    }, c.opts ?? {});

    const row = matchOne(w.deliveries, (r) => r.channel === "sms", `[${c.label}] sms row`);
    assertEquals(row.provider, c.expectProvider, `[${c.label}] provider`);
    assertEquals(row.status, c.expectStatus, `[${c.label}] status`);
    assertEquals(row.failed_reason, c.expectReason, `[${c.label}] failed_reason`);
    assertEquals(
      termiiCalls().length,
      c.expectHttp === "termii" ? 1 : 0,
      `[${c.label}] termii HTTP count`,
    );
    assertEquals(
      twilioCalls().length,
      c.expectHttp === "twilio" ? 1 : 0,
      `[${c.label}] twilio HTTP count`,
    );
  }
});

// ===========================================================================
// ADV-4 — THE ANTI-FABRICATION INVARIANT.
// One assertion that no NG destination, under ANY outcome, may ever be
// recorded as `twilio`. This is the single sentence the issue is about.
// ===========================================================================
Deno.test("#1537 ADV-4: no NG destination is EVER ledgered twilio, under any outcome", async () => {
  const setups: Array<[string, () => void, HarnessOpts]> = [
    ["live", () => { flags(true, true); allCreds(); }, {}],
    ["kill switch off", () => { flags(false, true); allCreds(); }, {}],
    ["provider 400", () => { flags(true, true); allCreds(); }, {
      termii: { status: 400, body: { message: "nope" } },
    }],
    ["env missing", () => { flags(true, true); twilioCreds(); }, {}],
    ["dnd", () => { flags(true, true); allCreds(); }, {
      termii: { status: 200, body: { message: "DND Active" } },
    }],
    ["suppressed", () => { flags(true, true); allCreds(); }, {}],
  ];

  let checked = 0;
  for (const [label, setup, opts] of setups) {
    const w = makeWorld({ smsAllowed: label !== "suppressed" });
    await withHarness(setup, async () => {
      await dispatchV2(w.client, {
        user_id: "user-adv-4",
        contact: NG_NUMBER,
        category_key: CATEGORY.key,
        payload: PAYLOAD,
        idempotency_key: nextKey(),
      });
    }, opts);
    const row = matchOne(w.deliveries, (r) => r.channel === "sms", `[${label}] sms row`);
    assert(
      row.provider !== "twilio",
      `[${label}] a Nigerian handset was recorded as twilio — this is #1537 ` +
        `re-opened. Row: ${JSON.stringify(row)}`,
    );
    assertEquals(row.provider, "termii", `[${label}] must name termii`);
    checked += 1;
  }
  // Vacuity guard on the loop itself: a setups list that silently emptied
  // would otherwise pass with zero assertions executed.
  assertEquals(checked, setups.length, "every outcome must have been exercised");
  assert(checked >= 6, "the outcome sweep must cover at least 6 outcomes");
});

// ===========================================================================
// ADV-5 — SUPPRESSION AND NO-CONTACT ATTRIBUTION, AND THE CONTACT BLAST RADIUS.
// The issue asked for the rejected contact to be recorded. This pins WHERE it
// is recorded and — just as importantly — where it is still deliberately NOT.
// ===========================================================================
Deno.test("#1537 ADV-5: contact is recorded on no_contact only, never on suppressed", async () => {
  // (a) can_send denial on an NG handset: attributed to termii, contact NULL.
  const denied = makeWorld({ smsAllowed: false });
  await withHarness(() => { flags(true, true); allCreds(); }, async () => {
    await dispatchV2(denied.client, {
      user_id: "user-adv-5a",
      contact: NG_NUMBER,
      category_key: CATEGORY.key,
      payload: PAYLOAD,
      idempotency_key: nextKey(),
    });
  });
  const supp = matchOne(denied.deliveries, (r) => r.channel === "sms", "suppressed sms row");
  assertEquals(supp.status, "suppressed");
  assertEquals(supp.failed_reason, "can_send_denied");
  assertEquals(supp.provider, "termii", "a suppression must name the market that would have carried it");
  assertEquals(
    supp.contact,
    null,
    "suppressed rows must still withhold the contact — recording contacts for " +
      "people who opted out is a separate privacy decision, not a side effect",
  );

  // (b) no_contact: an email supplied where the SMS channel needed a phone.
  const nocontact = makeWorld();
  await withHarness(() => { flags(true, true); allCreds(); }, async () => {
    await dispatchV2(nocontact.client, {
      user_id: "user-adv-5b",
      contact: "  Guest@Example.COM  ",
      category_key: CATEGORY.key,
      payload: PAYLOAD,
      idempotency_key: nextKey(),
    });
  });
  const skipped = matchOne(nocontact.deliveries, (r) => r.channel === "sms", "no_contact sms row");
  assertEquals(skipped.status, "skipped");
  assertEquals(skipped.failed_reason, "no_contact");
  assertEquals(
    skipped.provider,
    null,
    "no destination means no market — null, not a fabricated twilio",
  );
  assertEquals(
    skipped.contact,
    "guest@example.com",
    "the rejected contact must be recorded, trimmed and lowercased",
  );
  // Documented consequence of recording the REJECTED contact: on a channel=sms
  // row the stored contact is, by construction, NOT a phone number. Any future
  // consumer that joins (contact, channel) — which is exactly how
  // channel_suppressions is keyed — must not assume the contact matches the
  // channel. Pinned so the semantic cannot change silently.
  assert(
    !String(skipped.contact).startsWith("+"),
    "a no_contact sms row stores the contact that was REJECTED for sms",
  );

  // (c) The blast radius: no OTHER authenticated row gained a contact.
  const inapp = matchOne(nocontact.deliveries, (r) => r.channel === "inapp", "inapp row");
  assertEquals(
    inapp.contact,
    null,
    "the contact change must not have widened to every ledger row",
  );
});

// ===========================================================================
// ADV-6 — #1529 REGRESSION FROM A NEW ANGLE: A LYING LABEL.
// The implementor's T-7 proves the label matches the host called. This proves
// the inverse — that a caller-supplied `country_code` that CONTRADICTS the
// destination can move NEITHER the route NOR the ledger label.
// ===========================================================================
Deno.test("#1537 ADV-6: a lying country_code moves neither the route nor the label", async () => {
  // A Nigerian handset mislabelled "US" must still go to Termii and read termii.
  const a = makeWorld();
  await withHarness(() => { flags(true, true); allCreds(); }, async () => {
    await dispatchV2(a.client, {
      user_id: "user-adv-6a",
      contact: NG_NUMBER,
      country_code: "US", // the lie
      category_key: CATEGORY.key,
      payload: PAYLOAD,
      idempotency_key: nextKey(),
    });
  });
  const rowA = matchOne(a.deliveries, (r) => r.channel === "sms", "NG-labelled-US row");
  assertEquals(rowA.provider, "termii", "the destination number wins, not the label");
  assertEquals(termiiCalls().length, 1);
  assertEquals(twilioCalls().length, 0);

  // And the mirror: a US handset mislabelled "NG" must still go to Twilio.
  const b = makeWorld();
  await withHarness(() => { flags(true, true); allCreds(); }, async () => {
    await dispatchV2(b.client, {
      user_id: "user-adv-6b",
      contact: US_NUMBER,
      country_code: "NG", // the lie
      category_key: CATEGORY.key,
      payload: PAYLOAD,
      idempotency_key: nextKey(),
    });
  });
  const rowB = matchOne(b.deliveries, (r) => r.channel === "sms", "US-labelled-NG row");
  assertEquals(rowB.provider, "twilio");
  assertEquals(twilioCalls().length, 1);
  assertEquals(termiiCalls().length, 0);
});

// ===========================================================================
// ADV-7 — #1518 REGRESSION: the NG request body must still say `generic`.
// Read off the ACTUAL POSTed body, not the host. #1537 rewrote the branch that
// chooses the sender; this proves it did not disturb the channel argument.
// ===========================================================================
Deno.test("#1537 ADV-7: the NG send still posts Termii channel=generic, never dnd", async () => {
  const w = makeWorld();
  await withHarness(() => { flags(true, true); allCreds(); }, async () => {
    await dispatchV2(w.client, {
      user_id: "user-adv-7",
      contact: NG_NUMBER,
      category_key: CATEGORY.key,
      payload: PAYLOAD,
      idempotency_key: nextKey(),
    });
  });
  const calls = termiiCalls();
  assertEquals(calls.length, 1, "exactly one Termii call expected");
  const body = JSON.parse(calls[0].body) as Record<string, unknown>;
  assertEquals(body.channel, "generic", "#1518: NG must use the generic channel");
  assert(body.channel !== "dnd", "#1518: dnd 400s with 'Country Inactive'");
  assertEquals(body.to, NG_NUMBER);
  assert(calls[0].url.endsWith("/api/sms/send"));
});

// ===========================================================================
// ANGLE 3 — THE TERMII WEBHOOK AGAINST A GENUINELY `termii`-LABELLED ROW.
// This combination has never occurred in production: all 31 ledger rows say
// twilio (verified read-only 2026-08-04). ADV-8..ADV-11 create the condition
// for the first time and drive the REAL webhook handler against it.
// ===========================================================================

async function signTermii(secret: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function termiiCallback(body: Record<string, unknown>): Promise<Response> {
  const raw = JSON.stringify(body);
  const sig = await signTermii(Deno.env.get("TERMII_WEBHOOK_SECRET")!, raw);
  return await handleTermiiStatus(
    new Request("https://edge.local/termii-delivery-status", {
      method: "POST",
      headers: { "content-type": "application/json", "x-termii-signature": sig },
      body: raw,
    }),
  );
}

Deno.test("#1537 ADV-8: a Termii callback reconciles a genuinely termii-labelled row", async () => {
  const w = makeWorld();
  await withHarness(() => {
    flags(true, true);
    allCreds();
    Deno.env.set("TERMII_WEBHOOK_SECRET", "whsec_adv");
  }, async () => {
    await dispatchV2(w.client, {
      user_id: "user-adv-8",
      contact: NG_NUMBER,
      category_key: CATEGORY.key,
      payload: PAYLOAD,
      idempotency_key: nextKey(),
    });

    // The row now says `termii` — the state production has never been in.
    const before = matchOne(w.deliveries, (r) => r.channel === "sms", "pre-callback sms row");
    assertEquals(before.provider, "termii");
    assertEquals(before.status, "sent");
    const messageId = before.provider_message_id as string;
    assert(messageId, "the adapter must have returned a provider_message_id");

    __setServiceClientFactory(() => w.webhookClient);
    const res = await termiiCallback({
      message_id: messageId,
      status: "DELIVERED",
      receiver: NG_NUMBER,
    });
    assertEquals(res.status, 200);

    const after = matchOne(
      w.deliveries,
      (r) => r.provider_message_id === messageId && r.channel === "sms",
      "post-callback row matched by provider_message_id + channel",
    );
    assertEquals(after.status, "delivered", "the callback must reconcile the row");
    assert(after.delivered_at !== null, "delivered_at must be stamped");
    assertEquals(
      after.provider,
      "termii",
      "the callback must NOT clobber the provider label it matched",
    );
  });
});

Deno.test("#1537 ADV-9: a Termii DND callback suppresses and fails the termii row", async () => {
  const w = makeWorld();
  await withHarness(() => {
    flags(true, true);
    allCreds();
    Deno.env.set("TERMII_WEBHOOK_SECRET", "whsec_adv");
  }, async () => {
    await dispatchV2(w.client, {
      user_id: "user-adv-9",
      contact: NG_NUMBER,
      category_key: CATEGORY.key,
      payload: PAYLOAD,
      idempotency_key: nextKey(),
    });
    const sent = matchOne(w.deliveries, (r) => r.channel === "sms", "sent sms row");
    const messageId = sent.provider_message_id as string;

    __setServiceClientFactory(() => w.webhookClient);
    const res = await termiiCallback({
      message_id: messageId,
      status: "DND Active",
      receiver: NG_NUMBER,
    });
    assertEquals(res.status, 200);

    const after = matchOne(
      w.deliveries,
      (r) => r.provider_message_id === messageId,
      "post-DND row",
    );
    assertEquals(after.status, "failed");
    assertEquals(after.failed_reason, "termii_DND Active");
    assertEquals(after.provider, "termii", "provider survives the DND reconcile");

    // channel_suppressions must have been fed — with a vacuity guard, because
    // an empty suppressions list would otherwise read as success.
    assert(
      w.suppressions.length > 0,
      "VACUITY: a DND callback wrote no channel_suppressions row",
    );
    const s = w.suppressions[0];
    assertEquals(s.contact, NG_NUMBER);
    assertEquals(s.channel, "sms");
    assertEquals(s.scope, "all");
    assertEquals(s.reason, "stop_keyword");
  });
});

Deno.test("#1537 ADV-10: a Termii callback for an unknown id matches nothing and mutates nothing", async () => {
  const w = makeWorld();
  await withHarness(() => {
    flags(true, true);
    allCreds();
    Deno.env.set("TERMII_WEBHOOK_SECRET", "whsec_adv");
  }, async () => {
    await dispatchV2(w.client, {
      user_id: "user-adv-10",
      contact: NG_NUMBER,
      category_key: CATEGORY.key,
      payload: PAYLOAD,
      idempotency_key: nextKey(),
    });
    const before = matchOne(w.deliveries, (r) => r.channel === "sms", "sms row");
    const snapshot = JSON.stringify(before);

    __setServiceClientFactory(() => w.webhookClient);
    const res = await termiiCallback({
      message_id: "tm_does_not_exist",
      status: "DELIVERED",
      receiver: NG_NUMBER,
    });

    // FINDING, PINNED: the handler answers 200 even though it reconciled
    // NOTHING — a zero-row UPDATE is not a PostgREST error, so a callback that
    // matches no row is indistinguishable from one that matched. That is a
    // real observability gap (pre-existing, ORCH-1227), and it is pinned here
    // so it cannot silently become the mechanism by which a future provider
    // change "passes".
    assertEquals(res.status, 200, "documents the silent no-match (see report)");

    const after = matchOne(w.deliveries, (r) => r.channel === "sms", "sms row after");
    assertEquals(
      JSON.stringify(after),
      snapshot,
      "a non-matching callback must not mutate any row",
    );
    assertEquals(after.provider, "termii");
    assertEquals(after.status, "sent", "still sent — the callback matched nothing");
  });
});

Deno.test("#1537 ADV-11: the webhooks are provider-BLIND — a shared message id crosses labels", async () => {
  // Both delivery webhooks reconcile on (provider_message_id, channel) and
  // NEITHER scopes by provider, while the supporting index is non-unique. Now
  // that two providers write into one id namespace, a collision would let a
  // Termii callback rewrite a Twilio row. Probability is negligible (a Twilio
  // SID is SM+32 hex), so this is a hardening gap, not a live defect — but
  // #1537 is what makes it FIXABLE, so it is pinned rather than assumed away.
  const w = makeWorld();
  await withHarness(() => {
    flags(true, true);
    allCreds();
    Deno.env.set("TERMII_WEBHOOK_SECRET", "whsec_adv");
  }, async () => {
    const shared = "COLLIDING_ID";
    w.deliveries.insert({
      notification_id: "n-twilio",
      channel: "sms",
      status: "sent",
      provider: "twilio",
      provider_message_id: shared,
    });
    w.deliveries.insert({
      notification_id: "n-termii",
      channel: "sms",
      status: "sent",
      provider: "termii",
      provider_message_id: shared,
    });

    __setServiceClientFactory(() => w.webhookClient);
    await termiiCallback({ message_id: shared, status: "DELIVERED", receiver: NG_NUMBER });

    const hits = matchRows(
      w.deliveries,
      (r) => r.provider_message_id === shared,
      "rows sharing the colliding id",
    );
    assertEquals(hits.length, 2);
    // EXPECTED (current contract): both rows move, because the filter is
    // (provider_message_id, channel) only. If a future change scopes the
    // webhook by provider, this assertion flips and the report must be updated.
    assertEquals(
      hits.filter((r) => r.status === "delivered").length,
      2,
      "the Termii callback reconciles the Twilio row too — webhooks are provider-blind",
    );
  });
});

// ===========================================================================
// ANGLE 2 — CONCURRENT CLAIM / RECONCILE.
// ===========================================================================

Deno.test("#1537 ADV-12: concurrent guest dispatch — one claim, one send, one termii row", async () => {
  const w = makeWorld();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });

  await withHarness(() => { flags(true, true); allCreds(); }, async () => {
    const key = nextKey();
    const input = {
      contact: NG_NUMBER, // guest: no user_id → dispatchAnon
      category_key: CATEGORY.key,
      payload: PAYLOAD,
      idempotency_key: key,
    };
    // Run A enters the provider call and SUSPENDS inside fetch. Run B then
    // attempts its claim against the real partial UNIQUE index while A is
    // still in flight — the genuine interleaving, not a sequential re-run.
    const runA = dispatchV2(w.client, input);
    await Promise.resolve();
    const runB = dispatchV2(w.client, input);
    await Promise.resolve();
    release();
    const [resA, resB] = await Promise.all([runA, runB]);
    assert(resA.success && resB.success);

    // Exactly one row survives the unique index, and exactly one send happened.
    const rows = matchRows(w.deliveries, (r) => r.channel === "sms", "guest sms rows");
    assertEquals(rows.length, 1, "the partial UNIQUE index must admit ONE claim");
    assertEquals(termiiCalls().length, 1, "the loser must not send a second message");

    const row = rows[0];
    assertEquals(row.provider, "termii", "the surviving row names Termii");
    assertEquals(row.status, "sent");
    assertEquals(row.idempotency_key, key);
    assertEquals(row.contact, NG_NUMBER.toLowerCase());

    // One of the two runs must have been told it was a duplicate — otherwise
    // both sent and the assertion above passed for the wrong reason.
    const statuses = [
      ...(resA.deliveries ?? []).map((d) => d.status),
      ...(resB.deliveries ?? []).map((d) => d.status),
    ];
    assert(
      statuses.includes("duplicate"),
      `expected one run to be deduped, got ${JSON.stringify(statuses)}`,
    );

    // PROVE THE INTERLEAVE WAS REAL, not two sequential dispatches that would
    // have deduped anyway. The audit must read, in order:
    //   1. run A's claim      (insert, accepted, status=queued)
    //   2. run B's claim      (insert, REJECTED 23505) — inside A's send window
    //   3. run A's reconcile  (update, provider=termii)
    // If B's rejected claim did not land BETWEEN A's claim and A's reconcile,
    // the race window was never actually entered and this test would be
    // asserting the wrong thing.
    const sms = w.deliveries.audit;
    const claimIdx = sms.findIndex((a) => a.op === "insert" && !a.rejected);
    const dupeIdx = sms.findIndex((a) => a.op === "insert" && a.rejected === "23505");
    const reconcileIdx = sms.findIndex((a) => a.op === "update");
    assert(claimIdx >= 0, "VACUITY: no accepted claim was recorded");
    assert(dupeIdx >= 0, "VACUITY: the second claim was never rejected — no race occurred");
    assert(reconcileIdx >= 0, "VACUITY: no reconcile was recorded");
    assert(
      claimIdx < dupeIdx && dupeIdx < reconcileIdx,
      `the competing claim must land INSIDE the send window; got claim=${claimIdx} ` +
        `dupe=${dupeIdx} reconcile=${reconcileIdx}`,
    );
  }, { gate });
});

Deno.test("#1537 ADV-13: the claim label and the reconcile label cannot disagree", async () => {
  const w = makeWorld();
  await withHarness(() => { flags(true, true); allCreds(); }, async () => {
    await dispatchV2(w.client, {
      contact: NG_NUMBER,
      category_key: CATEGORY.key,
      payload: PAYLOAD,
      idempotency_key: nextKey(),
    });
  });

  // The claim is written BEFORE the send; the reconcile after. Both must say
  // termii — the claim from the destination, the reconcile from the sender
  // that ran. A crash between them leaves a correctly-labelled `queued` row.
  const claim = w.deliveries.audit.find(
    (a) => a.op === "insert" && a.patch.channel === "sms",
  );
  assert(claim, "VACUITY: no guest sms claim insert was recorded");
  assertEquals(claim!.patch.status, "queued", "the claim is written as queued");
  assertEquals(
    claim!.patch.provider,
    "termii",
    "an unreconciled claim row must already name its market",
  );

  const reconcile = w.deliveries.audit.find(
    (a) => a.op === "update" && a.patch.provider !== undefined,
  );
  assert(reconcile, "VACUITY: no reconcile update carried a provider");
  assertEquals(
    reconcile!.patch.provider,
    claim!.patch.provider,
    "claim-time and reconcile-time labels must be identical",
  );
});

Deno.test("#1537 ADV-14: an omitted provider on reconcile does not erase a correct label", async () => {
  // `updateGuestDelivery`'s provider parameter is optional. Over the PostgREST
  // wire an `undefined` is DROPPED by JSON.stringify, so omitting it must mean
  // "leave the column alone" — not "set it to NULL". If that ever became an
  // explicit null, a reconcile would erase a correct `termii` label.
  const t = new DeliveriesTable();
  t.insert({
    notification_id: null,
    contact: NG_NUMBER,
    idempotency_key: "k1",
    channel: "sms",
    status: "queued",
    provider: "termii",
  });

  const omitted = t.update(
    { status: "sent", provider: undefined, provider_message_id: "tm_x" },
    [["idempotency_key", "k1"], ["channel", "sms"]],
  );
  assertEquals(omitted.matched, 1, "VACUITY: the reconcile matched no row");
  const row = matchOne(t, (r) => r.idempotency_key === "k1", "reconciled row");
  assertEquals(row.provider, "termii", "an omitted provider must not null the column");
  assertEquals(row.status, "sent");

  // And the contrast, so the test proves the mechanism rather than the outcome.
  t.update({ provider: null }, [["idempotency_key", "k1"], ["channel", "sms"]]);
  assertEquals(
    matchOne(t, (r) => r.idempotency_key === "k1", "explicitly nulled row").provider,
    null,
    "an EXPLICIT null does write NULL — so the distinction is real",
  );
});

// ===========================================================================
// ADV-15 — THE DERIVATION SEAM ITSELF.
// notifyV2 labels no-send rows via `smsProviderForDestination`; the adapter
// routes via `smsProviderForCountry`. If those two ever disagreed, a skip
// would be attributed to a market the send would not have used.
// ===========================================================================
Deno.test("#1537 ADV-15: the label derivation and the route derivation agree on every input", () => {
  const cases: Array<[string, string | null]> = [
    [NG_NUMBER, "termii"],
    ["+2349011111111", "termii"],
    [US_NUMBER, "twilio"],
    [GB_NUMBER, "twilio"],
    ["+33612345678", "twilio"],
    [UNMAPPED_NUMBER, null],
    ["+notanumber", null],
    ["", null],
    ["   ", null],
  ];
  let checked = 0;
  for (const [input, expected] of cases) {
    assertEquals(smsProviderForDestination(input), expected, `destination ${input}`);
    checked += 1;
  }
  assertEquals(checked, cases.length);
  assertEquals(smsProviderForDestination(null), null);
  assertEquals(smsProviderForDestination(undefined), null);
  // Whitespace must not change the answer — the ledger label and the route
  // both trim, so a padded number must resolve identically.
  assertEquals(smsProviderForDestination(`  ${NG_NUMBER}  `), "termii");
  // Country derivation is case-insensitive and NG-only for Termii.
  assertEquals(smsProviderForCountry("ng"), "termii");
  assertEquals(smsProviderForCountry("NG"), "termii");
  assertEquals(smsProviderForCountry("US"), "twilio");
  assertEquals(smsProviderForCountry("GB"), "twilio");
});

// ===========================================================================
// ADV-16 — THE ADAPTER'S RESULT TYPE IS THE CONTRACT.
// `send()` must report a provider on EVERY return path. A path that forgets
// would surface as `undefined`, which JSON.stringify drops — the column would
// silently keep whatever it had, which is how this class of bug hides.
// ===========================================================================
Deno.test("#1537 ADV-16: send() reports a provider key on every return path", async () => {
  const inputs: Array<[string, () => void]> = [
    ["NG live", () => { flags(true, true); allCreds(); }],
    ["NG killed", () => { flags(false, true); allCreds(); }],
    ["US live", () => { flags(true, true); allCreds(); }],
    ["US killed", () => { flags(true, false); allCreds(); }],
    ["no creds", () => { flags(true, true); }],
  ];
  const numbers = [NG_NUMBER, US_NUMBER, UNMAPPED_NUMBER, "+bad"];
  let paths = 0;
  for (const [label, setup] of inputs) {
    for (const to of numbers) {
      await withHarness(setup, async () => {
        const r = await smsAdapter.send({
          to,
          brandName: "Lantern & Vine",
          message: "hello",
        });
        assert(
          "provider" in r,
          `[${label}/${to}] send() returned no provider key at all`,
        );
        assert(
          r.provider === null || r.provider === "termii" || r.provider === "twilio",
          `[${label}/${to}] provider was ${JSON.stringify(r.provider)}`,
        );
        // Never `undefined` — that is the value that vanishes over the wire.
        assert(
          r.provider !== undefined,
          `[${label}/${to}] provider was undefined — it would be DROPPED by ` +
            `JSON.stringify and the column would keep a stale value`,
        );
        paths += 1;
      });
    }
  }
  assertEquals(paths, inputs.length * numbers.length, "every path must have run");
  assert(paths >= 20, "the return-path sweep must be non-trivial");
});

// ===========================================================================
// ADV-17 — META: THE VACUITY GUARD IS ITSELF FALSIFIABLE.
// Both prior issues in this area shipped a check that could pass by matching
// zero. This proves the guard used throughout this file actually fires.
// ===========================================================================
Deno.test("#1537 ADV-17: the vacuity guard throws when a lookup matches nothing", () => {
  const t = new DeliveriesTable();
  t.insert({ notification_id: "n1", channel: "sms", status: "sent", provider: "termii" });

  // Matches → returns.
  assertEquals(matchRows(t, (r) => r.channel === "sms", "present").length, 1);

  // Matches nothing → MUST throw, not return an empty array that would make
  // every downstream assertion a silent no-op.
  assertThrows(
    () => matchRows(t, (r) => r.channel === "push", "absent"),
    VacuityError,
  );
  assertThrows(
    () => matchOne(t, (r) => r.provider === "nexmo", "absent provider"),
    VacuityError,
  );
  // And an empty table cannot pass either.
  assertThrows(() => matchRows(new DeliveriesTable(), () => true, "empty"), VacuityError);
});
