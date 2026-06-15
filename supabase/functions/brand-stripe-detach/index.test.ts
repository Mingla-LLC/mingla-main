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

// ORCH-1140: every 200 body MUST carry detached_at (client guard) +
// stripe_delete_status (honest Stripe outcome). Do not remove.
Deno.test('brand-stripe-detach success 200 body carries detached_at + stripe_delete_status', async () => {
  const source = await Deno.readTextFile(new URL('./index.ts', import.meta.url));

  // Isolate the success return body (status: "detached") and assert the
  // client-required fields are present inside it.
  const successIdx = source.indexOf('status: "detached"');
  assert(successIdx !== -1, 'success return (status: "detached") not found');
  const successBlock = source.slice(successIdx, successIdx + 200);
  assert(
    successBlock.includes('detached_at:'),
    'success 200 body must include detached_at (else the client false-fails a completed detach)',
  );
  assert(
    successBlock.includes('stripe_delete_status:'),
    'success 200 body must include stripe_delete_status (honest Stripe outcome)',
  );
});

Deno.test('brand-stripe-detach not_connected 200 body carries detached_at', async () => {
  const source = await Deno.readTextFile(new URL('./index.ts', import.meta.url));

  const notConnectedIdx = source.indexOf('status: "not_connected"');
  assert(notConnectedIdx !== -1, 'not_connected return not found');
  const notConnectedBlock = source.slice(notConnectedIdx, notConnectedIdx + 200);
  assert(
    notConnectedBlock.includes('detached_at:'),
    'not_connected 200 body must include detached_at',
  );
  assert(
    notConnectedBlock.includes('stripe_delete_status:'),
    'not_connected 200 body must include stripe_delete_status',
  );
});
