import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  deadlineWarningTiers,
  requirementsHasDue,
} from '../stripeKycReminderSchedule.ts';

Deno.test('deadline warning tiers include 7d/3d/1d as deadline approaches', () => {
  const now = Date.parse('2026-05-07T00:00:00Z');
  assertEquals(deadlineWarningTiers(Math.floor((now + 6 * 24 * 60 * 60 * 1000) / 1000), now), [7]);
  assertEquals(deadlineWarningTiers(Math.floor((now + 2 * 24 * 60 * 60 * 1000) / 1000), now), [7, 3]);
  assertEquals(deadlineWarningTiers(Math.floor((now + 12 * 60 * 60 * 1000) / 1000), now), [7, 3, 1]);
});

Deno.test('requirementsHasDue detects currently_due and disabled_reason', () => {
  assertEquals(requirementsHasDue({ currently_due: ['external_account'] }), true);
  assertEquals(requirementsHasDue({ disabled_reason: 'requirements.past_due' }), true);
  assertEquals(requirementsHasDue({ currently_due: [] }), false);
});
