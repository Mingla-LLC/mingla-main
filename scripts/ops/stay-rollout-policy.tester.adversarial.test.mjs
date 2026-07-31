import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DARK_STAY_FLAGS,
  STAY_FLAG_KEYS,
  validateStayRolloutTransition,
} from "./stay-rollout-policy.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const exact = (...enabled) =>
  Object.fromEntries(
    STAY_FLAG_KEYS.map((key) => [key, enabled.includes(key)]),
  );
const allEvidence = () => ({
  releaseFixtureReady: true,
  notificationDeliveryReady: true,
  stripeUsdReady: true,
  paystackNgnReady: true,
  ngSmsReady: true,
  zeroRefundBacklog: true,
});
const validate = (nextFlags, overrides = {}) =>
  validateStayRolloutTransition({
    currentFlags: overrides.currentFlags ?? DARK_STAY_FLAGS,
    nextFlags,
    evidence: { ...allEvidence(), ...overrides.evidence },
    currentRefundPostingEnabled: overrides.currentRefundPostingEnabled ?? false,
    nextRefundPostingEnabled: overrides.nextRefundPostingEnabled ?? false,
    unresolvedRefundObligations: overrides.unresolvedRefundObligations ?? 0,
  });

test("unknown, missing, and non-boolean flags cannot widen the release", () => {
  const unknown = validate({ ...DARK_STAY_FLAGS, STAY_MAGIC_LAUNCH: true });
  assert.equal(unknown.ok, false);
  assert.match(unknown.errors.join("\n"), /unknown STAY_MAGIC_LAUNCH/);
  const missing = { ...DARK_STAY_FLAGS };
  delete missing.STAY_RESERVE_WRITES;
  assert.match(
    validate(missing).errors.join("\n"),
    /missing STAY_RESERVE_WRITES/,
  );
  assert.match(
    validate({ ...DARK_STAY_FLAGS, STAY_PUBLIC_PAGES: "true" }).errors.join(
      "\n",
    ),
    /must be boolean/,
  );
});

test("a complete Stripe proof cannot authorize the Paystack or NG text lane", () => {
  const paystack = exact(
    "STAY_VENUE_AUTHORING",
    "STAY_PUBLIC_PAGES",
    "STAY_RESERVE_READS",
    "STAY_RESERVE_WRITES",
    "STAY_PAYSTACK_COMMERCE",
    "STAY_NOTIFICATIONS",
  );
  const result = validate(paystack, {
    nextRefundPostingEnabled: true,
    evidence: { paystackNgnReady: false, ngSmsReady: false },
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /NGN\/Paystack/);
  assert.match(result.errors.join("\n"), /Nigeria transactional SMS/);
});

test("a forward jump to all flags still requires each intervening proof", () => {
  const result = validate(exact(...STAY_FLAG_KEYS), {
    nextRefundPostingEnabled: true,
    evidence: {
      releaseFixtureReady: false,
      notificationDeliveryReady: false,
      stripeUsdReady: false,
      paystackNgnReady: false,
      ngSmsReady: false,
      zeroRefundBacklog: false,
    },
  });
  assert.equal(result.ok, false);
  for (
    const token of [
      "fixture",
      "delivery proof",
      "USD/Stripe",
      "NGN/Paystack",
      "Nigeria transactional SMS",
      "zero-backlog",
    ]
  ) {
    assert.ok(result.errors.join("\n").includes(token), `missing ${token}`);
  }
});

test("forward movement cannot land on an invented stage or reuse stale rail proof", () => {
  const invented = exact("STAY_VENUE_AUTHORING", "STAY_NOTIFICATIONS");
  assert.match(
    validate(invented).errors.join("\n"),
    /five approved stages/,
  );

  const stripeLive = exact(
    "STAY_VENUE_AUTHORING",
    "STAY_PUBLIC_PAGES",
    "STAY_RESERVE_READS",
    "STAY_RESERVE_WRITES",
    "STAY_STRIPE_COMMERCE",
    "STAY_NOTIFICATIONS",
  );
  const addPaystack = validate(exact(...STAY_FLAG_KEYS), {
    currentFlags: stripeLive,
    currentRefundPostingEnabled: true,
    nextRefundPostingEnabled: true,
    evidence: { stripeUsdReady: false },
  });
  assert.equal(addPaystack.ok, false);
  assert.match(addPaystack.errors.join("\n"), /USD\/Stripe/);
});

test("rollback may remove writes under bad evidence but cannot turn refunds off", () => {
  const live = exact(...STAY_FLAG_KEYS);
  const stopped = { ...live, STAY_RESERVE_WRITES: false };
  const safe = validate(stopped, {
    currentFlags: live,
    currentRefundPostingEnabled: true,
    nextRefundPostingEnabled: true,
    unresolvedRefundObligations: 9,
    evidence: {
      releaseFixtureReady: false,
      notificationDeliveryReady: false,
      stripeUsdReady: false,
      paystackNgnReady: false,
      ngSmsReady: false,
      zeroRefundBacklog: false,
    },
  });
  assert.equal(safe.ok, true);
  const stranded = validate(stopped, {
    currentFlags: stopped,
    currentRefundPostingEnabled: true,
    nextRefundPostingEnabled: false,
    unresolvedRefundObligations: 9,
  });
  assert.equal(stranded.ok, false);
  assert.match(stranded.errors.join("\n"), /unresolved obligations/);
});

test("the cancellation drain cannot become a general feature-flag bypass", () => {
  const migration = fs.readFileSync(
    path.join(
      root,
      "supabase/migrations/20270207001392_issue_1392_stay_activation_guards.sql",
    ),
    "utf8",
  );
  const helper = migration.match(
    /CREATE OR REPLACE FUNCTION public\.issue_1389_flag_enabled[\s\S]*?\$function\$;/,
  )?.[0];
  assert.ok(helper, "activation migration must own the flag authority");
  assert.match(helper, /p_flag = 'STAY_RESERVE_WRITES'/);
  assert.doesNotMatch(helper, /p_flag\s+(?:LIKE|IN)\b/);
  assert.equal(
    (helper.match(/cancel_existing_obligation/g) ?? []).length,
    1,
    "only one exact cancellation bypass may exist",
  );
});
