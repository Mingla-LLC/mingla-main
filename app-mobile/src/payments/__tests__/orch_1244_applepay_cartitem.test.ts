/**
 * ORCH-1244 [Apple Guideline 4.9] — Apple Pay cartItem builder unit suite.
 *
 * Proves the pure `buildApplePayCartItems` helper (src/payments/applePayCartItem.ts)
 * that supplies `applePay.cartItems` to BOTH native payment call sites
 * (nativeCheckoutFlow.ts checkout + useReserveTable.ts reserve) so the Apple Pay
 * summary line shows the PRODUCT name, never the bare company name "Mingla".
 *
 * Run: node --experimental-strip-types --test \
 *        src/payments/__tests__/orch_1244_applepay_cartitem.test.ts
 *
 * FAILS-ON-REVERT: if the builder is reverted to emit the merchant name, or the
 * empty-title fallback is removed / changed to "Mingla", or the amount stops
 * being a 2-dp major-unit string, one of these assertions fails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApplePayCartItems } from '../applePayCartItem.ts';

test('label = the product title (NOT "Mingla")', () => {
  const items = buildApplePayCartItems('Rooftop Sunset Party', 12345, 'Ticket');
  assert.equal(items.length, 1);
  assert.equal(items[0].label, 'Rooftop Sunset Party');
  assert.notEqual(items[0].label, 'Mingla');
});

test('amount = total in major units, 2dp decimal string', () => {
  assert.equal(buildApplePayCartItems('X', 12345, 'Ticket')[0].amount, '123.45');
  assert.equal(buildApplePayCartItems('X', 100, 'Ticket')[0].amount, '1.00');
  assert.equal(buildApplePayCartItems('X', 0, 'Ticket')[0].amount, '0.00');
  assert.equal(buildApplePayCartItems('X', 999, 'Ticket')[0].amount, '9.99');
});

test('paymentType is the one-off "Immediate" type', () => {
  assert.equal(buildApplePayCartItems('X', 100, 'Ticket')[0].paymentType, 'Immediate');
});

test('empty / whitespace / undefined title → product fallback, NEVER "Mingla"', () => {
  for (const empty of ['', '   ', undefined, null]) {
    const ticket = buildApplePayCartItems(empty as string | null | undefined, 500, 'Ticket');
    assert.equal(ticket[0].label, 'Ticket');
    assert.notEqual(ticket[0].label, 'Mingla');

    const reservation = buildApplePayCartItems(
      empty as string | null | undefined,
      500,
      'Reservation',
    );
    assert.equal(reservation[0].label, 'Reservation');
    assert.notEqual(reservation[0].label, 'Mingla');
  }
});

test('reserve flow uses "Reservation" fallback word', () => {
  assert.equal(buildApplePayCartItems('', 500, 'Reservation')[0].label, 'Reservation');
});

test('checkout default fallback is "Ticket"', () => {
  // The default arg (no third param) is "Ticket" — the checkout flow relies on it.
  assert.equal(buildApplePayCartItems('', 500)[0].label, 'Ticket');
});

test('adversarial: a product literally titled "Mingla" passes through (it is a real product label)', () => {
  // A product whose actual title is "Mingla" is a legitimate label — only the
  // EMPTY-title fallback must avoid the merchant name. Pass-through is correct.
  assert.equal(buildApplePayCartItems('Mingla', 500, 'Ticket')[0].label, 'Mingla');
});

test('title is trimmed (leading/trailing whitespace removed)', () => {
  assert.equal(buildApplePayCartItems('  Padded Title  ', 500, 'Ticket')[0].label, 'Padded Title');
});
