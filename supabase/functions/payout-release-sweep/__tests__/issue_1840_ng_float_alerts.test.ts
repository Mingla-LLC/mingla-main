// Issue #1840 (step 1 of #1845) — implementor happy-path regression guard for
// the Nigerian payout float alerts.
//
// Two deliverables, both observability-only:
//   D1 a blocked_balance park raises a DRAINABLE paystack_balance_blocked alert
//      instead of surfacing nowhere;
//   D2 payout-release-sweep forecasts the NGN obligation maturing inside a
//      configurable horizon (default 7 days) and raises ONE actionable
//      paystack_float_shortfall alert before the shortfall becomes an unpaid
//      organiser.
//
// THE VACUITY GUARD IS THE POINT OF THIS FILE. claim_payout_release_alerts
// filters on a hardcoded alert_kind IN (...) list, so a kind added only to
// payout_release_alert_outbox_alert_kind_check is written, deduped and NEVER
// DELIVERED — verbatim the #1217 defect. A test that merely asserted "an outbox
// row exists" would pass against exactly that bug. Every delivery assertion
// below therefore reads the DRAIN's own IN-list, extracted from the drain
// function body alone, and the SQL sibling
// (supabase/migrations/__tests__/issue_1840_ng_payout_float_alerts.test.sql)
// proves the end-to-end claim against a real PostgreSQL.
//
// Fails-on-revert:
//   * delete either kind from the drain IN-list  → "both new kinds reach the
//     drain" fails (and the migration's own advisory block aborts);
//   * delete the blocked_balance outbox INSERT   → "D1 raises on the park
//     branch" fails;
//   * delete the forecast call site in index.ts  → "forecast runs after the
//     Paystack execution phase" fails;
//   * revert the money-path pin in engine.ts     → "under-ceiling balance still
//     initiates nothing" fails.
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  executePaystackRelease,
  type PaystackOrganiserLeg,
  type PaystackReleaseCandidate,
  type PaystackReleaseDeps,
} from "../engine.ts";
import { handlePayoutReleaseSweep } from "../index.ts";
import {
  NG_PAYOUT_FLOAT_HORIZON_DEFAULT_DAYS,
  NG_PAYOUT_FLOAT_HORIZON_MAX_DAYS,
  NG_PAYOUT_FLOAT_HORIZON_MIN_DAYS,
  parseRuntimeConfig,
  resolveNgPayoutFloatHorizonDays,
  resolveRuntimeConfigValue,
} from "../../_shared/runtimeConfig.ts";

const MIGRATION =
  "supabase/migrations/20270320001840_issue_1840_ng_payout_float_alerts.sql";
const SWEEP = "supabase/functions/payout-release-sweep/index.ts";
const WORKFLOW = ".github/workflows/issue-1840-ng-payout-float-alerts-tests.yml";

const NEW_KINDS = ["paystack_balance_blocked", "paystack_float_shortfall"];
const PRIOR_KINDS = [
  "stripe_attempt_cap",
  "paystack_otp_blocked",
  "paystack_attempt_cap",
  "paystack_fee_unreconciled",
  "paystack_over_cap",
  "paystack_reversal_unreconciled",
];

async function migrationSource(): Promise<string> {
  return await Deno.readTextFile(MIGRATION);
}

/** Slice out exactly one `CREATE OR REPLACE FUNCTION public.<name>` body. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert(start >= 0, `${name} is not defined in the migration`);
  const end = source.indexOf("\n$fn$;", start);
  assert(end > start, `${name} body is not terminated`);
  return source.slice(start, end);
}

/** The drain's own hardcoded alert_kind allowlist — nothing else. */
function drainKindList(source: string): string {
  const body = functionBody(source, "claim_payout_release_alerts");
  const start = body.indexOf("o.alert_kind IN (");
  assert(start >= 0, "the drain no longer filters on an alert_kind IN list");
  const end = body.indexOf(")", start);
  assert(end > start, "the drain alert_kind IN list is not terminated");
  return body.slice(start, end);
}

/** The outbox CHECK constraint list — a DIFFERENT region of the same file. */
function checkKindList(source: string): string {
  const start = source.indexOf("ADD CONSTRAINT payout_release_alert_outbox_alert_kind_check");
  assert(start >= 0, "the outbox CHECK is not re-asserted by the migration");
  const end = source.indexOf("));", start);
  assert(end > start, "the outbox CHECK list is not terminated");
  return source.slice(start, end);
}

// ── D1 + D2: the #1217 trap cannot recur ───────────────────────────────────

Deno.test("#1840 both new alert kinds reach the DRAIN, not just the CHECK (the #1217 trap)", async () => {
  const source = await migrationSource();
  const drain = drainKindList(source);
  const check = checkKindList(source);
  // The vacuity guard: membership is asserted against the drain's own IN-list,
  // sliced out of claim_payout_release_alerts alone. Widening only the CHECK
  // leaves this list untouched and fails here.
  for (const kind of NEW_KINDS) {
    assertStringIncludes(drain, `'${kind}'`);
    assertStringIncludes(check, `'${kind}'`);
  }
  // Append-only: widening must never drop a kind that already delivered.
  for (const kind of PRIOR_KINDS) {
    assertStringIncludes(drain, `'${kind}'`);
    assertStringIncludes(check, `'${kind}'`);
  }
  // Both lists must be the same size, or one half of the pair has drifted.
  const count = (text: string) => (text.match(/'paystack_|'stripe_/g) ?? []).length;
  assertEquals(count(drain), NEW_KINDS.length + PRIOR_KINDS.length);
  assertEquals(count(check), NEW_KINDS.length + PRIOR_KINDS.length);
});

Deno.test("#1840 the migration aborts itself if a kind reaches the CHECK but not the drain", async () => {
  const source = await migrationSource();
  const advisory = source.slice(source.lastIndexOf("DO $$"));
  assertStringIncludes(advisory, "pg_get_functiondef(");
  assertStringIncludes(advisory, "claim_payout_release_alerts");
  assertStringIncludes(advisory, "position(v_kind in v_drain)=0");
  for (const kind of NEW_KINDS) assertStringIncludes(advisory, `'${kind}'`);
});

// ── D1: the backstop ───────────────────────────────────────────────────────

Deno.test("#1840 D1 the blocked_balance park branch raises a deduped outbox row", async () => {
  const source = await migrationSource();
  const body = functionBody(source, "record_paystack_transfer_leg_outcome");
  const branchStart = body.indexOf("IF p_outcome='blocked_balance' THEN");
  assert(branchStart >= 0, "the blocked_balance branch disappeared");
  const branchEnd = body.indexOf("RETURN 'blocked_balance';", branchStart);
  assert(branchEnd > branchStart, "the blocked_balance branch is not terminated");
  const branch = body.slice(branchStart, branchEnd);
  assertStringIncludes(branch, "INSERT INTO public.payout_release_alert_outbox");
  assertStringIncludes(branch, "'paystack_balance_blocked'");
  // Dedupe: a release that blocks on every sweep tick raises ONE alert, using
  // the same release-keyed conflict target as every #1177/#1217 writer.
  assertStringIncludes(branch, "ON CONFLICT (release_id, alert_kind) DO NOTHING");
  // Money-safety: the park branch still touches no leg, no attempt count and no
  // amount — it only sets the release status and now also alerts.
  assertEquals(branch.includes("payout_transfer_legs"), false);
  assertEquals(branch.includes("attempt_count"), false);
  assertEquals(branch.includes("payout_ledger_adjustments"), false);
});

// ── D2: ledger-only obligation ─────────────────────────────────────────────

Deno.test("#1840 D2 the obligation reader is ledger-only (I-1013-LEDGER-ONLY)", async () => {
  const source = await migrationSource();
  const body = functionBody(source, "paystack_payout_float_obligation");
  const signature = body.slice(0, body.indexOf("AS $fn$"));
  // It cannot be handed a balance: there is no balance parameter at all.
  assertEquals(signature.includes("balance"), false);
  assertStringIncludes(signature, "p_horizon_days integer DEFAULT 7");
  assertStringIncludes(signature, "RETURNS jsonb");
  assertStringIncludes(signature, "STABLE");
  // The obligation is read from the payout ledger, never from a provider read.
  assertStringIncludes(body, "public.brand_payout_releases");
  assertStringIncludes(body, "public.payout_transfer_legs");
  assertStringIncludes(body, "public.payout_ledger_adjustments");
  // Already-settled legs are excluded so a matured-and-paid release is never
  // double-counted.
  assertStringIncludes(body, "l.status NOT IN ('succeeded','failed','reversed')");
});

Deno.test("#1840 D2 the balance is a comparison operand only and a shortfall dedupes", async () => {
  const source = await migrationSource();
  const body = functionBody(source, "raise_paystack_float_shortfall_alert");
  assertStringIncludes(body, "p_balance_kobo bigint");
  // The obligation is re-derived from the ledger inside the writer; the balance
  // is never an input to it.
  assertStringIncludes(
    body,
    "public.paystack_payout_float_obligation(p_horizon_days,p_now)",
  );
  assertStringIncludes(body, "v_shortfall := v_obligation - p_balance_kobo");
  assertStringIncludes(body, "IF v_obligation<=0 OR v_anchor_release IS NULL OR v_shortfall<=0 THEN");
  assertStringIncludes(body, "'paystack_float_shortfall'");
  assertStringIncludes(body, "ON CONFLICT (release_id, alert_kind) DO NOTHING");
  // Actionable copy: how much, by when, what the balance is, what to top up.
  assertStringIncludes(body, "of Nigerian payouts mature by");
  assertStringIncludes(body, "top up NGN");
});

// ── Money path: nothing about a release changed ────────────────────────────

Deno.test("#1840 an under-ceiling balance still initiates nothing and parks exactly once", async () => {
  const initiates: string[] = [];
  const outcomes: Array<{ legId: string; outcome: string; error: string | null }> = [];
  const leg: PaystackOrganiserLeg = {
    legId: "leg-1840",
    chunkIndex: 0,
    principalCents: 1_992_500,
    estimatedFeeCents: 2_500,
    stampDutyCents: 5_000,
    status: "planned",
    providerReference: null,
    providerTransferCode: null,
    attemptCount: 0,
  };
  const candidate: PaystackReleaseCandidate = {
    release_id: "release-1840",
    brand_id: "brand-1840",
    recipient_code: "RCP_1840",
    currency: "ngn",
    organiser_legs: [leg],
    partner_ceiling_kobo: 30_000,
  };
  const deps: PaystackReleaseDeps = {
    getBalanceNgnKobo: () => Promise.resolve(1_000),
    fetchTransfer: () => {
      throw new Error("no reconcile expected");
    },
    verifyTransferByReference: () => {
      throw new Error("no verify expected");
    },
    authorize: () => {
      throw new Error("authorize must never run under an insufficient balance");
    },
    initiateTransfer: (input) => {
      initiates.push(input.reference);
      return Promise.resolve({});
    },
    recordLegOutcome: (input) => {
      outcomes.push({
        legId: input.legId,
        outcome: input.outcome,
        error: input.error,
      });
      return Promise.resolve();
    },
    reconcileLegFee: () => Promise.resolve(),
    reverseLeg: () => Promise.resolve(),
  };
  const counts = await executePaystackRelease(candidate, deps);
  assertEquals(initiates, []);
  assertEquals(counts.blockedBalance, 1);
  assertEquals(counts.initiated, 0);
  assertEquals(outcomes, [{
    legId: "leg-1840",
    outcome: "blocked_balance",
    error: "paystack_balance_below_release_ceiling",
  }]);
});

// ── Horizon config: existing bundle, no new secret ─────────────────────────

function runtimeBundle(extra: Record<string, unknown> = {}): string {
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

Deno.test("#1840 the forecast horizon rides the existing runtime-config bundle", () => {
  const bundleEnv = (raw: string | undefined) => (name: string) =>
    name === "MINGLA_RUNTIME_CONFIG_JSON" ? raw : undefined;
  // No bundle at all ⇒ undefined ⇒ the caller applies the 7-day default.
  assertEquals(resolveNgPayoutFloatHorizonDays(bundleEnv(undefined)), undefined);
  assertEquals(NG_PAYOUT_FLOAT_HORIZON_DEFAULT_DAYS, 7);
  // A bundle deployed before this field still parses — every other reader keeps
  // working and the horizon falls back to the default.
  assertEquals(resolveNgPayoutFloatHorizonDays(bundleEnv(runtimeBundle())), undefined);
  // A valid override is authoritative.
  assertEquals(
    resolveNgPayoutFloatHorizonDays(
      bundleEnv(runtimeBundle({ ng_payout_float_horizon_days: 14 })),
    ),
    14,
  );
  // Values that carry no usable intent fall back to the default.
  for (const bad of [7.5, "7", null, true, Number.NaN]) {
    assertEquals(
      resolveNgPayoutFloatHorizonDays(
        bundleEnv(runtimeBundle({ ng_payout_float_horizon_days: bad })),
      ),
      undefined,
      `${JSON.stringify(bad)} should degrade to the default`,
    );
  }
});

// #1840 REWORK — an out-of-range horizon is CLAMPED, never rejected, and the
// floor is a horizon that can actually be acted on.
Deno.test("#1840 an out-of-range horizon clamps into a usable window instead of poisoning the bundle", () => {
  const bundleEnv = (raw: string) => (name: string) =>
    name === "MINGLA_RUNTIME_CONFIG_JSON"
      ? raw
      : name === "MINGLA_LOGO_URL"
      ? "https://legacy.test/legacy-logo.png"
      : undefined;

  // The floor is 3 days, not 1: a Nigerian release matures at event_end + 3
  // days, so a shorter window warns later than the rail itself costs and no
  // bank top-up clears inside it.
  assertEquals(NG_PAYOUT_FLOAT_HORIZON_MIN_DAYS, 3);
  assertEquals(NG_PAYOUT_FLOAT_HORIZON_MAX_DAYS, 90);
  for (const low of [0, 1, 2, -5]) {
    assertEquals(
      resolveNgPayoutFloatHorizonDays(
        bundleEnv(runtimeBundle({ ng_payout_float_horizon_days: low })),
      ),
      NG_PAYOUT_FLOAT_HORIZON_MIN_DAYS,
      `${low} must clamp UP to the floor, never disable the forecast`,
    );
  }
  for (const high of [91, 1000, 999_999]) {
    assertEquals(
      resolveNgPayoutFloatHorizonDays(
        bundleEnv(runtimeBundle({ ng_payout_float_horizon_days: high })),
      ),
      NG_PAYOUT_FLOAT_HORIZON_MAX_DAYS,
    );
  }

  // THE BLAST-RADIUS PROPERTY. parseRuntimeConfig is all-or-nothing, so a
  // strict validator on this field turned a payments tunable into a
  // platform-wide degradation: one bad horizon and mingla_logo_url,
  // termii_base_url, the Bunny caps and every other unrelated field silently
  // fell back to legacy env vars. The whole bundle must now survive any value
  // in this field.
  for (const anything of [0, 91, 7.5, "seven", null, true, { a: 1 }, [1, 2]]) {
    const raw = runtimeBundle({ ng_payout_float_horizon_days: anything });
    assertEquals(
      parseRuntimeConfig(raw).ok,
      true,
      `a horizon of ${JSON.stringify(anything)} must not invalidate the bundle`,
    );
    assertEquals(
      resolveRuntimeConfigValue("mingla_logo_url", "MINGLA_LOGO_URL", bundleEnv(raw)),
      "https://example.test/logo.png",
      "an unrelated reader must still get its bundled value",
    );
  }
});

// ── Sweep wiring: ahead of execution, isolated, ledger-first ──────────────

type SweepCase = {
  obligationKobo: number;
  balanceKobo: number;
  obligationError?: string;
  runtimeBundleJson?: string;
  /** #1840 rework — drive the 409 that used to silence the forecast. */
  blockedPartnerAttributions?: number;
  /** #1840 rework — drive the swallowed-failure path. */
  balanceThrows?: boolean;
};

function sweepHarness(scenario: SweepCase) {
  const rpcOrder: string[] = [];
  const balanceReads: string[] = [];
  let raiseArgs: Record<string, unknown> | null = null;
  const createAdmin = (() => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcOrder.push(name);
      if (name === "list_missing_payout_source_fees") {
        return Promise.resolve({ data: [], error: null });
      }
      if (name === "run_payout_release_dark_sweep") {
        return Promise.resolve({ data: { executed: 0 }, error: null });
      }
      if (name === "claim_payout_release_alerts") {
        return Promise.resolve({ data: [], error: null });
      }
      if (name === "plan_pending_payout_partner_legs") {
        return Promise.resolve({
          data: {
            blocked_partner_attributions:
              scenario.blockedPartnerAttributions ?? 0,
          },
          error: null,
        });
      }
      if (name === "claim_stripe_payout_releases") {
        return Promise.resolve({ data: [], error: null });
      }
      if (name === "claim_paystack_payout_releases") {
        return Promise.resolve({ data: [], error: null });
      }
      if (name === "paystack_payout_float_obligation") {
        if (scenario.obligationError) {
          return Promise.resolve({
            data: null,
            error: { message: scenario.obligationError },
          });
        }
        return Promise.resolve({
          data: {
            horizon_days: args.p_horizon_days,
            release_count: scenario.obligationKobo > 0 ? 2 : 0,
            obligation_kobo: scenario.obligationKobo,
          },
          error: null,
        });
      }
      if (name === "raise_paystack_float_shortfall_alert") {
        raiseArgs = args;
        const shortfall = scenario.obligationKobo -
          Number(args.p_balance_kobo ?? 0);
        return Promise.resolve({
          data: {
            horizon_days: args.p_horizon_days,
            release_count: 2,
            obligation_kobo: scenario.obligationKobo,
            balance_kobo: args.p_balance_kobo,
            shortfall_kobo: Math.max(shortfall, 0),
            alert_revision: shortfall > 0 ? 1 : null,
            alert: shortfall > 0 ? "raised" : "none",
          },
          error: null,
        });
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from: (table: string) => {
      if (table === "brand_payout_releases") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  })) as never;
  const deps = {
    env: (key: string) =>
      key === "SUPABASE_URL"
        ? "https://example.test"
        : key === "SUPABASE_SERVICE_ROLE_KEY"
        ? "service-secret"
        : key === "PAYOUT_RELEASE_EXECUTE"
        ? "true"
        : key === "MINGLA_RUNTIME_CONFIG_JSON"
        ? scenario.runtimeBundleJson
        : undefined,
    createAdmin,
    resolveProviderFee: () => {
      throw new Error("no provider-fee candidates expected");
    },
    createPaystackReleaseClient: () => ({
      getBalance: () => {
        if (scenario.balanceThrows) {
          return Promise.reject(new Error("paystack_balance_unreachable"));
        }
        balanceReads.push("balance");
        return Promise.resolve([
          { currency: "USD", balance: 999_999_999 },
          { currency: "NGN", balance: scenario.balanceKobo },
        ]);
      },
      fetchTransfer: () => {
        throw new Error("no transfer read expected");
      },
      verifyTransferByReference: () => {
        throw new Error("no transfer verify expected");
      },
      initiateTransfer: () => {
        throw new Error("the forecast must never initiate a transfer");
      },
    }),
  };
  const run = () =>
    handlePayoutReleaseSweep(
      new Request("https://example.test", {
        method: "POST",
        headers: { authorization: "Bearer service-secret" },
      }),
      deps as never,
    );
  return {
    run,
    rpcOrder,
    balanceReads,
    raiseArgs: () => raiseArgs,
  };
}

Deno.test("#1840 D2 the forecast runs BEFORE any release execution and alerts on a shortfall", async () => {
  const harness = sweepHarness({ obligationKobo: 1_000_000, balanceKobo: 250_000 });
  const response = await harness.run();
  assertEquals(response.status, 200);
  const body = await response.json();

  // #1840 REWORK — placement inverted on purpose. Behind the release phases the
  // forecast was silenced by the partner-plan 500, the 409
  // partner_attribution_pending and the Stripe-phase 500. It now runs ahead of
  // all of them, so no release-execution outcome can hide an unfunded float.
  const obligationAt = harness.rpcOrder.indexOf("paystack_payout_float_obligation");
  const raiseAt = harness.rpcOrder.indexOf("raise_paystack_float_shortfall_alert");
  const partnerPlanAt = harness.rpcOrder.indexOf("plan_pending_payout_partner_legs");
  const stripeClaimAt = harness.rpcOrder.indexOf("claim_stripe_payout_releases");
  const paystackClaimAt = harness.rpcOrder.indexOf("claim_paystack_payout_releases");
  assert(obligationAt >= 0, "the forecast must run");
  assert(partnerPlanAt > obligationAt, "the forecast must precede partner planning");
  assert(stripeClaimAt > obligationAt, "the forecast must precede Stripe execution");
  assert(paystackClaimAt > obligationAt, "the forecast must precede Paystack execution");
  // Ledger first, provider second — I-1013-LEDGER-ONLY at the call site.
  assert(raiseAt > obligationAt, "the alert must follow the ledger obligation");
  assertEquals(harness.balanceReads.length, 1);

  assertEquals(harness.raiseArgs()?.p_balance_kobo, 250_000);
  assertEquals(harness.raiseArgs()?.p_horizon_days, 7);
  assertEquals(body.paystackFloatForecast, {
    status: "ok",
    horizonDays: 7,
    releaseCount: 2,
    obligationKobo: 1_000_000,
    balanceRead: true,
    shortfallKobo: 750_000,
    alertRevision: 1,
    alert: "raised",
  });
});

Deno.test("#1840 D2 no obligation in the horizon ⇒ no balance read and no alert", async () => {
  const harness = sweepHarness({ obligationKobo: 0, balanceKobo: 250_000 });
  const response = await harness.run();
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(harness.balanceReads, []);
  assertEquals(
    harness.rpcOrder.includes("raise_paystack_float_shortfall_alert"),
    false,
  );
  assertEquals(body.paystackFloatForecast, {
    status: "ok",
    horizonDays: 7,
    releaseCount: 0,
    obligationKobo: 0,
    balanceRead: false,
    shortfallKobo: 0,
    alertRevision: null,
    alert: "none",
  });
});

Deno.test("#1840 D2 a configured horizon is honoured end to end", async () => {
  const harness = sweepHarness({
    obligationKobo: 500_000,
    balanceKobo: 500_000,
    runtimeBundleJson: runtimeBundle({ ng_payout_float_horizon_days: 21 }),
  });
  const response = await harness.run();
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(harness.raiseArgs()?.p_horizon_days, 21);
  assertEquals(body.paystackFloatForecast.horizonDays, 21);
  // Balance covers the obligation ⇒ warned nobody.
  assertEquals(body.paystackFloatForecast.alert, "none");
  assertEquals(body.paystackFloatForecast.shortfallKobo, 0);
});

// #1840 REWORK — a forecast failure must still not break the sweep, but it must
// no longer vanish. The mechanism whose whole job is "never be silent" had a
// silent failure mode of its own: `{}` in the body and one prose console line.
Deno.test("#1840 a forecast failure is isolated from the sweep but never silent", async () => {
  for (
    const scenario of [
      { obligationKobo: 1_000_000, balanceKobo: 1, obligationError: "forecast_rpc_exploded" },
      { obligationKobo: 1_000_000, balanceKobo: 1, balanceThrows: true },
    ]
  ) {
    const harness = sweepHarness(scenario);
    const response = await harness.run();
    // Isolation is preserved: the sweep is unharmed.
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.ok, true);
    assertEquals(body.dark, false);
    // ...and the failure is now a durable, machine-readable verdict rather than
    // an empty object that reads identically to "nothing to report".
    assertEquals(body.paystackFloatForecast.status, "failed");
    assert(
      typeof body.paystackFloatForecast.reason === "string" &&
        body.paystackFloatForecast.reason.length > 0,
      "a failed forecast must say why",
    );
  }
});

// #1840 REWORK — C3: the 409 that used to silence the forecast entirely.
Deno.test("#1840 a partner-attribution 409 no longer silences the float forecast", async () => {
  const harness = sweepHarness({
    obligationKobo: 50_000_000,
    balanceKobo: 0,
    blockedPartnerAttributions: 3,
  });
  const response = await harness.run();
  assertEquals(response.status, 409);
  const body = await response.json();
  assertEquals(body.error, "partner_attribution_pending");
  // The sweep is in trouble, which is exactly when an unfunded float matters
  // most. The obligation was read, the balance was read, and the alert fired.
  assert(harness.rpcOrder.includes("paystack_payout_float_obligation"));
  assertEquals(harness.balanceReads.length, 1);
  assertEquals(harness.raiseArgs()?.p_balance_kobo, 0);
  assertEquals(body.paystackFloatForecast.alert, "raised");
  assertEquals(body.paystackFloatForecast.shortfallKobo, 50_000_000);
});

// ── Wiring guards ──────────────────────────────────────────────────────────

Deno.test("#1840 the forecast is wired ahead of every release-execution step", async () => {
  const sweep = await Deno.readTextFile(SWEEP);
  const forecast = sweep.indexOf("forecastPaystackFloat(admin as never, deps)");
  const darkGate = sweep.indexOf("if (!payoutReleaseExecute) {");
  const partnerPlan = sweep.indexOf('"plan_pending_payout_partner_legs"');
  const stripePhase = sweep.indexOf("await executeClaimedStripeReleases(");
  const paystackPhase = sweep.indexOf(
    "executeClaimedPaystackReleases(admin as never, deps)",
  );
  assert(forecast >= 0, "the forecast call site disappeared");
  assert(darkGate >= 0 && forecast > darkGate, "DARK must still mean DARK");
  assert(forecast < partnerPlan, "the forecast must precede partner planning");
  assert(forecast < stripePhase, "the forecast must precede Stripe execution");
  assert(forecast < paystackPhase, "the forecast must precede Paystack execution");
  // Both new kinds have distinct ops copy, so a float warning never reads as a
  // Stripe attempt-cap failure.
  assertStringIncludes(sweep, "ops.paystack_payout_release_balance_blocked");
  assertStringIncludes(sweep, "ops.paystack_payout_float_shortfall");
});

// #1840 REWORK — C1: the self-assert must be able to roll the migration back.
Deno.test("#1840 the migration self-assert sits INSIDE the transaction", async () => {
  const migration = await Deno.readTextFile(MIGRATION);
  const begin = migration.indexOf("\nBEGIN;");
  const assertBlock = migration.indexOf("DO $$");
  const commit = migration.indexOf("\nCOMMIT;");
  assert(begin >= 0 && assertBlock >= 0 && commit >= 0);
  // After COMMIT it was a separate implicit transaction: it aborted the RUN and
  // not the MIGRATION, so deleting either half of the widening still installed
  // the #1217 trap and only `psql -v ON_ERROR_STOP=1` stood in the way. That
  // flag protects CI, not the Management-API lane production applies through.
  assert(
    assertBlock > begin && assertBlock < commit,
    "the self-assert must be between BEGIN and COMMIT so a failure rolls back",
  );
  assertStringIncludes(migration, "rolling back");
});

// #1840 REWORK — C2: a revised figure must survive the notification layer.
Deno.test("#1840 only the float-shortfall kind carries its outbox idempotency key downstream", async () => {
  const sweep = await Deno.readTextFile(SWEEP);
  // The drain has always RETURNED idempotency_key; it must now be passed on.
  assertStringIncludes(sweep, "alert.idempotency_key,");
  const fnStart = sweep.indexOf("async function notifyAttemptCap(");
  const fnEnd = sweep.indexOf("\nasync function deliverPendingAttemptCapAlerts(");
  assert(fnStart >= 0 && fnEnd > fnStart);
  const fn = sweep.slice(fnStart, fnEnd);
  assertStringIncludes(fn, 'alertKind === "paystack_float_shortfall"');
  // Every other kind keeps the #1217 key byte-for-byte: their payload is a
  // fixed fact, so re-sending would be noise rather than news.
  assertStringIncludes(fn, "`${copy.type}:${release.release_id}`");
  assertStringIncludes(fn, "idempotencyKey,");
});

Deno.test("#1840 both regression suites are registered in a workflow that actually runs them", async () => {
  const workflow = await Deno.readTextFile(WORKFLOW);
  assertStringIncludes(
    workflow,
    "supabase/migrations/__tests__/issue_1840_ng_payout_float_alerts.test.sql",
  );
  assertStringIncludes(
    workflow,
    "supabase/functions/payout-release-sweep/__tests__/issue_1840_ng_float_alerts.test.ts",
  );
  assertEquals(workflow.includes("continue-on-error"), false);
});
