/**
 * META-ORCH-1161 Sub-A (slice "a") — TESTER ADVERSARIAL regression test.
 *
 * Different angle than the implementor's happy-path test (which used 3 synthetic
 * categories). This sweeps the matrix builder against the FULL LIVE
 * notification_categories seed (verified by the tester via Supabase MCP on
 * 2026-06-20, project gqnoajqerqhnvulmnyvv) and asserts, for EVERY live category:
 *
 *   1. The SMS chip is present IFF the category's default_channels includes 'sms'
 *      (closed eligible set — I-PROPOSED-1161-SMS-ONLY-FOR-POLICY-ELIGIBLE).
 *      In particular it is ABSENT on the no-text categories the dispatch named:
 *      buyer_reservation_confirmed, buyer_purchase_confirmation, and all Social.
 *   2. The set of rendered chips for a row equals exactly the category's
 *      supported channels (no channel invented, none dropped).
 *   3. Locked chips (inapp always; email on transactional) NEVER produce an
 *      upsert payload (buildChannelPrefUpsert returns null) — across the whole seed.
 *   4. An inactive category contributes ZERO rows even when it carries an SMS policy.
 *
 * Runs under Node's built-in test runner (no jest):
 *   node --experimental-strip-types --test \
 *     src/components/profile/__tests__/notificationPrefsMatrix.orch1161.adversarial.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
// prettier-ignore
// @ts-expect-error -- runtime .ts import for `node --experimental-strip-types`
import { buildNotificationMatrix, buildChannelPrefUpsert, type NotificationCategoryRow, type NotificationChannel } from '../notificationPrefsMatrix.ts';

/**
 * EXACT live seed (tester-verified via Supabase MCP, 2026-06-20). If the seed
 * changes, update this fixture — the point is to pin the SMS-eligibility policy
 * against ground truth, not a synthetic stand-in.
 */
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

// Categories the dispatch explicitly called out as MUST-NOT show an SMS chip.
const NO_SMS_DISPATCH_KEYS = [
  'buyer_reservation_confirmed',
  'buyer_purchase_confirmation',
  // every Social category:
  'collaboration_invites',
  'friend_requests',
  'messages',
  'reminders',
];

function allRows(seed: NotificationCategoryRow[]) {
  return buildNotificationMatrix(seed, []).flatMap((s) => s.rows);
}

test('ADV: SMS chip present IFF policy includes sms — swept across the FULL live seed', () => {
  const rows = allRows(LIVE_SEED);
  // Every active category appears exactly once.
  assert.equal(rows.length, LIVE_SEED.length, 'every active live category renders one row');

  for (const cat of LIVE_SEED) {
    const row = rows.find((r) => r.key === cat.key);
    assert.ok(row, `row present for ${cat.key}`);
    const hasSmsChip = row!.channels.some((c: { channel: NotificationChannel }) => c.channel === 'sms');
    const policyHasSms = cat.default_channels.includes('sms');
    assert.equal(
      hasSmsChip,
      policyHasSms,
      `${cat.key}: SMS chip presence (${hasSmsChip}) must equal policy default_channels.includes('sms') (${policyHasSms})`,
    );
  }
});

test('ADV: dispatch-named no-text categories have NO SMS chip', () => {
  const rows = allRows(LIVE_SEED);
  for (const key of NO_SMS_DISPATCH_KEYS) {
    const row = rows.find((r) => r.key === key)!;
    assert.ok(row, `row present for ${key}`);
    assert.equal(
      row.channels.some((c: { channel: NotificationChannel }) => c.channel === 'sms'),
      false,
      `${key} must NOT render an SMS chip`,
    );
  }
});

test('ADV: rendered chip set equals exactly the category supported channels (no invented/dropped channel)', () => {
  const rows = allRows(LIVE_SEED);
  const order: NotificationChannel[] = ['inapp', 'push', 'email', 'sms'];
  for (const cat of LIVE_SEED) {
    const row = rows.find((r) => r.key === cat.key)!;
    const rendered = row.channels.map((c: { channel: NotificationChannel }) => c.channel);
    const expected = order.filter((ch) => cat.default_channels.includes(ch));
    assert.deepEqual(rendered, expected, `${cat.key}: chips must equal supported channels in canonical order`);
  }
});

test('ADV: no locked chip in the entire seed ever yields an upsert payload', () => {
  const rows = allRows(LIVE_SEED);
  for (const row of rows) {
    for (const cell of row.channels) {
      if (cell.locked) {
        const payload = buildChannelPrefUpsert({
          userId: 'attacker-or-user',
          categoryKey: row.key,
          channel: cell.channel,
          nextEnabled: false,
          locked: cell.locked,
        });
        assert.equal(payload, null, `locked ${row.key}/${cell.channel} must never write a row`);
      }
    }
  }
});

test('ADV: an inactive sms-policy category contributes ZERO rows', () => {
  const seedWithInactive: NotificationCategoryRow[] = [
    ...LIVE_SEED,
    { key: 'ghost_sms_cat', section: 'Purchases', is_transactional: true, urgency: 'high', default_channels: ['inapp', 'push', 'email', 'sms'], active: false },
  ];
  const keys = allRows(seedWithInactive).map((r) => r.key);
  assert.equal(keys.includes('ghost_sms_cat'), false, 'inactive category dropped despite carrying an SMS policy');
});
