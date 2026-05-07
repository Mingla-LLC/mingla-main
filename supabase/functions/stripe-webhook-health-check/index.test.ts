import { assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';

Deno.test('stripe-webhook-health-check uses 6h silence alert via notify-dispatch and audit', async () => {
  const source = await Deno.readTextFile(new URL('./index.ts', import.meta.url));
  assert(source.includes('6 * 60 * 60 * 1000'));
  assert(source.includes('ops.webhook_silence_alert'));
  assert(source.includes('dispatchNotification'));
  assert(source.includes('ops.webhook_silence_check_fired'));
  assert(source.includes('writeAudit'));
});
