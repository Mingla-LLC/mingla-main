/**
 * META-ORCH-1161 go-live-prep [marketing opt-out model] — implementor Step-0.5
 * happy-path regression for the DEC-191 prefs-UI routing.
 *
 * Run:
 *   node --experimental-strip-types --test \
 *     src/components/profile/__tests__/notificationPrefsMatrix.orch1161.golive.test.ts
 *
 * Asserts the load-bearing go-live contract on the dependency-free core:
 *  - marketing email/sms toggles route to the SUPPRESSION action (single source
 *    of truth = channel_suppressions), NOT a notification_channel_prefs upsert;
 *    OFF → suppress=true, ON → suppress=false.
 *  - every transactional channel + marketing push keep the prefs-upsert path.
 *  - a marketing suppression row (3rd arg) renders the matching marketing chip
 *    OFF; absence → DEC-191 default-ON.
 *  - locked chips resolve to noop.
 *
 * fails-on-revert: delete `isMarketingSuppressibleChannel`'s marketing branch (or
 * the resolveToggleAction suppression case) → marketing toggles fall back to the
 * prefs path and `kind === 'marketing_suppression'` assertions fail.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
// prettier-ignore
// @ts-expect-error -- runtime .ts import for `node --experimental-strip-types`
import { buildNotificationMatrix, resolveToggleAction, isMarketingSuppressibleChannel, type NotificationCategoryRow } from '../notificationPrefsMatrix.ts';

const MARKETING: NotificationCategoryRow = {
  key: 'marketing_blast',
  section: 'Marketing',
  is_transactional: false,
  urgency: 'low',
  default_channels: ['inapp', 'push', 'email', 'sms'],
  active: true,
};
const TRANSACTIONAL: NotificationCategoryRow = {
  key: 'buyer_reservation_changed',
  section: 'Reservations',
  is_transactional: true,
  urgency: 'high',
  default_channels: ['inapp', 'push', 'email', 'sms'],
  active: true,
};

test('marketing email/sms toggle OFF routes to a suppression write (suppress=true)', () => {
  const off = resolveToggleAction({
    userId: 'u1',
    categoryKey: 'marketing_blast',
    channel: 'sms',
    isTransactional: false,
    nextEnabled: false,
    locked: false,
  });
  assert.equal(off.kind, 'marketing_suppression');
  if (off.kind === 'marketing_suppression') {
    assert.equal(off.channel, 'sms');
    assert.equal(off.suppress, true, 'chip OFF → suppress');
  }

  const on = resolveToggleAction({
    userId: 'u1',
    categoryKey: 'marketing_blast',
    channel: 'email',
    isTransactional: false,
    nextEnabled: true,
    locked: false,
  });
  assert.equal(on.kind, 'marketing_suppression');
  if (on.kind === 'marketing_suppression') {
    assert.equal(on.suppress, false, 'chip ON → un-suppress');
  }
});

test('transactional channels + marketing push keep the prefs-upsert path', () => {
  const txn = resolveToggleAction({
    userId: 'u1',
    categoryKey: 'buyer_reservation_changed',
    channel: 'sms',
    isTransactional: true,
    nextEnabled: false,
    locked: false,
  });
  assert.equal(txn.kind, 'channel_pref_upsert');

  const marketingPush = resolveToggleAction({
    userId: 'u1',
    categoryKey: 'marketing_blast',
    channel: 'push',
    isTransactional: false,
    nextEnabled: false,
    locked: false,
  });
  assert.equal(marketingPush.kind, 'channel_pref_upsert', 'marketing push is NOT suppressible');

  // The predicate itself.
  assert.equal(isMarketingSuppressibleChannel('sms', false), true);
  assert.equal(isMarketingSuppressibleChannel('email', false), true);
  assert.equal(isMarketingSuppressibleChannel('push', false), false);
  assert.equal(isMarketingSuppressibleChannel('sms', true), false, 'transactional sms is not a marketing suppression');
});

test('a locked chip resolves to noop (no write)', () => {
  const locked = resolveToggleAction({
    userId: 'u1',
    categoryKey: 'buyer_reservation_changed',
    channel: 'inapp',
    isTransactional: true,
    nextEnabled: false,
    locked: true,
  });
  assert.equal(locked.kind, 'noop');
});

test('matrix: marketing chips default ON; suppression flips the matching channel OFF', () => {
  const fresh = buildNotificationMatrix([MARKETING], []);
  const row = fresh[0].rows[0];
  assert.equal(row.channels.find((c: any) => c.channel === 'email')!.enabled, true);
  assert.equal(row.channels.find((c: any) => c.channel === 'sms')!.enabled, true);

  const suppressed = buildNotificationMatrix([MARKETING], [], [{ channel: 'email' }]);
  const srow = suppressed[0].rows[0];
  assert.equal(srow.channels.find((c: any) => c.channel === 'email')!.enabled, false, 'suppressed email → OFF');
  assert.equal(srow.channels.find((c: any) => c.channel === 'sms')!.enabled, true, 'sms unaffected');
});

test('transactional cells are NOT affected by a marketing suppression', () => {
  const m = buildNotificationMatrix([TRANSACTIONAL], [], [{ channel: 'sms' }]);
  const row = m[0].rows[0];
  // transactional sms stays ON (default-on); the marketing suppression is scoped out.
  assert.equal(row.channels.find((c: any) => c.channel === 'sms')!.enabled, true);
});
