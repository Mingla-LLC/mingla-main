import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DARK_STAY_FLAGS,
  STAY_FLAG_KEYS,
  stayStage,
  validateStayRolloutTransition,
} from "./stay-rollout-policy.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const flags = (...enabled) =>
  Object.fromEntries(
    STAY_FLAG_KEYS.map((key) => [key, enabled.includes(key)]),
  );
const evidence = (overrides = {}) => ({
  releaseFixtureReady: true,
  notificationDeliveryReady: true,
  stripeUsdReady: true,
  paystackNgnReady: true,
  ngSmsReady: true,
  zeroRefundBacklog: true,
  ...overrides,
});
const check = (currentFlags, nextFlags, overrides = {}) =>
  validateStayRolloutTransition({
    currentFlags,
    nextFlags,
    evidence: evidence(overrides.evidence),
    currentRefundPostingEnabled: overrides.currentRefundPostingEnabled ?? false,
    nextRefundPostingEnabled: overrides.nextRefundPostingEnabled ?? false,
    unresolvedRefundObligations: overrides.unresolvedRefundObligations ?? 0,
  });

const authoring = flags("STAY_VENUE_AUTHORING");
const publicReads = flags(
  "STAY_VENUE_AUTHORING",
  "STAY_PUBLIC_PAGES",
  "STAY_RESERVE_READS",
);
const notifications = flags(
  "STAY_VENUE_AUTHORING",
  "STAY_PUBLIC_PAGES",
  "STAY_RESERVE_READS",
  "STAY_NOTIFICATIONS",
);
const stripe = flags(
  "STAY_VENUE_AUTHORING",
  "STAY_PUBLIC_PAGES",
  "STAY_RESERVE_READS",
  "STAY_RESERVE_WRITES",
  "STAY_STRIPE_COMMERCE",
  "STAY_NOTIFICATIONS",
);
const all = flags(...STAY_FLAG_KEYS);

test("the five binding rollout stages are exact and ordered", () => {
  assert.equal(stayStage(DARK_STAY_FLAGS), "S0_DARK");
  assert.equal(stayStage(authoring), "S1_AUTHORING");
  assert.equal(stayStage(publicReads), "S2_PUBLIC_READS");
  assert.equal(stayStage(notifications), "S3_NOTIFICATIONS");
  assert.equal(stayStage(stripe), "S4_STRIPE_WRITES");
  assert.equal(stayStage(all), "S5_ALL_RAILS");
  assert.equal(check(DARK_STAY_FLAGS, authoring).ok, true);
  assert.equal(check(authoring, publicReads).ok, true);
  assert.equal(check(publicReads, notifications).ok, true);
  assert.equal(
    check(notifications, stripe, {
      currentRefundPostingEnabled: false,
      nextRefundPostingEnabled: true,
    }).ok,
    true,
  );
  assert.equal(
    check(stripe, all, {
      currentRefundPostingEnabled: true,
      nextRefundPostingEnabled: true,
    }).ok,
    true,
  );
});

test("paid writes fail closed without notification, provider, fixture, or refund truth", () => {
  const railLess = { ...stripe, STAY_STRIPE_COMMERCE: false };
  assert.match(
    check(notifications, railLess).errors.join("\n"),
    /commerce rail/,
  );
  assert.match(
    check(notifications, stripe, {
      nextRefundPostingEnabled: false,
    }).errors.join("\n"),
    /source-refund posting/,
  );
  assert.match(
    check(notifications, stripe, {
      nextRefundPostingEnabled: true,
      evidence: { releaseFixtureReady: false },
    }).errors.join("\n"),
    /release fixture/,
  );
  const noNotifications = { ...stripe, STAY_NOTIFICATIONS: false };
  assert.match(
    check(notifications, noNotifications, {
      currentRefundPostingEnabled: true,
      nextRefundPostingEnabled: true,
    }).errors.join("\n"),
    /STAY_NOTIFICATIONS/,
  );
});

test("forward rail proof is independent and market exact", () => {
  const paystackOnly = { ...all, STAY_STRIPE_COMMERCE: false };
  assert.match(
    check(notifications, paystackOnly, {
      nextRefundPostingEnabled: true,
      evidence: { paystackNgnReady: false },
    }).errors.join("\n"),
    /NGN\/Paystack/,
  );
  assert.match(
    check(notifications, paystackOnly, {
      nextRefundPostingEnabled: true,
      evidence: { ngSmsReady: false },
    }).errors.join("\n"),
    /Nigeria transactional SMS/,
  );
});

test("rollback stops writes first and never strands accepted refunds", () => {
  const writesStopped = { ...all, STAY_RESERVE_WRITES: false };
  assert.equal(
    check(all, writesStopped, {
      currentRefundPostingEnabled: true,
      nextRefundPostingEnabled: true,
      unresolvedRefundObligations: 3,
    }).ok,
    true,
  );
  const unsafeKill = check(writesStopped, writesStopped, {
    currentRefundPostingEnabled: true,
    nextRefundPostingEnabled: false,
    unresolvedRefundObligations: 3,
  });
  assert.equal(unsafeKill.ok, false);
  assert.match(unsafeKill.errors.join("\n"), /unresolved obligations/);
});

test("the repository owns exactly seven default-dark Stay flags and every release gate", () => {
  const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
  const schema = read(
    "supabase/migrations/20270131013812_issue_1389_stay_commerce_schema.sql",
  );
  const declared = [...schema.matchAll(/\('([A-Z_]+)', false,/g)].map((match) =>
    match[1]
  );
  assert.deepEqual(declared, STAY_FLAG_KEYS);
  const source = [
    read("mingla-business/app/venue/create.tsx"),
    read(
      "supabase/migrations/20270131013813_issue_1389_stay_payment_management.sql",
    ),
    read(
      "supabase/migrations/20270131013816_issue_1389_stay_notifications_and_sweep.sql",
    ),
    read("supabase/migrations/20270131013820_issue_1390_stay_guest_reads.sql"),
    read("supabase/migrations/20270205001423_issue_1423_stay_discovery.sql"),
    read(
      "supabase/migrations/20270206001431_issue_1431_stay_ads_attribution.sql",
    ),
    read(
      "supabase/migrations/20270207001392_issue_1392_stay_activation_guards.sql",
    ),
  ].join("\n");
  for (const key of STAY_FLAG_KEYS) {
    assert.ok(source.includes(key), `missing gate consumer ${key}`);
  }
  const activationMigration = read(
    "supabase/migrations/20270207001392_issue_1392_stay_activation_guards.sql",
  );
  assert.match(
    activationMigration,
    /IF v_action = 'quote' THEN[\s\S]*?STAY_RESERVE_READS[\s\S]*?issue_1388_quote_stay_cart/,
    "STAY_RESERVE_READS must fail closed before quote creation or replay",
  );
  assert.match(
    activationMigration,
    /ELSIF v_action = 'create_group' THEN[\s\S]*?STAY_RESERVE_WRITES[\s\S]*?issue_1388_create_stay_group/,
    "STAY_RESERVE_WRITES must fail closed before group creation",
  );
  assert.match(
    activationMigration,
    /issue_1431_attach_stay_attribution/,
    "guarded group creation must preserve Stay ad attribution",
  );
  assert.ok(
    read("supabase/functions/_shared/sourceRefundControlPlane.ts").includes(
      "source_refunds_post_disabled",
    ),
  );
});
