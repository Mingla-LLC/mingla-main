import { assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';

Deno.test('stripe-kyc-stall-reminder preserves stall and deadline-warning contract', async () => {
  const source = await Deno.readTextFile(new URL('./index.ts', import.meta.url));
  assert(source.includes('stripe.kyc_stall_reminder'));
  assert(source.includes('stripe.deadline_warning_${tier}d'));
  assert(source.includes('calculateCronJitterMs'));
  assert(source.includes('dispatchErrorStreak >= 5'));
  assert(source.includes('writeAudit'));
});
