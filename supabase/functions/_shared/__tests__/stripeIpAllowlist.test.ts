import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  extractClientIp,
  isStripeSourceIp,
  verifyStripeSourceIp,
} from '../stripeIpAllowlist.ts';

Deno.test('stripe IP allowlist accepts published Stripe webhook IPs', () => {
  assertEquals(isStripeSourceIp('3.18.12.63'), true);
  assertEquals(isStripeSourceIp('54.187.216.72'), true);
});

Deno.test('stripe IP allowlist rejects non-Stripe, malformed, and missing IPs', () => {
  assertEquals(isStripeSourceIp('8.8.8.8'), false);
  assertEquals(isStripeSourceIp('not-an-ip'), false);
  assertEquals(isStripeSourceIp(null), false);
});

Deno.test('verifyStripeSourceIp reads x-forwarded-for first hop', () => {
  const req = new Request('https://example.test', {
    headers: { 'x-forwarded-for': '3.18.12.63, 10.0.0.1' },
  });
  assertEquals(extractClientIp(req), '3.18.12.63');
  assertEquals(verifyStripeSourceIp(req), true);
});
