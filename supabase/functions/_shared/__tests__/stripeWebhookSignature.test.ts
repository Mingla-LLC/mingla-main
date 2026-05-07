import { assertEquals, assertRejects } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { verifyStripeWebhookSignature } from '../stripeWebhookSignature.ts';

function fakeStripe(validSecret: string) {
  return {
    webhooks: {
      constructEventAsync: (_raw: string, _sig: string, secret: string) => {
        if (secret !== validSecret) throw new Error(`bad secret ${secret}`);
        return Promise.resolve({
          id: 'evt_123',
          type: 'account.updated',
          data: { object: { id: 'acct_123' } },
        });
      },
    },
  };
}

Deno.test('webhook signature verification tries connect, platform, then previous', async () => {
  const verified = await verifyStripeWebhookSignature(
    fakeStripe('whsec_platform') as never,
    '{}',
    'sig',
    [
      { name: 'connect', value: 'whsec_connect' },
      { name: 'platform', value: 'whsec_platform' },
      { name: 'previous', value: 'whsec_previous' },
    ],
  );
  assertEquals(verified.secretName, 'platform');
  assertEquals(verified.event.id, 'evt_123');
});

Deno.test('webhook signature verification rejects when all secrets fail', async () => {
  await assertRejects(() =>
    verifyStripeWebhookSignature(
      fakeStripe('whsec_real') as never,
      '{}',
      'sig',
      [{ name: 'connect', value: 'whsec_wrong' }],
    )
  );
});
