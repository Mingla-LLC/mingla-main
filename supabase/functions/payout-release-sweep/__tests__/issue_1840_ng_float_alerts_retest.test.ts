// Issue #1840 RETEST — independent adversarial guard for the rework
// (append-only, tester, second pass). New file; my first-pass file
// issue_1840_ng_float_alerts_adversarial.test.ts keeps its B-series and is not
// touched by me here.
//
// The rework closed both of my conditions. While closing C2 the implementor
// found a second half neither the coordinator nor I had seen: notify-dispatch
// dedupes on `idempotencyKey`, and that key was derived from the release id,
// so a corrected figure for the same release was a downstream duplicate — the
// re-armed outbox row would have been delivered into a black hole. That fix is
// scoped to exactly one alert kind, which makes the scoping itself the risk.
//
// D1  the scoping is a TRAP FOR THE NEXT PERSON unless it is kept in sync with
//     the SQL. Derived from the migration: the set of kinds whose outbox key
//     carries structure beyond the canonical `<kind>:<release_id>` must be
//     EXACTLY the set the notifier honours. A future kind that writes a
//     revision-bearing key without being added to the notifier would have its
//     corrected payload deduped away — the same defect, one iteration later.
// D2  the fail direction: an unrecognised kind must NOT reach the revision
//     branch, and must fall back to the #1217 key.
// D3  the six pre-existing kinds keep byte-identical delivery behaviour. They
//     are live money alerts; a regression there is worse than the bug fixed.
// D4  the outbox key really is carried from the drain to the notifier for
//     every kind — the plumbing the SQL half depends on.
// D5  C3 at runtime: the forecast survives the partner-attribution 409 AND the
//     Stripe-phase 500.
// D6  where the forecast still cannot run, stated precisely rather than
//     assumed — the seam is `PAYOUT_RELEASE_EXECUTE`, plus the pre-gate
//     database-unreachable 500s.
// D7  a forecast failure is a durable verdict AND a machine-readable log event.
// D8  clamping can never disable the forecast: swept exhaustively.
//
// Fails-on-revert (verified by real line deletions):
//   * drop the `alertKind === "paystack_float_shortfall"` guard  -> D2, D3;
//   * drop the 4th argument at the delivery call site            -> D4;
//   * move the forecast back after the release phases            -> D5;
//   * revert the failure verdict to `{}`                         -> D7;
//   * remove the clamp                                           -> D8.
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handlePayoutReleaseSweep } from "../index.ts";
import {
  NG_PAYOUT_FLOAT_HORIZON_DEFAULT_DAYS,
  NG_PAYOUT_FLOAT_HORIZON_MAX_DAYS,
  NG_PAYOUT_FLOAT_HORIZON_MIN_DAYS,
  resolveNgPayoutFloatHorizonDays,
} from "../../_shared/runtimeConfig.ts";

const MIGRATION =
  "supabase/migrations/20270320001840_issue_1840_ng_payout_float_alerts.sql";
const MATURITY_MIGRATION =
  "supabase/migrations/20270720003645_issue_3645_payment_plus_24h_payouts.sql";
const SWEEP = "supabase/functions/payout-release-sweep/index.ts";
// #3645 2c re-emits the float raise and adds the stale stay-dispute kind, both
// with revision-bearing keys; the guard reads it alongside the #1840 migration.
const FLOAT_FORECAST_MIGRATION =
  "supabase/migrations/20280503003645_issue_3645_float_forecast_alerts.sql";

/** The kind whose payload is a number that moves — the one honoured downstream. */
const REVISION_BEARING_KINDS = [
  "paystack_float_shortfall",
  "stay_dispute_hold_open",
];

const ALL_KINDS = [
  "stripe_attempt_cap",
  "paystack_otp_blocked",
  "paystack_attempt_cap",
  "paystack_fee_unreconciled",
  "paystack_over_cap",
  "paystack_reversal_unreconciled",
  "paystack_balance_blocked",
  "paystack_float_shortfall",
  "waiting_for_bank",
  "stay_dispute_hold_open",
];

/**
 * Slice a SQL idempotency-key expression starting at `at`, following `||`
 * continuation lines so a key split across two lines is not truncated.
 */
function keyExpression(src: string, at: number): string {
  let cursor = at;
  for (;;) {
    const newline = src.indexOf("\n", cursor);
    if (newline < 0) return src.slice(at);
    if (!/^\s*\|\|/.test(src.slice(newline + 1, newline + 40))) {
      return src.slice(at, newline);
    }
    cursor = newline + 1;
  }
}

// ── D1: the scoping must not become a trap for whoever adds the next kind ──

Deno.test("#1840 RETEST the kinds writing a revision-bearing key are EXACTLY the kinds the notifier honours", async () => {
  const migration = (await Deno.readTextFile(MIGRATION)) +
    (await Deno.readTextFile(FLOAT_FORECAST_MIGRATION));
  const sweep = await Deno.readTextFile(SWEEP);

  // Which kinds does the SQL give a key with structure beyond `<kind>:<id>`?
  // Canonical form is exactly one `||`. Anything richer is a key the notifier
  // must be told about, or its payload is deduped away downstream.
  const richKinds = new Set<string>();
  for (const kind of ALL_KINDS) {
    const literal = `'${kind}:'`;
    let from = 0;
    for (;;) {
      const at = migration.indexOf(literal, from);
      if (at < 0) break;
      const expression = keyExpression(migration, at);
      const concatenations = (expression.match(/\|\|/g) ?? []).length;
      if (concatenations > 1) richKinds.add(kind);
      from = at + literal.length;
    }
  }

  // Anti-vacuity: if the parse found nothing rich at all, this whole test is
  // asserting an empty set against an empty set and proves nothing.
  assert(
    richKinds.size > 0,
    "no kind was parsed as writing a revision-bearing key — the parser is broken, so this guard is vacuous",
  );

  // Which kinds does the notifier honour the outbox key for?
  const honoured = new Set(
    [...sweep.matchAll(/alertKind === "([a-z_]+)"/g)].map((m) => m[1]),
  );

  assertEquals(
    [...richKinds].sort(),
    REVISION_BEARING_KINDS.slice().sort(),
    "the SQL now writes a revision-bearing key for a different set of kinds than this guard knows about",
  );
  assertEquals(
    [...honoured].sort(),
    [...richKinds].sort(),
    "DRIFT: the kinds whose outbox key carries a revision are not the kinds the notifier honours — a corrected payload would be deduped away below the outbox, exactly the defect this rework fixed",
  );
});

// ── D2: the fail direction for an unrecognised kind ────────────────────────

Deno.test("#1840 RETEST an unrecognised kind cannot reach the revision branch and falls back to the #1217 key", async () => {
  const sweep = await Deno.readTextFile(SWEEP);
  const at = sweep.indexOf("const idempotencyKey =");
  assert(at >= 0, "the idempotency-key selection disappeared");
  const selection = sweep.slice(at, sweep.indexOf(";", sweep.indexOf("?", at)));

  // The gate is an exact-equality allowlist, not a prefix, a regex or a
  // truthiness check on the passed key — any of which would let an unknown
  // kind through.
  assertStringIncludes(selection, `alertKind === "paystack_float_shortfall"`);
  assertEquals(/alertKind\s*!==/.test(selection), false);
  assertEquals(/startsWith|includes|test\(/.test(selection), false);
  // The fallback is the #1217 form, so an unrecognised kind degrades to the
  // pre-existing behaviour rather than to the caller-supplied key.
  assertStringIncludes(selection, "`${copy.type}:${release.release_id}`");
  // And the key is only honoured when it is a non-empty string, so a NULL
  // outbox key can never produce an empty idempotency key.
  assertStringIncludes(selection, `typeof outboxIdempotencyKey === "string"`);
  assertStringIncludes(selection, "outboxIdempotencyKey.length > 0");
});

// ── D3: the six pre-existing kinds are untouched ───────────────────────────

Deno.test("#1840 RETEST every pre-existing kind keeps the #1217 idempotency key byte-for-byte", async () => {
  const sweep = await Deno.readTextFile(SWEEP);
  const at = sweep.indexOf("const idempotencyKey =");
  const selection = sweep.slice(at, sweep.indexOf(";", sweep.indexOf("?", at)));
  for (const kind of ALL_KINDS) {
    if (REVISION_BEARING_KINDS.includes(kind)) continue;
    assertEquals(
      selection.includes(`"${kind}"`),
      false,
      `${kind} is named in the key selection — a live money alert's delivery key must not change`,
    );
  }
  // The dispatch call passes the computed key and nothing else.
  assertStringIncludes(sweep, "idempotencyKey,");
  assertEquals(
    sweep.includes("idempotencyKey: `${copy.type}:${release.release_id}`"),
    false,
    "the old unconditional key is still being passed somewhere",
  );
});

// ── Harness ────────────────────────────────────────────────────────────────

type Scenario = {
  execute?: boolean;
  blockedPartnerAttributions?: number;
  stripeClaimFails?: boolean;
  drainFails?: boolean;
  feeReadFails?: boolean;
  obligationKobo?: number;
  balanceKobo?: number;
  balanceThrows?: boolean;
  bundle?: string;
  claimedAlerts?: Array<Record<string, unknown>>;
};

function harness(scenario: Scenario) {
  const rpcOrder: string[] = [];
  const tableReads: string[] = [];
  const releasedFilters: Array<Array<[string, unknown]>> = [];
  const balanceReads: number[] = [];
  const notified: Array<
    { kind: string; key: string | null | undefined; message: string }
  > = [];
  let raiseArgs: Record<string, unknown> | null = null;
  let obligationArgs: Record<string, unknown> | null = null;
  let drained = false;

  const createAdmin = (() => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcOrder.push(name);
      switch (name) {
        case "list_missing_payout_source_fees":
          return scenario.feeReadFails
            ? Promise.resolve({
              data: null,
              error: { message: "fee_read_down", code: "XX000" },
            })
            : Promise.resolve({ data: [], error: null });
        case "run_payout_release_dark_sweep":
          return Promise.resolve({ data: { executed: 0 }, error: null });
        case "claim_payout_release_alerts": {
          if (scenario.drainFails) {
            return Promise.resolve({
              data: null,
              error: { message: "drain_down" },
            });
          }
          if (!drained && scenario.claimedAlerts) {
            drained = true;
            return Promise.resolve({
              data: scenario.claimedAlerts,
              error: null,
            });
          }
          return Promise.resolve({ data: [], error: null });
        }
        case "record_payout_release_alert_delivery":
          return Promise.resolve({ data: "provider_accepted", error: null });
        case "plan_pending_payout_partner_legs":
          return Promise.resolve({
            data: {
              blocked_partner_attributions:
                scenario.blockedPartnerAttributions ?? 0,
            },
            error: null,
          });
        case "claim_stripe_payout_releases":
          return scenario.stripeClaimFails
            ? Promise.resolve({
              data: null,
              error: { message: "stripe_claim_down" },
            })
            : Promise.resolve({ data: [], error: null });
        case "claim_paystack_payout_releases":
          return Promise.resolve({ data: [], error: null });
        case "paystack_payout_float_obligation":
          obligationArgs = args;
          return Promise.resolve({
            data: {
              horizon_days: args.p_horizon_days,
              release_count: (scenario.obligationKobo ?? 0) > 0 ? 1 : 0,
              obligation_kobo: scenario.obligationKobo ?? 0,
            },
            error: null,
          });
        case "raise_paystack_float_shortfall_alert": {
          raiseArgs = args;
          const shortfall = (scenario.obligationKobo ?? 0) -
            Number(args.p_balance_kobo ?? 0);
          return Promise.resolve({
            data: {
              horizon_days: args.p_horizon_days,
              release_count: 1,
              obligation_kobo: scenario.obligationKobo ?? 0,
              balance_kobo: args.p_balance_kobo,
              shortfall_kobo: Math.max(shortfall, 0),
              alert_revision: 2,
              alert: shortfall > 0 ? "refreshed" : "none",
            },
            error: null,
          });
        }
        // Issue #3645 PR8 (append-only): dark+execute ticks surface waiting-for-bank.
        case "surface_payout_releases_waiting_for_bank":
          return Promise.resolve({ data: [], error: null });
        // Issue #3645 PR10: pause/outcome notice drains (empty in this scenario).
        // Issue #1345: reservation slot-unavailable alert drain (empty).
        case "claim_brand_payout_pause_notices":
        case "claim_brand_payout_outcome_notices":
        case "claim_reservation_slot_unavailable_alerts":
          return Promise.resolve({ data: [], error: null });
        default:
          throw new Error(`unexpected RPC ${name}`);
      }
    },
    from: (table: string) => {
      tableReads.push(table);
      if (table === "brand_payout_releases") {
        const filters: Array<[string, unknown]> = [];
        releasedFilters.push(filters);
        const chain = {
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            return chain;
          },
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
        };
        return { select: () => chain };
      }
      throw new Error(`unexpected table ${table}`);
    },
  })) as never;

  const deps = {
    env: (key: string) => {
      if (key === "SUPABASE_URL") return "https://example.test";
      if (key === "SUPABASE_SERVICE_ROLE_KEY") return "service-secret";
      if (key === "PAYOUT_RELEASE_EXECUTE") {
        return scenario.execute === false ? "false" : "true";
      }
      if (key === "MINGLA_RUNTIME_CONFIG_JSON") return scenario.bundle;
      return undefined;
    },
    createAdmin,
    resolveProviderFee: () => {
      throw new Error("no provider-fee candidates expected");
    },
    notifyAttemptCap: (
      _release: { release_id: string; brand_id: string },
      message: string,
      alertKind?: string,
      outboxIdempotencyKey?: string | null,
    ) => {
      notified.push({
        kind: alertKind ?? "<default>",
        key: outboxIdempotencyKey,
        message,
      });
      return Promise.resolve("provider_accepted" as const);
    },
    createPaystackReleaseClient: () => ({
      getBalance: () => {
        if (scenario.balanceThrows) {
          return Promise.reject(new Error("paystack_balance_unreachable"));
        }
        balanceReads.push(balanceReads.length + 1);
        return Promise.resolve([
          { currency: "NGN", balance: scenario.balanceKobo ?? 0 },
        ]);
      },
      fetchTransfer: () => {
        throw new Error("the forecast must never read a transfer");
      },
      verifyTransferByReference: () => {
        throw new Error("the forecast must never verify a transfer");
      },
      initiateTransfer: () => {
        throw new Error("the forecast must never initiate a transfer");
      },
    }),
  };

  return {
    run: () =>
      handlePayoutReleaseSweep(
        new Request("https://example.test", {
          method: "POST",
          headers: { authorization: "Bearer service-secret" },
        }),
        deps as never,
      ),
    rpcOrder,
    tableReads,
    releasedFilters,
    balanceReads,
    notified,
    raiseArgs: () => raiseArgs,
    obligationArgs: () => obligationArgs,
  };
}

function bundle(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema_version: 1,
    bunny_storage_cap_bytes: 1,
    bunny_traffic_cap_bytes: 1,
    event_cover_video_provider: "bunny",
    google_ads_api_version: "v21",
    meta_api_version: "v23",
    mingla_footer_address: "an address",
    mingla_logo_url: "https://example.test/logo.png",
    termii_base_url: "https://v3.api.termii.com",
    ...extra,
  });
}

// ── D4: the outbox key reaches the notifier ────────────────────────────────

Deno.test("#1840 RETEST the drain's idempotency key is carried through to the notifier for every kind", async () => {
  const claimed = ALL_KINDS.map((kind, index) => ({
    alert_id: `alert-${index}`,
    release_id: `release-${index}`,
    brand_id: `brand-${index}`,
    alert_kind: kind,
    error_message: `message for ${kind}`,
    idempotency_key: kind === "paystack_float_shortfall"
      ? `paystack_float_shortfall:release-${index}:r7`
      : `${kind}:release-${index}`,
    claim_id: `claim-${index}`,
  }));
  const h = harness({ claimedAlerts: claimed, obligationKobo: 0 });
  const response = await h.run();
  assertEquals(response.status, 200);

  assertEquals(
    h.notified.length,
    ALL_KINDS.length,
    "every claimed alert must reach the notifier",
  );
  for (const [index, kind] of ALL_KINDS.entries()) {
    const seen = h.notified.find((n) => n.kind === kind);
    assert(seen, `${kind} never reached the notifier`);
    // The plumbing the SQL half depends on: the drain's own key, unaltered.
    assertEquals(
      seen.key,
      claimed[index].idempotency_key,
      `${kind}: the outbox key was dropped or rewritten between the drain and the notifier`,
    );
  }
  // Anti-vacuity: the revision-bearing key really was one of them, so this is
  // not passing because every key happened to be the canonical form.
  assert(
    h.notified.some((n) => typeof n.key === "string" && n.key.endsWith(":r7")),
    "no revision-bearing key was exercised, so this test proves nothing",
  );
});

// ── D5: C3 at runtime ──────────────────────────────────────────────────────

Deno.test("#1840 RETEST the forecast survives the partner-attribution 409", async () => {
  const h = harness({
    blockedPartnerAttributions: 2,
    obligationKobo: 7_500_000,
    balanceKobo: 500_000,
  });
  const response = await h.run();
  assertEquals(response.status, 409);
  const body = await response.json();
  assertEquals(body.error, "partner_attribution_pending");
  assert(h.rpcOrder.includes("paystack_payout_float_obligation"));
  assertEquals(h.balanceReads.length, 1);
  assertEquals(h.raiseArgs()?.p_balance_kobo, 500_000);
  assertEquals(body.paystackFloatForecast.status, "ok");
  assertEquals(body.paystackFloatForecast.shortfallKobo, 7_000_000);
  assertEquals(body.paystackFloatForecast.alert, "refreshed");
});

Deno.test("#1840 RETEST the forecast survives a Stripe-phase 500", async () => {
  const h = harness({
    stripeClaimFails: true,
    obligationKobo: 7_500_000,
    balanceKobo: 0,
  });
  const response = await h.run();
  // The Stripe phase still answers 500 so the job alerts (#3645 rail isolation
  // keeps the status; only the Paystack phase now runs before it returns).
  assertEquals(response.status, 500);
  assertEquals((await response.json()).error, "stripe_execution_failed");
  // But the alert was already raised and is durable in the outbox — the whole
  // point of moving the forecast upstream. The 500 body does not carry it,
  // which is fine: the artefact lives in the database, not the response.
  const obligationAt = h.rpcOrder.indexOf("paystack_payout_float_obligation");
  const stripeAt = h.rpcOrder.indexOf("claim_stripe_payout_releases");
  assert(obligationAt >= 0, "the forecast must run before the Stripe phase");
  assert(
    obligationAt < stripeAt,
    "the forecast must be upstream of the Stripe phase or a 500 there silences it",
  );
  assertEquals(h.balanceReads.length, 1);
  assertEquals(h.raiseArgs()?.p_balance_kobo, 0);
});

// ── #3645 rail isolation: a Stripe failure no longer stops Paystack ────────

Deno.test("#3645 a Stripe-phase failure still runs the Paystack phase and still answers 500", async () => {
  const h = harness({ stripeClaimFails: true, obligationKobo: 0, balanceKobo: 0 });
  const response = await h.run();
  assertEquals(response.status, 500);
  const body = await response.json();
  assertEquals(body.error, "stripe_execution_failed");
  const stripeAt = h.rpcOrder.indexOf("claim_stripe_payout_releases");
  const paystackAt = h.rpcOrder.indexOf("claim_paystack_payout_releases");
  assert(stripeAt >= 0, "the Stripe phase must have been attempted");
  assert(
    paystackAt > stripeAt,
    "the Paystack phase must run after a failed Stripe phase (2026-10-22 outage)",
  );
  // The response reports what the Paystack phase did (empty claim here; the
  // real-outage tests below prove a claimed release is executed).
  assertEquals(body.paystackExecution.claimed, 0);
  assertEquals(body.paystackFloatForecast.status, "ok");
});

Deno.test("#3645 after a Stripe-phase failure partner release still runs, for Paystack releases only", async () => {
  const failed = harness({ stripeClaimFails: true });
  const failedResponse = await failed.run();
  assertEquals(failedResponse.status, 500);
  const failedBody = await failedResponse.json();
  assertEquals(failedBody.error, "stripe_execution_failed");
  assertEquals(failedBody.partnerRelease.pendingPaystack, 0);
  assertEquals(failed.releasedFilters.length, 1, "partner release must still read released rows");
  assertEquals(failed.releasedFilters[0], [
    ["status", "released"],
    ["provider", "paystack"],
  ]);

  const healthy = harness({});
  const response = await healthy.run();
  assertEquals(response.status, 200);
  assertEquals((await response.json()).ok, true);
  assertEquals(healthy.releasedFilters.length, 1);
  assertEquals(
    healthy.releasedFilters[0],
    [["status", "released"]],
    "a healthy run still releases partners on both rails",
  );
  assert(
    healthy.rpcOrder.indexOf("claim_paystack_payout_releases") >
      healthy.rpcOrder.indexOf("claim_stripe_payout_releases"),
  );
});

// ── D6: where the forecast still cannot run, stated precisely ──────────────

Deno.test("#1840 RETEST the only seams left above the forecast are the DARK gate and the pre-gate database reads", async () => {
  // DARK: upheld deliberately. With releases disabled no organiser can be left
  // unpaid, and running would start live balance calls on a dark rail.
  const dark = harness({ execute: false, obligationKobo: 9_000_000 });
  assertEquals((await dark.run()).status, 200);
  assertEquals(
    dark.rpcOrder.includes("paystack_payout_float_obligation"),
    false,
  );
  assertEquals(dark.balanceReads.length, 0);

  // The fee-candidate read and the alert drain both 500 BEFORE the DARK gate,
  // so the forecast cannot run through them either. Both are
  // "the database is unreachable" / "alerting is already broken" states in
  // which the ledger read would fail anyway. Pinned so the seam is a known,
  // reviewed set rather than an assumption.
  const feeDown = harness({ feeReadFails: true, obligationKobo: 9_000_000 });
  assertEquals((await feeDown.run()).status, 500);
  assertEquals(
    feeDown.rpcOrder.includes("paystack_payout_float_obligation"),
    false,
  );

  const drainDown = harness({ drainFails: true, obligationKobo: 9_000_000 });
  assertEquals((await drainDown.run()).status, 500);
  assertEquals(
    drainDown.rpcOrder.includes("paystack_payout_float_obligation"),
    false,
  );

  // Everything downstream of the gate can no longer silence it.
  const partnerPlanned = harness({
    blockedPartnerAttributions: 1,
    obligationKobo: 9_000_000,
  });
  await partnerPlanned.run();
  assert(
    partnerPlanned.rpcOrder.includes("paystack_payout_float_obligation"),
  );
});

// ── D7: a failure is durable AND machine-readable ──────────────────────────

Deno.test("#1840 RETEST a forecast failure emits a keyable log event, not just a verdict", async () => {
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map((a) => String(a)).join(" "));
  };
  try {
    const h = harness({ obligationKobo: 1_000_000, balanceThrows: true });
    const response = await h.run();
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.paystackFloatForecast.status, "failed");
    assert(body.paystackFloatForecast.reason.length > 0);

    // The log line must be a single parseable JSON object with a stable event
    // name — prose is not keyable by log-based alerting, which is the whole
    // point of the fix.
    const event = errors
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .find((parsed) =>
        parsed?.event === "ng_payout_float_forecast_failed"
      );
    assert(
      event,
      `no keyable failure event was emitted; saw: ${JSON.stringify(errors)}`,
    );
    assertEquals(event.function_name, "payout-release-sweep");
    assert(typeof event.reason === "string" && event.reason.length > 0);
    // The reason is bounded so a provider error body cannot flood the log.
    assert((event.reason as string).length <= 200);
  } finally {
    console.error = original;
  }
});

// ── D8: clamping can never disable the forecast ────────────────────────────

Deno.test("#1840 RETEST no configured value can push the horizon outside a usable window", () => {
  const env = (raw: string) => (name: string) =>
    name === "MINGLA_RUNTIME_CONFIG_JSON" ? raw : undefined;

  const hostile: unknown[] = [
    0,
    -1,
    -2147483648,
    1,
    2,
    2.5,
    "3",
    "",
    null,
    true,
    false,
    [],
    {},
    91,
    365,
    Number.MAX_SAFE_INTEGER,
    1e309,
  ];
  for (const value of hostile) {
    const raw = bundle({ ng_payout_float_horizon_days: value });
    const resolved = resolveNgPayoutFloatHorizonDays(env(raw));
    const effective = resolved ?? NG_PAYOUT_FLOAT_HORIZON_DEFAULT_DAYS;
    assert(
      Number.isSafeInteger(effective),
      `a horizon of ${JSON.stringify(value)} produced a non-integer window: ${effective}`,
    );
    assert(
      effective >= NG_PAYOUT_FLOAT_HORIZON_MIN_DAYS &&
        effective <= NG_PAYOUT_FLOAT_HORIZON_MAX_DAYS,
      `a horizon of ${JSON.stringify(value)} resolved to ${effective}, outside [${NG_PAYOUT_FLOAT_HORIZON_MIN_DAYS},${NG_PAYOUT_FLOAT_HORIZON_MAX_DAYS}] — the forecast window must never be disable-able by configuration`,
    );
  }
  // Every in-range value survives untouched, so the clamp is not just pinning
  // everything to one constant.
  for (let days = NG_PAYOUT_FLOAT_HORIZON_MIN_DAYS; days <= NG_PAYOUT_FLOAT_HORIZON_MAX_DAYS; days++) {
    assertEquals(
      resolveNgPayoutFloatHorizonDays(
        env(bundle({ ng_payout_float_horizon_days: days })),
      ),
      days,
    );
  }
  // #3645 — payment + ~24h maturity ⇒ actionable float floor is 1 day (was 3).
  assertEquals(NG_PAYOUT_FLOAT_HORIZON_MIN_DAYS, 1);
});

Deno.test("#1840 RETEST the SQL clamp mirrors the TypeScript clamp, so neither can drift open", async () => {
  const migration = await Deno.readTextFile(MATURITY_MIGRATION);
  // Both ends must be enforced in the ledger too: the sweep is not the only
  // possible caller of the obligation reader.
  assertStringIncludes(
    migration,
    `greatest(${NG_PAYOUT_FLOAT_HORIZON_MIN_DAYS},least(coalesce(p_horizon_days,${NG_PAYOUT_FLOAT_HORIZON_DEFAULT_DAYS}),${NG_PAYOUT_FLOAT_HORIZON_MAX_DAYS}))`,
  );
});

// ── The self-assert must stay inside the transaction ───────────────────────

Deno.test("#1840 RETEST the migration self-assert is INSIDE the transaction, so a half-shipped pair rolls back", async () => {
  const migration = await Deno.readTextFile(MIGRATION);
  const begin = migration.indexOf("\nBEGIN;");
  const commit = migration.lastIndexOf("\nCOMMIT;");
  assert(begin >= 0 && commit > begin, "the migration transaction disappeared");
  const assertAt = migration.lastIndexOf("DO $$");
  assert(assertAt >= 0, "the self-assert block disappeared");
  assert(
    assertAt < commit,
    "the self-assert is below COMMIT again — it would abort the RUN but not the MIGRATION, leaving the #1217 trap installed",
  );
  // Nothing may RAISE after COMMIT: an abort there cannot roll anything back.
  assertEquals(
    migration.slice(commit).includes("RAISE EXCEPTION"),
    false,
    "a RAISE EXCEPTION sits after COMMIT, where it cannot roll the migration back",
  );
  // Both halves are still asserted.
  const block = migration.slice(assertAt, commit);
  assertStringIncludes(block, "pg_get_functiondef(");
  assertStringIncludes(block, "payout_release_alert_outbox_alert_kind_check");
  for (const kind of ["paystack_balance_blocked", "paystack_float_shortfall"]) {
    assertStringIncludes(block, `'${kind}'`);
  }
});

// ── #3645 rail isolation, real outage shapes ───────────────────────────────
// A claim-RPC error, a missing live key after a non-empty Stripe claim, and a
// failed attempt-cap alert drain all leave Stripe broken; each must still
// execute a claimed Paystack release end to end (transfer initiated, leg
// outcome recorded) and release Paystack partner splits.

type RailMode = "healthy" | "claim_error" | "missing_key" | "alert_drain_error";

function railHarness(mode: RailMode, opts: { paystackClaimFails?: boolean; releasedRows?: Array<{ id: string }>; splitProvider?: string } = {}) {
  const releasedFilters: Array<Array<[string, unknown]>> = [];
  const rpc: Array<{ name: string; args: Record<string, unknown> }> = [];
  const tables: string[] = [];
  const initiated: Array<Record<string, unknown>> = [];
  let legsPlanned = false;
  let alertClaims = 0;
  const createAdmin = (() => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      rpc.push({ name, args });
      const ok = (data: unknown) => Promise.resolve({ data, error: null });
      switch (name) {
        case "list_missing_payout_source_fees": return ok([]);
        case "run_payout_release_dark_sweep": return ok({ executed: 0 });
        case "claim_payout_release_alerts":
          alertClaims++;
          if (mode === "alert_drain_error" && alertClaims === 2) {
            return Promise.resolve({ data: null, error: { message: "drain_down" } });
          }
          return ok([]);
        case "plan_pending_payout_partner_legs": return ok({ blocked_partner_attributions: 0 });
        case "claim_stripe_payout_releases":
          if (mode === "claim_error") return Promise.resolve({ data: null, error: { message: "stripe_claim_down" } });
          if (mode === "missing_key") {
            return ok([{ release_id: "s-1", claim_id: "sc-1", brand_id: "b-us", net_release_cents: 5000, maturity_recredit_cents: 0, stripe_account_id: "acct_x", currency: "usd" }]);
          }
          return ok([]);
        case "claim_paystack_payout_releases":
          if (opts.paystackClaimFails) return Promise.resolve({ data: null, error: { message: "ps_down" } });
          return ok([{ release_id: "p-1", brand_id: "b-ng", recipient_code: "RCP_1", currency: "ngn", net_release_cents: 500_000, maturity_recredit_cents: 0, attempt_count: 0, claim_id: "pc-1" }]);
        case "record_paystack_leg_plan": legsPlanned = true; return ok(null);
        case "authorize_paystack_payout_execution": return ok(true);
        case "record_paystack_transfer_leg_outcome": return ok(null);
        case "reconcile_paystack_transfer_leg_fee": return ok(null);
        case "paystack_payout_float_obligation": return ok({ horizon_days: 7, release_count: 0, obligation_kobo: 0 });
        case "raise_paystack_float_shortfall_alert": return ok({ alert: "none" });
        case "surface_payout_releases_waiting_for_bank":
        case "claim_brand_payout_pause_notices":
        case "claim_brand_payout_outcome_notices":
        case "claim_reservation_slot_unavailable_alerts":
          return ok([]);
        case "release_partner_splits_for_organiser_release":
          return ok([{ id: "split-1", provider: opts.splitProvider ?? "paystack", stripe_application_fee_id: "paystack:ref", order_id: "o-1", brand_id: "b-ng", partner_account_id: "pa-1", partner_share_cents: 5000, transfer_currency: "ngn" }]);
        default: throw new Error(`unexpected RPC ${name}`);
      }
    },
    from: (table: string) => {
      tables.push(table);
      if (table === "brand_payout_releases") {
        const filters: Array<[string, unknown]> = [];
        releasedFilters.push(filters);
        const chain: Record<string, unknown> = {
          eq: (c: string, v: unknown) => { filters.push([c, v]); return chain; },
          order: () => ({ limit: () => Promise.resolve({ data: opts.releasedRows ?? [], error: null }) }),
        };
        return { select: () => chain };
      }
      if (table === "payout_transfer_legs") {
        const chain: Record<string, unknown> = {};
        let kind = "";
        chain.select = () => chain;
        chain.eq = (col: string, val: string) => { if (col === "kind") kind = val; return chain; };
        chain.order = () => Promise.resolve({
          data: kind === "organiser" && legsPlanned
            ? [{ id: "leg-1", chunk_index: 0, principal_cents: 495_000, estimated_fee_cents: 5000, stamp_duty_cents: 0, status: "planned", provider_reference: null, provider_transfer_code: null, attempt_count: 0 }]
            : [],
          error: null,
        });
        // partner ceiling read awaits after .eq("kind","partner")
        chain.then = (res: (v: unknown) => unknown) => res({ data: [], error: null });
        return chain;
      }
      throw new Error(`unexpected table ${table}`);
    },
  })) as never;
  const deps = {
    env: (k: string) => ({ SUPABASE_URL: "https://example.test", SUPABASE_SERVICE_ROLE_KEY: "service-secret", PAYOUT_RELEASE_EXECUTE: "true" } as Record<string, string>)[k],
    createAdmin,
    resolveProviderFee: () => { throw new Error("none expected"); },
    notifyAttemptCap: () => Promise.resolve("provider_accepted" as const),
    createStripeReleaseClient: () => {
      throw new Error("STRIPE_RAK_PAYOUT_RELEASE_LIVE is not set");
    },
    createPaystackReleaseClient: () => ({
      getBalance: () => Promise.resolve([{ currency: "NGN", balance: 100_000_000 }]),
      fetchTransfer: () => { throw new Error("no reconcile expected"); },
      verifyTransferByReference: () => { throw new Error("no reconcile expected"); },
      initiateTransfer: (input: Record<string, unknown>) => {
        initiated.push(input);
        return Promise.resolve({ status: "success", transfer_code: "TRF_1", fee: 5000 });
      },
    }),
  };
  return {
    run: () => handlePayoutReleaseSweep(new Request("https://example.test", { method: "POST", headers: { authorization: "Bearer service-secret" } }), deps as never),
    rpc, tables, initiated, releasedFilters,
  };
}

for (const mode of ["claim_error", "missing_key", "alert_drain_error"] as const) {
  Deno.test(`#3645 a Stripe-phase failure (${mode}) still executes a claimed Paystack release`, async () => {
    const h = railHarness(mode);
    const res = await h.run();
    const body = await res.json();
    assertEquals(res.status, 500);
    assertEquals(body.error, "stripe_execution_failed");
    assertEquals(h.initiated.length, 1, "Paystack initiateTransfer must run once");
    assertEquals(h.initiated[0].recipientCode, "RCP_1");
    const outcome = h.rpc.find((c) => c.name === "record_paystack_transfer_leg_outcome");
    assertEquals(outcome?.args.p_outcome, "succeeded");
    assertEquals(body.paystackExecution.claimed, 1);
    assertEquals(body.paystackExecution.initiated, 1);
    assertEquals(h.releasedFilters[0], [["status", "released"], ["provider", "paystack"]]);
    if (mode === "missing_key") {
      assert(!h.rpc.some((c) => c.name === "record_stripe_payout_execution"), "no Stripe outcome recorded");
    }
  });
}

Deno.test("#3645 a healthy run executes Paystack and reaches partner release on both rails", async () => {
  const h = railHarness("healthy");
  const res = await h.run();
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.ok, true);
  assertEquals(h.initiated.length, 1);
  assertEquals(body.paystackExecution.initiated, 1);
  assert(h.tables.includes("brand_payout_releases"));
});

Deno.test("#3645 after a Stripe failure a released Paystack release still moves its Paystack partner split", async () => {
  const h = railHarness("missing_key", { releasedRows: [{ id: "p-released" }] });
  const res = await h.run();
  const body = await res.json();
  assertEquals(res.status, 500);
  assertEquals(body.error, "stripe_execution_failed");
  assertEquals(body.partnerRelease.pendingPaystack, 1);
  assert(h.rpc.some((c) => c.name === "release_partner_splits_for_organiser_release" && c.args.p_release_id === "p-released"));
});
