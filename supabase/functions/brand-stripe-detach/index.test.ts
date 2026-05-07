import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';

Deno.test('brand-stripe-detach keeps V3 soft-delete and audit contract', async () => {
  const source = await Deno.readTextFile(new URL('./index.ts', import.meta.url));
  assert(source.includes('stripe.accounts.del'));
  assert(source.includes('idempotencyKey'));
  assert(source.includes('detached_at'));
  assert(source.includes('writeAudit'));
  assert(source.includes('dispatchNotification'));
  assertEquals(source.includes('.delete().eq("brand_id"'), false);
});
