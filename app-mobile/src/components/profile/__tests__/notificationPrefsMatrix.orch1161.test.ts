/**
 * META-ORCH-1161 Sub-A (slice "a") — implementor happy-path regression test.
 *
 * Runs under Node's built-in test runner with type-stripping (this app has no
 * jest — see useLaunchCityGate.test.ts precedent):
 *   node --experimental-strip-types --test \
 *     src/components/profile/__tests__/notificationPrefsMatrix.orch1161.test.ts
 * (wrapper: scripts/ci/orch-1161-notif-prefs-matrix-check.mjs)
 *
 * Targets the dependency-free decision core (notificationPrefsMatrix.ts).
 * Asserts the load-bearing contract:
 *  - a toggle writes the CORRECT notification_channel_prefs upsert row
 *    (enabled true AND enabled false), PK = (user_id, category_key, channel);
 *  - the SMS chip renders ONLY for categories whose default_channels includes
 *    'sms' (closed eligible set, I-PROPOSED-1161-SMS-ONLY-FOR-POLICY-ELIGIBLE);
 *  - effective state = coalesce(pref.enabled, default); locked chips (inapp
 *    always; email on transactional) are always ON and write NO row.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
// Explicit .ts extension required by Node's strip-types runtime (no jest here);
// tsc's allowImportingTsExtensions is off repo-wide, so this one runtime-only
// test import is suppressed (matches useLaunchCityGate.test.ts precedent).
// prettier-ignore
// @ts-expect-error -- runtime .ts import for `node --experimental-strip-types`
import { buildNotificationMatrix, buildChannelPrefUpsert, categorySupportsSms, isConsumerCategory, type NotificationCategoryRow } from '../notificationPrefsMatrix.ts';

const SMS_CAT: NotificationCategoryRow = {
  key: 'buyer_reservation_changed',
  section: 'Reservations',
  is_transactional: true,
  urgency: 'high',
  default_channels: ['inapp', 'push', 'email', 'sms'],
  active: true,
};

const NO_SMS_CAT: NotificationCategoryRow = {
  key: 'buyer_purchase_confirmation',
  section: 'Purchases',
  is_transactional: true,
  urgency: 'high',
  default_channels: ['inapp', 'push', 'email'],
  active: true,
};

const MARKETING_CAT: NotificationCategoryRow = {
  key: 'marketing_blast',
  section: 'Marketing',
  is_transactional: false,
  urgency: 'low',
  default_channels: ['email', 'sms'],
  active: true,
};

// Seller-only category that is LIVE in the seed today (section 'Payouts').
// It must NEVER appear in the consumer matrix (ORCH-1161 slice "a" REWORK P2).
const PAYOUT_PAID_CAT: NotificationCategoryRow = {
  key: 'payout_paid',
  section: 'Payouts',
  is_transactional: true,
  urgency: 'high',
  default_channels: ['inapp', 'push', 'email', 'sms'],
  active: true,
};

// A representative brand alert from the spec's business sections. Same rule:
// excluded from the consumer matrix purely by virtue of its business section.
const BIZ_NEW_SALE_CAT: NotificationCategoryRow = {
  key: 'biz_new_sale',
  section: 'Sales',
  is_transactional: true,
  urgency: 'normal',
  default_channels: ['inapp', 'push', 'email'],
  active: true,
};

test('toggle OFF writes the correct upsert row (enabled=false)', () => {
  const payload = buildChannelPrefUpsert({
    userId: 'user-123',
    categoryKey: 'buyer_reservation_changed',
    channel: 'sms',
    nextEnabled: false,
    locked: false,
  });
  assert.deepEqual(payload, {
    user_id: 'user-123',
    category_key: 'buyer_reservation_changed',
    channel: 'sms',
    enabled: false,
  });
});

test('toggle ON writes the correct upsert row (enabled=true)', () => {
  const payload = buildChannelPrefUpsert({
    userId: 'user-123',
    categoryKey: 'marketing_blast',
    channel: 'sms',
    nextEnabled: true,
    locked: false,
  });
  assert.deepEqual(payload, {
    user_id: 'user-123',
    category_key: 'marketing_blast',
    channel: 'sms',
    enabled: true,
  });
});

test('a locked chip NEVER writes a pref row', () => {
  const payload = buildChannelPrefUpsert({
    userId: 'user-123',
    categoryKey: 'buyer_purchase_confirmation',
    channel: 'inapp',
    nextEnabled: false,
    locked: true,
  });
  assert.equal(payload, null);
});

test('SMS chip renders ONLY for sms-eligible categories', () => {
  assert.equal(categorySupportsSms(SMS_CAT), true);
  assert.equal(categorySupportsSms(NO_SMS_CAT), false);

  const matrix = buildNotificationMatrix([SMS_CAT, NO_SMS_CAT], []);
  const smsRow = matrix
    .flatMap((s) => s.rows)
    .find((r) => r.key === 'buyer_reservation_changed');
  const noSmsRow = matrix
    .flatMap((s) => s.rows)
    .find((r) => r.key === 'buyer_purchase_confirmation');

  assert.ok(smsRow, 'sms category row present');
  assert.ok(noSmsRow, 'no-sms category row present');
  // The eligible category exposes an SMS cell; the ineligible one does NOT.
  assert.equal(
    smsRow!.channels.some((c) => c.channel === 'sms'),
    true,
    'sms-eligible category renders an SMS chip',
  );
  assert.equal(
    noSmsRow!.channels.some((c) => c.channel === 'sms'),
    false,
    'non-eligible category has NO SMS chip',
  );
});

test('effective state = coalesce(pref.enabled, default); transactional default ON', () => {
  // No pref rows → transactional push/sms default ON; email locked ON.
  const fresh = buildNotificationMatrix([SMS_CAT], []);
  const row = fresh[0].rows[0];
  const push = row.channels.find((c) => c.channel === 'push')!;
  const sms = row.channels.find((c) => c.channel === 'sms')!;
  const email = row.channels.find((c) => c.channel === 'email')!;
  const inapp = row.channels.find((c) => c.channel === 'inapp')!;
  assert.equal(push.enabled, true);
  assert.equal(sms.enabled, true);
  assert.equal(email.locked, true, 'email on transactional is locked');
  assert.equal(email.enabled, true);
  assert.equal(inapp.locked, true, 'inapp always locked');

  // An explicit enabled=false pref flips the (non-locked) sms cell OFF.
  const withOff = buildNotificationMatrix(
    [SMS_CAT],
    [{ category_key: 'buyer_reservation_changed', channel: 'sms', enabled: false }],
  );
  const smsOff = withOff[0].rows[0].channels.find((c) => c.channel === 'sms')!;
  assert.equal(smsOff.enabled, false);
});

test('marketing channels default OFF until an enabled=true pref exists', () => {
  const fresh = buildNotificationMatrix([MARKETING_CAT], []);
  const sms = fresh[0].rows[0].channels.find((c) => c.channel === 'sms')!;
  assert.equal(sms.locked, false, 'marketing locks nothing');
  assert.equal(sms.enabled, false, 'marketing default OFF');

  const optedIn = buildNotificationMatrix(
    [MARKETING_CAT],
    [{ category_key: 'marketing_blast', channel: 'sms', enabled: true }],
  );
  const smsOn = optedIn[0].rows[0].channels.find((c) => c.channel === 'sms')!;
  assert.equal(smsOn.enabled, true);
});

test('REWORK P2: seller-only payout_paid is EXCLUDED from the consumer matrix', () => {
  // Predicate: payout_paid / brand alerts are NOT consumer categories.
  assert.equal(isConsumerCategory(PAYOUT_PAID_CAT), false, 'payout_paid is not consumer');
  assert.equal(isConsumerCategory(BIZ_NEW_SALE_CAT), false, 'biz_new_sale is not consumer');
  assert.equal(isConsumerCategory(SMS_CAT), true, 'a buyer reservation cat IS consumer');

  // Build with the seller categories present in the seed alongside buyer cats —
  // exactly the leak scenario. The consumer matrix must drop them entirely.
  const matrix = buildNotificationMatrix(
    [PAYOUT_PAID_CAT, BIZ_NEW_SALE_CAT, SMS_CAT, NO_SMS_CAT, MARKETING_CAT],
    [],
  );
  const allKeys = matrix.flatMap((s) => s.rows.map((r) => r.key));
  const allSections = matrix.map((s) => s.section);

  assert.equal(allKeys.includes('payout_paid'), false, 'payout_paid must NOT render in consumer matrix');
  assert.equal(allKeys.includes('biz_new_sale'), false, 'biz_new_sale must NOT render in consumer matrix');
  assert.equal(allSections.includes('Payouts'), false, 'no Payouts section in consumer matrix');
  assert.equal(allSections.includes('Sales'), false, 'no Sales section in consumer matrix');

  // The genuine consumer categories still render.
  assert.equal(allKeys.includes('buyer_reservation_changed'), true);
  assert.equal(allKeys.includes('buyer_purchase_confirmation'), true);
  assert.equal(allKeys.includes('marketing_blast'), true);
});

test('sections render in consumer order; inactive categories dropped', () => {
  const matrix = buildNotificationMatrix(
    [MARKETING_CAT, SMS_CAT, NO_SMS_CAT, { ...NO_SMS_CAT, key: 'x', active: false }],
    [],
  );
  const order = matrix.map((s) => s.section);
  // Purchases before Reservations before Marketing.
  assert.deepEqual(order, ['Purchases', 'Reservations', 'Marketing']);
  const allKeys = matrix.flatMap((s) => s.rows.map((r) => r.key));
  assert.equal(allKeys.includes('x'), false, 'inactive category dropped');
});
