import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  getKycRemediationForRequirements,
  mapPayoutFailureCode,
  STRIPE_KYC_FIELD_LABELS,
} from '../stripeKycRemediation.ts';

Deno.test('KYC remediation maps currently_due fields and disabled reason', () => {
  const result = getKycRemediationForRequirements({
    currently_due: ['business_profile.url', 'individual.verification.document'],
    past_due: ['external_account'],
    disabled_reason: 'requirements.past_due',
    current_deadline: 1770000000,
  });
  assertEquals(result.messages.includes('add a business website or profile URL'), true);
  assertEquals(result.messages.includes('upload a representative ID document'), true);
  assertEquals(result.messages.includes('add or re-verify a payout bank account'), true);
  assertEquals(result.disabledReasonMessage?.includes('overdue'), true);
  assertEquals(result.currentDeadline, 1770000000);
});

Deno.test('KYC field map covers 30+ Stripe requirement codes', () => {
  assertEquals(Object.keys(STRIPE_KYC_FIELD_LABELS).length >= 30, true);
});

Deno.test('payout failure code maps to actionable copy with fallback', () => {
  assertEquals(mapPayoutFailureCode('invalid_account_number').includes('invalid'), true);
  assertEquals(mapPayoutFailureCode('brand_new_code').includes('could not complete'), true);
});
