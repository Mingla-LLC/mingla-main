/**
 * #3200 implementor proof — `stripe-kyc-stall-reminder` can finally run.
 *
 * It never had: `cron.job` held no row that called it, its guard required a
 * `CRON_SECRET` that has never been set (so it refused every request), and it
 * slept a random 0–60 minutes before working, which an edge function's ~400s
 * wall clock would have cut short on roughly 89% of runs. Each test below pins
 * one of those three, and each fails if its fix is reverted.
 *
 * PURELY ADDITIVE. `stripe-kyc-stall-reminder/index.test.ts` and
 * `_shared/__tests__/stripeKycReminderSchedule.test.ts` pass unchanged: the
 * notification contract, `calculateCronJitterMs`, the circuit breaker and the
 * audit writes are all still where they were.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isAuthorizedCronCaller } from "../cronCallerAuth.ts";
import {
  calculateCronJitterMs,
  MAX_CRON_JITTER_MS,
} from "../stripeKycReminderSchedule.ts";

// Realistic shape: production service-role keys are long; the vault holds one.
const SERVICE_KEY = "svc_" + "k".repeat(60);
const envWith = (vars: Record<string, string>) => ({
  get: (name: string) => vars[name],
});

Deno.test("#3200 happy: the vault service-role bearer is accepted with CRON_SECRET unset", async () => {
  // Exactly production today: no CRON_SECRET, and every pg_cron job sends
  // `Bearer <service_role_key>` read from the vault. Before #3200 this was 401.
  assert(
    await isAuthorizedCronCaller(
      `Bearer ${SERVICE_KEY}`,
      envWith({ SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY }),
    ),
  );
});

Deno.test("#3200 happy: CRON_SECRET still works as an alternative when it is set", async () => {
  assert(
    await isAuthorizedCronCaller(
      "Bearer cron-" + "c".repeat(40),
      envWith({
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
        CRON_SECRET: "cron-" + "c".repeat(40),
      }),
    ),
  );
});

Deno.test("#3200 happy: the reminder's call site uses the shared caller rule", async () => {
  const source = await Deno.readTextFile(
    new URL("../../stripe-kyc-stall-reminder/index.ts", import.meta.url),
  );
  assert(source.includes("isAuthorizedCronCaller("));
  // The retired guard, verbatim. Its return is the revert this suite exists
  // to catch: it refuses every caller while CRON_SECRET is unset.
  assert(!source.includes("if (!cronSecret || auth !== cronSecret)"));
});

Deno.test("#3200 happy: pre-work jitter always fits inside the edge wall clock", () => {
  const prior = Deno.env.get("DISABLE_CRON_JITTER");
  Deno.env.delete("DISABLE_CRON_JITTER");
  try {
    // ~400s is the wall clock; leave most of it for the actual work.
    assert(MAX_CRON_JITTER_MS <= 60_000);
    for (let i = 0; i < 5_000; i += 1) {
      const ms = calculateCronJitterMs();
      assert(
        ms >= 0 && ms < MAX_CRON_JITTER_MS,
        `jitter ${ms}ms out of bounds`,
      );
    }
  } finally {
    if (prior === undefined) Deno.env.delete("DISABLE_CRON_JITTER");
    else Deno.env.set("DISABLE_CRON_JITTER", prior);
  }
});

Deno.test("#3200 happy: the migration gives the reminder a daily caller with the vault bearer", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "../../../migrations/20270623003200_issue_3200_kyc_stall_reminder_cron.sql",
      import.meta.url,
    ),
  );
  assert(sql.includes("'issue_3200_stripe_kyc_stall_reminder'"));
  assert(sql.includes("'15 10 * * *'"));
  assert(sql.includes("/functions/v1/stripe-kyc-stall-reminder"));
  // The bearer the new guard accepts — not CRON_SECRET, which does not exist.
  assert(sql.includes("WHERE name='service_role_key'"));
  // Long enough to outlast MAX_CRON_JITTER_MS plus the work itself.
  const timeout = Number(/timeout_milliseconds := (\d+)/.exec(sql)?.[1] ?? 0);
  assert(
    timeout > MAX_CRON_JITTER_MS,
    `pg_net timeout ${timeout}ms is shorter than the jitter`,
  );
  assertEquals((sql.match(/cron\.schedule\(/g) ?? []).length, 1);
});
