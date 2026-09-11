import { assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';

// #3200 — `stripe-webhook-health-check` is RETIRED. This file used to assert the
// function's source contained its 6h silence alert; it now guards that the
// function stays retired and that its job still has an owner.
//
// Why it was retired rather than scheduled: ORCH-1213 moved payment-webhook
// freshness into `api-health-probe` (hourly, pg_cron jobid 30) and ruled that
// "in a low/zero-traffic env webhook silence carries NO actionable signal …
// silence NEVER drives failedTick/alerting", while a genuine Stripe API/auth
// outage still pages through the synthetic probeStripe. This function alerted on
// exactly the silence ORCH-1213 said must not alert. It had never run — no caller
// in `cron.job`, and a guard that refused every request because CRON_SECRET was
// never set — so retiring it changes no behaviour. Scheduling it would have
// alerted every 6 hours from the first tick (no Stripe webhook since 2026-08-26),
// and its only recipient, ops@mingla.app, is not a Mingla domain: mingla.app is
// parked (ns1/ns2.lander.d.parity.domains) with no MX record.

Deno.test('#3200 stripe-webhook-health-check stays retired: no deployable entrypoint', async () => {
  let exists = true;
  try {
    await Deno.stat(new URL('./index.ts', import.meta.url));
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) exists = false;
    else throw err;
  }
  assert(
    !exists,
    'stripe-webhook-health-check/index.ts must not return: api-health-probe owns Stripe webhook freshness (ORCH-1213)',
  );
});

Deno.test('#3200 the retired job still has an owner: api-health-probe records Stripe webhook freshness', async () => {
  const probe = await Deno.readTextFile(
    new URL('../api-health-probe/index.ts', import.meta.url),
  );
  assert(
    probe.includes('webhookFreshness("stripe", "payment_webhook_events"'),
    'api-health-probe must keep recording Stripe webhook freshness, or retiring stripe-webhook-health-check left the job unowned',
  );
});
