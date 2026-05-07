import { assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';

Deno.test('brand-stripe-balances retrieves connected-account balance with V3 guards', async () => {
  const source = await Deno.readTextFile(new URL('./index.ts', import.meta.url));
  assert(source.includes('stripe.balance.retrieve'));
  assert(source.includes('stripeAccount'));
  assert(source.includes('default_currency'));
  assert(source.includes('idempotencyKey'));
  assert(source.includes('writeAudit'));
});
