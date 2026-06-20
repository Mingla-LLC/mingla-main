/**
 * META-ORCH-1161 Sub-A (slice "a") — TESTER ADVERSARIAL RETEST (2026-06-20).
 *
 * RETEST of the P2 fix: seller-only categories (payout_paid + every biz_* alert)
 * must NOT leak into the CONSUMER notification-preferences matrix. The prior
 * tester adversarial test (b55a18be7) pre-dated the fix and pinned the FULL
 * 16-row live seed as all-present — it is now (correctly) red because payout_paid
 * is excluded. THIS file is the new fails-on-revert guard for the AUDIENCE filter,
 * attacked on the FULL LIVE SEED (tester-verified via Supabase MCP 2026-06-20,
 * project gqnoajqerqhnvulmnyvv) — a different angle than the implementor's
 * exclusion test (which uses synthetic + 2 buyer cats).
 *
 * Asserts, against the real seed:
 *   1. EXACTLY the consumer categories render (15 of the 16 live rows); the lone
 *      seller row payout_paid (section Payouts) is dropped — by SECTION, not key.
 *   2. NO non-consumer section (Payouts/Sales/anything outside the allowlist)
 *      appears in the built matrix.
 *   3. isConsumerCategory is allowlist-driven: a brand-new HYPOTHETICAL biz alert
 *      in a future business section ("Sales") is excluded with zero code change
 *      (proves data-driven, not a one-key denylist).
 *   4. The previously-passing SMS-gate STILL holds on the surviving consumer rows
 *      (SMS chip present IFF default_channels includes 'sms') — no regression.
 *
 * Runs under Node's built-in test runner (no jest):
 *   node --experimental-strip-types --test \
 *     src/components/profile/__tests__/notificationPrefsMatrix.orch1161.retest.adversarial.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
// prettier-ignore
// @ts-expect-error -- runtime .ts import for `node --experimental-strip-types`
import { buildNotificationMatrix, isConsumerCategory, type NotificationCategoryRow, type NotificationChannel } from '../notificationPrefsMatrix.ts';

/** EXACT live seed (tester-verified via Supabase MCP, 2026-06-20). */
const LIVE_SEED: NotificationCategoryRow[] = [
  { key: 'marketing', section: 'Marketing', is_transactional: false, urgency: 'low', default_channels: ['inapp', 'push', 'email'], active: true },
  { key: 'marketing_blast', section: 'Marketing', is_transactional: false, urgency: 'low', default_channels: ['email', 'sms'], active: true },
  { key: 'payout_paid', section: 'Payouts', is_transactional: true, urgency: 'high', default_channels: ['inapp', 'push', 'sms', 'email'], active: true },
  { key: 'buyer_order_cancelled', section: 'Purchases', is_transactional: true, urgency: 'normal', default_channels: ['inapp', 'push', 'email', 'sms'], active: true },
  { key: 'buyer_purchase_confirmation', section: 'Purchases', is_transactional: true, urgency: 'high', default_channels: ['inapp', 'push', 'email'], active: true },
  { key: 'buyer_refund_issued', section: 'Purchases', is_transactional: true, urgency: 'normal', default_channels: ['inapp', 'push', 'email', 'sms'], active: true },
  { key: 'waitlist_spot_open', section: 'Purchases', is_transactional: true, urgency: 'high', default_channels: ['inapp', 'push', 'email', 'sms'], active: true },
  { key: 'buyer_event_reminder', section: 'Reminders', is_transactional: true, urgency: 'high', default_channels: ['inapp', 'push', 'email', 'sms'], active: true },
  { key: 'buyer_reservation_reminder', section: 'Reminders', is_transactional: true, urgency: 'high', default_channels: ['inapp', 'push', 'email', 'sms'], active: true },
  { key: 'buyer_reservation_cancelled', section: 'Reservations', is_transactional: true, urgency: 'high', default_channels: ['inapp', 'push', 'email', 'sms'], active: true },
  { key: 'buyer_reservation_changed', section: 'Reservations', is_transactional: true, urgency: 'high', default_channels: ['inapp', 'push', 'email', 'sms'], active: true },
  { key: 'buyer_reservation_confirmed', section: 'Reservations', is_transactional: true, urgency: 'high', default_channels: ['inapp', 'push', 'email'], active: true },
  { key: 'collaboration_invites', section: 'Social', is_transactional: true, urgency: 'normal', default_channels: ['inapp', 'push'], active: true },
  { key: 'friend_requests', section: 'Social', is_transactional: true, urgency: 'low', default_channels: ['inapp', 'push'], active: true },
  { key: 'messages', section: 'Social', is_transactional: true, urgency: 'normal', default_channels: ['inapp', 'push'], active: true },
  { key: 'reminders', section: 'Social', is_transactional: true, urgency: 'low', default_channels: ['inapp', 'push'], active: true },
];

const CONSUMER_SECTIONS = new Set(['Purchases', 'Reservations', 'Reminders', 'Marketing', 'Social']);
const SELLER_KEYS = ['payout_paid'];

function allRows(seed: NotificationCategoryRow[]) {
  return buildNotificationMatrix(seed, []).flatMap((s) => s.rows);
}

test('RETEST P2: only consumer categories survive — seller payout_paid is dropped (by section)', () => {
  const rows = allRows(LIVE_SEED);
  const consumerCount = LIVE_SEED.filter((c) => CONSUMER_SECTIONS.has(c.section)).length;
  assert.equal(rows.length, consumerCount, 'matrix row count equals the consumer-section count');
  assert.equal(rows.length, 15, '15 of the 16 live rows are consumer (1 seller dropped)');
  for (const sellerKey of SELLER_KEYS) {
    assert.equal(rows.find((r) => r.key === sellerKey), undefined, `${sellerKey} must be absent from the consumer matrix`);
  }
});

test('RETEST P2: NO non-consumer section ever appears in the built matrix', () => {
  const sections = buildNotificationMatrix(LIVE_SEED, []).map((s) => s.section);
  for (const s of sections) {
    assert.ok(CONSUMER_SECTIONS.has(s), `section "${s}" must be in the consumer allowlist`);
  }
  assert.equal(sections.includes('Payouts'), false, 'no Payouts section');
  assert.equal(sections.includes('Sales'), false, 'no Sales section');
});

test('RETEST P2: a FUTURE biz alert (new Sales row) is auto-excluded — proves allowlist, not denylist', () => {
  const futureBizAlert: NotificationCategoryRow = {
    key: 'biz_low_inventory', section: 'Sales', is_transactional: true, urgency: 'normal',
    default_channels: ['inapp', 'push', 'email'], active: true,
  };
  // The predicate must reject it purely because its section is not in the allowlist.
  assert.equal(isConsumerCategory(futureBizAlert), false, 'future biz section excluded by allowlist');
  const rows = allRows([...LIVE_SEED, futureBizAlert]);
  assert.equal(rows.find((r) => r.key === 'biz_low_inventory'), undefined, 'future biz alert never renders for consumers');
  // and the consumer set is unchanged (still 15).
  assert.equal(rows.length, 15, 'adding a future biz alert does not change the consumer matrix');
});

test('RETEST no-regression: SMS chip still present IFF policy includes sms — on the surviving consumer rows', () => {
  const rows = allRows(LIVE_SEED);
  for (const cat of LIVE_SEED.filter((c) => CONSUMER_SECTIONS.has(c.section))) {
    const row = rows.find((r) => r.key === cat.key)!;
    assert.ok(row, `row present for ${cat.key}`);
    const hasSms = row.channels.some((c: { channel: NotificationChannel }) => c.channel === 'sms');
    assert.equal(hasSms, cat.default_channels.includes('sms'), `${cat.key}: SMS chip gate intact`);
  }
});
