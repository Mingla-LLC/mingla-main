/**
 * Issue #1703 — a venue's number dials from outside its own country.
 * Implementor happy-path suite.
 *
 * Imports the REAL `dialablePhone`. The formats below are not invented: they are
 * the exact shapes production holds, sampled per country before this was
 * written — `(919) 419-9222` (US), `01279 942348` (GB), `0803 482 1689` (NG).
 *
 * The app used to dial `phone.replace(/[^0-9+]/g, '')`, i.e. the local digits,
 * for all 32,332 stored numbers — none of which is international. That url only
 * connects while the caller stands in that country.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const { dialablePhone, supportedDialCountries, PHONE_PLANS } =
  require(resolve(HERE, '../phone.js'));

test('C-1 real production formats become real E.164 numbers', () => {
  const cases = [
    // [stored, country, expected tel, expected display]
    ['(919) 419-9222', 'US', '+19194199222', '+1 (919) 419-9222'],
    ['01279 942348', 'GB', '+441279942348', '+44 1279 942348'],
    ['020 7946 0000', 'GB', '+442079460000', '+44 20 7946 0000'],
    ['0803 482 1689', 'NG', '+2348034821689', '+234 803 482 1689'],
    ['01 42 68 53 00', 'FR', '+33142685300', '+33 1 42 68 53 00'],
  ];
  for (const [raw, cc, tel, display] of cases) {
    const got = dialablePhone(raw, cc);
    assert.ok(got, `C-1: ${raw} (${cc}) produced nothing`);
    assert.equal(got.tel, tel, `C-1: ${raw} (${cc}) dialled ${got.tel}`);
    assert.equal(got.display, display, `C-1: ${raw} (${cc}) displayed ${got.display}`);
    assert.equal(got.international, true, `C-1: ${raw} (${cc}) is not marked international`);
  }
});

test('C-2 the trunk prefix is dropped, and only the trunk prefix', () => {
  // A leading 0 is what a caller dials INSIDE the country and must not appear in
  // an international number. Keeping it produces a number that does not exist.
  assert.equal(dialablePhone('01279 942348', 'GB').tel, '+441279942348');
  assert.equal(dialablePhone('0803 482 1689', 'NG').tel, '+2348034821689');
  // ...and a country with no trunk prefix keeps every digit.
  assert.equal(dialablePhone('919 419 9222', 'US').tel, '+19194199222');
  assert.equal(dialablePhone('912 345 678', 'ES').tel, '+34912345678');
  // A NANP number stored WITH its country code must not get a second one.
  assert.equal(dialablePhone('1 919 419 9222', 'US').tel, '+19194199222');
});

test('C-3 an already-international number is left exactly as it is', () => {
  const got = dialablePhone('+44 20 7946 0000', 'GB');
  assert.equal(got.tel, '+442079460000');
  assert.equal(got.display, '+44 20 7946 0000', 'C-3: an international number was reformatted');
  assert.equal(got.international, true);
  // Even when the country column disagrees with the prefix — the number wins.
  assert.equal(dialablePhone('+2348034821689', 'US').tel, '+2348034821689');
});

test('C-4 no number means NO CONTROL, not a broken one', () => {
  for (const raw of [null, undefined, '', '   ', 42, {}]) {
    assert.equal(dialablePhone(raw, 'US'), null, `C-4: ${JSON.stringify(raw)} produced a control`);
  }
  // Punctuation with no digits is not a number.
  assert.equal(dialablePhone('()- ', 'US'), null);
});

test('C-5 an unresolvable country dials what we have, and SAYS it is not international', () => {
  // The status quo, honestly labelled — correct inside that country, no worse
  // than today anywhere else, and never a guessed prefix.
  for (const cc of [null, undefined, '', 'ZZ', 'USA', 'not-a-country']) {
    const got = dialablePhone('(919) 419-9222', cc);
    assert.ok(got, `C-5: country ${JSON.stringify(cc)} produced nothing`);
    assert.equal(got.tel, '9194199222', `C-5: country ${JSON.stringify(cc)} invented ${got.tel}`);
    assert.equal(got.international, false);
    assert.equal(got.display, '(919) 419-9222', 'C-5: the local display was altered');
  }
});

test('C-6 digits that do not fit the country plan are REFUSED, not padded', () => {
  // A mismatch means either the number or the country is wrong. Manufacturing an
  // E.164 out of it produces a number that dials a stranger.
  for (const [raw, cc] of [['12345', 'GB'], ['1', 'US'], ['9194199222000000', 'US'], ['123', 'NG']]) {
    const got = dialablePhone(raw, cc);
    assert.ok(got, `C-6: ${raw} (${cc}) produced nothing`);
    assert.equal(
      got.international, false,
      `C-6: ${raw} (${cc}) was turned into ${got.tel}, but ${got.tel.length - 1} digits do not fit ${cc}`,
    );
    assert.equal(got.tel.startsWith('+'), false, `C-6: ${raw} (${cc}) got a country code it cannot support`);
  }
});

test('C-7 every country the pool holds has a plan', () => {
  // Probed against production 2026-08-07: place_pool.country_code holds exactly
  // US, GB, FR, DE, BE, NG, ES, CA and PT. A country with places but no plan
  // means its numbers silently stay local forever.
  const inPool = ['US', 'GB', 'FR', 'DE', 'BE', 'NG', 'ES', 'CA', 'PT'];
  const supported = supportedDialCountries();
  const missing = inPool.filter((c) => !supported.includes(c));
  assert.deepEqual(missing, [], `C-7: no dialling plan for ${missing.join(', ')}`);
});

test('C-8 every plan is internally coherent', () => {
  // Vacuity guard on the table itself: a plan with an empty length list accepts
  // nothing and one with a non-numeric dial code produces garbage E.164.
  for (const [cc, plan] of Object.entries(PHONE_PLANS)) {
    assert.match(cc, /^[A-Z]{2}$/, `C-8: "${cc}" is not an ISO alpha-2 code`);
    assert.match(plan.dial, /^[1-9]\d{0,2}$/, `C-8: ${cc} has dial code "${plan.dial}"`);
    assert.ok(Array.isArray(plan.nsnLengths) && plan.nsnLengths.length > 0, `C-8: ${cc} accepts no length`);
    for (const n of plan.nsnLengths) {
      assert.ok(Number.isInteger(n) && n >= 4 && n <= 12, `C-8: ${cc} accepts a ${n}-digit number`);
    }
    assert.ok(plan.trunk === null || /^\d$/.test(plan.trunk), `C-8: ${cc} has trunk "${plan.trunk}"`);
  }
});
