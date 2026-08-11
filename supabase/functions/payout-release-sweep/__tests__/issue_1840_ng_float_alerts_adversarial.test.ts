// Issue #1840 — INDEPENDENT ADVERSARIAL sweep guard (append-only, tester).
//
// Deliberately a DIFFERENT angle from
// supabase/functions/payout-release-sweep/__tests__/issue_1840_ng_float_alerts.test.ts,
// which proves the happy path and reads the migration source for structure.
// This file drives handlePayoutReleaseSweep at RUNTIME and attacks the ways
// the forecast can be silenced, mis-fed, or degraded without anyone noticing —
// because these two alerts are the only thing between a matured Nigerian
// payout and an organiser who is never paid, and there is no live data to
// lean on.
//
// What is attacked here:
//   B1  the forecast must never run while the rail is DARK — no obligation
//       RPC, no Paystack balance read, no alert.
//   B2  a FAILED Paystack execution phase must not also blind the forecast:
//       that is precisely the state in which a float warning matters most.
//   B3  the NGN balance must be selected by currency, not by position, and a
//       response with NO NGN row must fail CLOSED (treated as zero, alert
//       raised) rather than open.
//   B4  a balance-read failure is swallowed: pinned so the silence is a known,
//       reviewed property rather than a surprise. Reported as a finding.
//   B5  an out-of-range or wrong-typed configured horizon must degrade to the
//       7-day default — never to 0, NaN or undefined, any of which would send
//       a garbage window to the ledger.
//   B6  BLAST RADIUS: the horizon rides a strict, all-or-nothing shared
//       bundle, so a bad horizon value invalidates the WHOLE bundle for every
//       unrelated reader. Pinned so the cost of that choice is visible.
//   B7  every alert kind the drain is allowed to deliver must have dedicated
//       ops copy — a kind added to the CHECK and the drain but not to the copy
//       switch would be delivered silently mislabelled as a Stripe failure.
//   B8  CI wiring that the jobs actually depend on: the migration-apply step
//       must run under ON_ERROR_STOP, or the migration's own self-abort
//       advisory is a no-op and the #1217 trap re-opens.
//   B9  an earlier early-return in the sweep silences the forecast entirely.
//       Pinned and reported: a partner-attribution backlog (409) short-circuits
//       before the Paystack phase, so the float is never forecast in exactly
//       the sweep that is already unhealthy.
//
// Fails-on-revert (verified by real line deletions, not comment-outs):
//   * delete the forecast call site in index.ts        -> B2, B3, B5 fail;
//   * move the forecast above the DARK early return    -> B1 fails;
//   * take the first balance row instead of the NGN one-> B3 fails;
//   * drop the `?? NG_PAYOUT_FLOAT_HORIZON_DEFAULT_DAYS` fallback -> B5 fails;
//   * remove either new case from payoutReleaseAlertCopy -> B7 fails;
//   * remove either kind from the drain IN-list        -> B7 fails.
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handlePayoutReleaseSweep } from "../index.ts";
import {
  parseRuntimeConfig,
  resolveRuntimeConfigValue,
} from "../../_shared/runtimeConfig.ts";

const MIGRATION =
  "supabase/migrations/20270320001840_issue_1840_ng_payout_float_alerts.sql";
const SWEEP = "supabase/functions/payout-release-sweep/index.ts";
const WORKFLOW = ".github/workflows/issue-1840-ng-payout-float-alerts-tests.yml";

type Scenario = {
  execute?: boolean;
  blockedPartnerAttributions?: number;
  obligationKobo?: number;
  balanceRows?: Array<{ currency: string; balance: number }>;
  balanceThrows?: boolean;
  paystackClaimThrows?: boolean;
  bundle?: string;
  alertVerdict?: string;
};

/**
 * A sweep harness written from the dependency contract rather than adapted
 * from the implementor's, so a shared mistake in one cannot hide in the other.
 * Every provider entry point that must NOT fire under a forecast throws.
 */
function harness(scenario: Scenario) {
  const rpcOrder: string[] = [];
  const balanceReads: number[] = [];
  let raiseArgs: Record<string, unknown> | null = null;
  let obligationArgs: Record<string, unknown> | null = null;

  const createAdmin = (() => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcOrder.push(name);
      switch (name) {
        case "list_missing_payout_source_fees":
          return Promise.resolve({ data: [], error: null });
        case "run_payout_release_dark_sweep":
          return Promise.resolve({ data: { executed: 0 }, error: null });
        case "claim_payout_release_alerts":
          return Promise.resolve({ data: [], error: null });
        case "plan_pending_payout_partner_legs":
          return Promise.resolve({
            data: {
              blocked_partner_attributions:
                scenario.blockedPartnerAttributions ?? 0,
            },
            error: null,
          });
        case "claim_stripe_payout_releases":
          return Promise.resolve({ data: [], error: null });
        case "claim_paystack_payout_releases":
          if (scenario.paystackClaimThrows) {
            return Promise.resolve({
              data: null,
              error: { message: "paystack_claim_exploded" },
            });
          }
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
          const balance = Number(args.p_balance_kobo ?? 0);
          const shortfall = (scenario.obligationKobo ?? 0) - balance;
          return Promise.resolve({
            data: {
              horizon_days: args.p_horizon_days,
              release_count: 1,
              obligation_kobo: scenario.obligationKobo ?? 0,
              balance_kobo: args.p_balance_kobo,
              shortfall_kobo: Math.max(shortfall, 0),
              alert: scenario.alertVerdict ??
                (shortfall > 0 ? "raised" : "none"),
            },
            error: null,
          });
        }
        default:
          throw new Error(`unexpected RPC ${name}`);
      }
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
    createPaystackReleaseClient: () => ({
      getBalance: () => {
        if (scenario.balanceThrows) {
          return Promise.reject(new Error("paystack_balance_unreachable"));
        }
        balanceReads.push(balanceReads.length + 1);
        return Promise.resolve(
          scenario.balanceRows ?? [{ currency: "NGN", balance: 0 }],
        );
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
    balanceReads,
    raiseArgs: () => raiseArgs,
    obligationArgs: () => obligationArgs,
  };
}

/** A complete, currently-valid runtime-config bundle. */
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

// ── B1: DARK means DARK ────────────────────────────────────────────────────

Deno.test("#1840 ADV the forecast never runs, and never reads a balance, while the rail is DARK", async () => {
  const h = harness({ execute: false, obligationKobo: 5_000_000 });
  const response = await h.run();
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.dark, true);
  // No new provider call and no new RPC appear while execution is off.
  assertEquals(h.balanceReads.length, 0);
  assertEquals(h.rpcOrder.includes("paystack_payout_float_obligation"), false);
  assertEquals(
    h.rpcOrder.includes("raise_paystack_float_shortfall_alert"),
    false,
  );
  // The dark response shape is unchanged by #1840.
  assertEquals("paystackFloatForecast" in body, false);
});

// ── B2: an unhealthy Paystack phase must not blind the forecast ────────────

Deno.test("#1840 ADV a FAILED Paystack execution phase still leaves the float forecast running", async () => {
  const h = harness({ paystackClaimThrows: true, obligationKobo: 4_000_000 });
  const response = await h.run();
  assertEquals(response.status, 200);
  const body = await response.json();
  // The execution phase blew up and was swallowed per #1177...
  assertEquals(body.paystackExecution, {});
  // ...but the forecast — the warning that matters most in exactly this
  // state — still ran and still alerted.
  const obligationAt = h.rpcOrder.indexOf("paystack_payout_float_obligation");
  const claimAt = h.rpcOrder.indexOf("claim_paystack_payout_releases");
  assert(claimAt >= 0, "the Paystack claim must still have been attempted");
  assert(obligationAt > claimAt, "the forecast must follow the Paystack phase");
  assertEquals(body.paystackFloatForecast.alert, "raised");
  assertEquals(body.paystackFloatForecast.balanceRead, true);
});

// ── B3: the NGN balance is chosen by currency and missing means zero ───────

Deno.test("#1840 ADV the NGN balance is selected by currency, not by position", async () => {
  const h = harness({
    obligationKobo: 1_000_000,
    // NGN is deliberately neither first nor last, and the decoys are large
    // enough that picking the wrong row would silently cover the obligation.
    balanceRows: [
      { currency: "USD", balance: 900_000_000 },
      { currency: "GHS", balance: 800_000_000 },
      { currency: "NGN", balance: 250_000 },
      { currency: "ZAR", balance: 700_000_000 },
    ],
  });
  const response = await h.run();
  const body = await response.json();
  assertEquals(h.raiseArgs()?.p_balance_kobo, 250_000);
  assertEquals(body.paystackFloatForecast.shortfallKobo, 750_000);
  assertEquals(body.paystackFloatForecast.alert, "raised");
});

Deno.test("#1840 ADV a balance response with NO NGN row fails CLOSED (zero, alert raised)", async () => {
  const h = harness({
    obligationKobo: 1_000_000,
    balanceRows: [{ currency: "USD", balance: 900_000_000 }],
  });
  const response = await h.run();
  const body = await response.json();
  // Zero, not "assume covered": a missing NGN row must produce the loudest
  // possible reading, never a silent all-clear.
  assertEquals(h.raiseArgs()?.p_balance_kobo, 0);
  assertEquals(body.paystackFloatForecast.shortfallKobo, 1_000_000);
  assertEquals(body.paystackFloatForecast.alert, "raised");
});

// ── B4: the swallowed-failure property, pinned ─────────────────────────────

Deno.test("#1840 ADV a balance-read failure is swallowed silently (pinned known gap)", async () => {
  const h = harness({ obligationKobo: 1_000_000, balanceThrows: true });
  const response = await h.run();
  assertEquals(response.status, 200);
  const body = await response.json();
  // The sweep is unharmed, which is the design intent...
  assertEquals(body.ok, true);
  assertEquals(body.dark, false);
  // ...but NO alert of any kind is raised, and the response carries no signal
  // that the forecast failed. The only trace is a console line. Pinned here so
  // that if a future change adds a durable signal, this test fires and the
  // improvement is deliberate rather than accidental.
  assertEquals(body.paystackFloatForecast, {});
  assertEquals(
    h.rpcOrder.includes("raise_paystack_float_shortfall_alert"),
    false,
  );
});

// ── B5: a bad horizon degrades to the default, never to a garbage window ───

Deno.test("#1840 ADV an invalid configured horizon degrades to 7 days, never to 0/NaN/undefined", async () => {
  for (
    const bad of [0, -1, 91, 7.5, "14", null, true] as const
  ) {
    const h = harness({
      obligationKobo: 1_000,
      bundle: bundle({ ng_payout_float_horizon_days: bad }),
    });
    await h.run();
    const sent = h.obligationArgs()?.p_horizon_days;
    assertEquals(
      sent,
      7,
      `a horizon of ${JSON.stringify(bad)} reached the ledger as ${
        JSON.stringify(sent)
      } instead of the 7-day default`,
    );
    assertEquals(h.raiseArgs()?.p_horizon_days, 7);
  }
  // A valid override is honoured, so the fallback above is not masking a
  // hard-coded 7.
  const good = harness({
    obligationKobo: 1_000,
    bundle: bundle({ ng_payout_float_horizon_days: 30 }),
  });
  await good.run();
  assertEquals(good.obligationArgs()?.p_horizon_days, 30);
  assertEquals(good.raiseArgs()?.p_horizon_days, 30);
  // A missing bundle also lands on the default rather than undefined.
  const none = harness({ obligationKobo: 1_000 });
  await none.run();
  assertEquals(none.obligationArgs()?.p_horizon_days, 7);
});

Deno.test("#1840 ADV the shortest legal horizon is still a real horizon, and both ends are reachable", () => {
  // 1 day is legal and gives barely any notice; 90 is the ceiling. Both are
  // accepted, so an operator can narrow the warning window to under 24h with a
  // value the validator considers perfectly valid. Pinned because that is an
  // operational hazard, not a code defect.
  for (const days of [1, 2, 7, 30, 89, 90]) {
    const parsed = parseRuntimeConfig(
      bundle({ ng_payout_float_horizon_days: days }),
    );
    assertEquals(parsed.ok, true, `${days} days should be accepted`);
  }
  for (const days of [0, -1, 91, 1000]) {
    const parsed = parseRuntimeConfig(
      bundle({ ng_payout_float_horizon_days: days }),
    );
    assertEquals(parsed.ok, false, `${days} days must be rejected`);
  }
});

// ── B6: blast radius of a strict field on an all-or-nothing shared bundle ──

Deno.test("#1840 ADV a bad horizon invalidates the WHOLE shared bundle for every unrelated reader", () => {
  const getEnv = (raw: string) => (name: string) =>
    name === "MINGLA_RUNTIME_CONFIG_JSON"
      ? raw
      : name === "MINGLA_LOGO_URL"
      ? "https://legacy.test/legacy-logo.png"
      : name === "TERMII_BASE_URL"
      ? "https://v3.api.termii.com"
      : undefined;

  // Healthy bundle: unrelated fields come from the bundle.
  const healthy = getEnv(bundle({ ng_payout_float_horizon_days: 14 }));
  assertEquals(
    resolveRuntimeConfigValue("mingla_logo_url", "MINGLA_LOGO_URL", healthy),
    "https://example.test/logo.png",
  );

  // One out-of-range horizon and parseRuntimeConfig is all-or-nothing, so
  // mingla_logo_url — which has nothing to do with Nigerian payouts — silently
  // falls back to its legacy env var. That is the documented hazard already
  // called out in runtimeConfig.ts for event_cover_video_provider; #1840 adds
  // a new way to trip it. Pinned so it is a known, reviewed cost.
  const poisoned = getEnv(bundle({ ng_payout_float_horizon_days: 0 }));
  assertEquals(
    resolveRuntimeConfigValue("mingla_logo_url", "MINGLA_LOGO_URL", poisoned),
    "https://legacy.test/legacy-logo.png",
  );
  assertEquals(
    parseRuntimeConfig(bundle({ ng_payout_float_horizon_days: 0 })).ok,
    false,
  );
});

// ── B7: every drainable kind must have dedicated ops copy ──────────────────

Deno.test("#1840 ADV every kind the drain may deliver has dedicated ops copy (no silent Stripe mislabel)", async () => {
  const migration = await Deno.readTextFile(MIGRATION);
  const sweep = await Deno.readTextFile(SWEEP);

  // Pull the drain's own allowlist out of claim_payout_release_alerts alone.
  const fnStart = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.claim_payout_release_alerts(",
  );
  assert(fnStart >= 0, "the drain is not defined in the migration");
  const fnEnd = migration.indexOf("\n$fn$;", fnStart);
  const drainBody = migration.slice(fnStart, fnEnd);
  const listStart = drainBody.indexOf("o.alert_kind IN (");
  assert(listStart >= 0, "the drain no longer filters on an alert_kind IN list");
  const listEnd = drainBody.indexOf(")", listStart);
  const drainList = drainBody.slice(listStart, listEnd);
  const kinds = [...drainList.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

  assert(
    kinds.length >= 8,
    `expected at least the 8 known kinds in the drain, found ${kinds.length}`,
  );
  assert(kinds.includes("paystack_balance_blocked"));
  assert(kinds.includes("paystack_float_shortfall"));

  // Every one of them must have a dedicated `case "<kind>":` in the copy
  // switch. A kind added to the CHECK and the drain but not here would be
  // delivered under the default branch — i.e. an unfunded Nigerian float would
  // page ops as "Stripe organiser payout needs manual review". That is the
  // same class of silent-mislabel bug as #1217, one layer up.
  for (const kind of kinds) {
    if (kind === "stripe_attempt_cap") continue; // the default branch by design
    assertStringIncludes(sweep, `case "${kind}":`);
  }
  // And the two new kinds map to distinct, non-default notification types.
  assertStringIncludes(sweep, `"ops.paystack_payout_release_balance_blocked"`);
  assertStringIncludes(sweep, `"ops.paystack_payout_float_shortfall"`);
  const defaultType = "ops.stripe_payout_release_attempt_cap";
  const balanceCase = sweep.slice(
    sweep.indexOf(`case "paystack_balance_blocked":`),
    sweep.indexOf(`case "paystack_float_shortfall":`),
  );
  assertEquals(balanceCase.includes(defaultType), false);
});

// ── B8: CI wiring the guarantees actually depend on ────────────────────────

Deno.test("#1840 ADV the workflow runs both SQL suites under ON_ERROR_STOP and registers the adversarial files", async () => {
  const workflow = await Deno.readTextFile(WORKFLOW);
  // Without ON_ERROR_STOP the migration's own advisory RAISE would print and
  // the step would still pass — the #1217 trap would re-open silently.
  assertStringIncludes(workflow, "ON_ERROR_STOP=1");
  // The jobs run EXPLICIT file lists; an unregistered file runs nowhere.
  for (
    const file of [
      "supabase/migrations/__tests__/issue_1840_ng_payout_float_alerts.test.sql",
      "supabase/migrations/__tests__/issue_1840_ng_float_alerts_adversarial.test.sql",
      "supabase/functions/payout-release-sweep/__tests__/issue_1840_ng_float_alerts.test.ts",
      "supabase/functions/payout-release-sweep/__tests__/issue_1840_ng_float_alerts_adversarial.test.ts",
    ]
  ) {
    assertStringIncludes(workflow, file);
  }
  assertEquals(workflow.includes("continue-on-error"), false);
  // The migration-apply step must feed EVERY migration, so the #1840 file is
  // exercised at its real position in the chain rather than in isolation.
  assertStringIncludes(workflow, "supabase/migrations/*.sql");
});

// ── B9: an earlier early-return silences the forecast entirely ─────────────

Deno.test("#1840 ADV a partner-attribution backlog short-circuits the sweep and silences the float forecast (pinned known gap)", async () => {
  const h = harness({
    blockedPartnerAttributions: 3,
    obligationKobo: 50_000_000,
  });
  const response = await h.run();
  // Pre-existing #1174 behaviour: the sweep 409s before the Stripe and
  // Paystack phases. #1840 placed the forecast after those phases, so it
  // inherits every earlier early-return.
  assertEquals(response.status, 409);
  const body = await response.json();
  assertEquals(body.error, "partner_attribution_pending");
  // The float is NOT forecast in this state, and no alert is raised, even
  // though a large obligation is maturing. Pinned so this is a known,
  // reviewed limitation rather than a surprise on the first real payout.
  assertEquals(h.rpcOrder.includes("paystack_payout_float_obligation"), false);
  assertEquals(h.balanceReads.length, 0);
});

// ── B10: an unrecognised verdict from the alert RPC degrades to "none" ─────

Deno.test("#1840 ADV an unrecognised alert verdict is reported as none, never invented", async () => {
  const h = harness({
    obligationKobo: 1_000_000,
    balanceRows: [{ currency: "NGN", balance: 1 }],
    alertVerdict: "something_unexpected",
  });
  const response = await h.run();
  const body = await response.json();
  assertEquals(body.paystackFloatForecast.alert, "none");
  // The numeric truth still comes through, so the report is not silently blank.
  assertEquals(body.paystackFloatForecast.obligationKobo, 1_000_000);
  assertEquals(body.paystackFloatForecast.shortfallKobo, 999_999);
});
