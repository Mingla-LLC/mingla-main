#!/usr/bin/env node
/**
 * B2a Path C V3 — Stripe Connect multi-country smoke test.
 *
 * Per SPEC §6 + I-PROPOSED-T (country allowlist).
 *
 * Iterates a representative subset of the canonical 34-country list, creates
 * a connected account with V3 controller properties for each, calls
 * accountSessions.create, calls accounts.retrieve to verify, and best-effort
 * deletes the account at the end. Cleanup is mandatory in smoke mode to keep
 * the sandbox clean.
 *
 * Tier 1 (always run): US, GB, DE — most-used markets.
 * Tier 2 (sampled): CA, CH, FR — non-EUR-zone + EUR-zone variety.
 * Tier 3 (probed): NL, IE, SE — coverage of "everything else".
 *
 * Exit codes:
 *   0 — all countries succeeded
 *   1 — at least one country failed
 *   2 — script error (env / SDK)
 *
 * NEVER fall back to silent success. Every step asserts.
 */

import Stripe from "stripe";

const STRIPE_API_VERSION = process.env.STRIPE_API_VERSION ?? "2026-04-30.preview";
const SMOKE_COUNTRIES = ["US", "GB", "DE", "CA", "CH", "FR", "NL", "IE", "SE"];

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY not set");
  process.exit(2);
}
if (!key.startsWith("sk_test_")) {
  console.error(
    "STRIPE_SECRET_KEY must be a TEST key (sk_test_...). Refusing to run against live mode.",
  );
  process.exit(2);
}

const stripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION });

let failed = 0;
const created = [];

function idemKey(country, op) {
  return `smoke-${country}-${op}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function smokeOne(country) {
  console.log(`\n=== ${country} ===`);
  let acct;
  try {
    acct = await stripe.accounts.create(
      {
        country,
        controller: {
          fees: { payer: "application" },
          losses: { payments: "application" },
          stripe_dashboard: { type: "express" },
          requirement_collection: "stripe",
        },
      },
      { idempotencyKey: idemKey(country, "create") },
    );
    console.log(`  accounts.create: ${acct.id}`);
    created.push(acct.id);
  } catch (err) {
    console.error(`  accounts.create FAILED: ${err.message}`);
    failed += 1;
    return;
  }

  try {
    const session = await stripe.accountSessions.create(
      {
        account: acct.id,
        components: {
          account_onboarding: { enabled: true },
        },
      },
      { idempotencyKey: idemKey(country, "session") },
    );
    if (!session.client_secret) throw new Error("no client_secret returned");
    console.log(`  accountSessions.create: client_secret OK`);
  } catch (err) {
    console.error(`  accountSessions.create FAILED: ${err.message}`);
    failed += 1;
  }

  try {
    const fresh = await stripe.accounts.retrieve(acct.id);
    if (fresh.id !== acct.id) throw new Error("retrieve id mismatch");
    if (fresh.country !== country) {
      throw new Error(`country mismatch: expected ${country}, got ${fresh.country}`);
    }
    console.log(`  accounts.retrieve: id + country match`);
  } catch (err) {
    console.error(`  accounts.retrieve FAILED: ${err.message}`);
    failed += 1;
  }
}

async function cleanup() {
  if (process.env.MINGLA_SMOKE_MODE !== "true") {
    console.log("\n(MINGLA_SMOKE_MODE != true — leaving created accounts in place)");
    return;
  }
  console.log("\n=== Cleanup ===");
  for (const id of created) {
    try {
      await stripe.accounts.del(id);
      console.log(`  deleted ${id}`);
    } catch (err) {
      console.warn(`  delete ${id} skipped: ${err.message}`);
    }
  }
}

(async () => {
  try {
    for (const country of SMOKE_COUNTRIES) {
      await smokeOne(country);
    }
  } catch (err) {
    console.error(`SCRIPT ERROR: ${err.message}`);
    await cleanup();
    process.exit(2);
  }
  await cleanup();
  console.log(`\n=== Summary ===`);
  console.log(`Countries tried: ${SMOKE_COUNTRIES.length}`);
  console.log(`Failures: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
})();
