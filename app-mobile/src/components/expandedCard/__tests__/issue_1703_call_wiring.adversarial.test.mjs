/**
 * Issue #1703 — ADVERSARIAL suite. A different angle from the phone-helper tests.
 *
 * `packages/card-identity/__tests__/issue_1703_dialable_phone.test.mjs` proves
 * the FUNCTION is right. That is worth nothing if the number never reaches it.
 *
 * The number's journey is: `place_pool` -> a serving RPC -> `discover-cards` ->
 * `deckService` -> the ONE card mapper -> the sheet -> the row and the button.
 * It has been broken at the FIRST hop for the whole life of the field — the RPCs
 * never selected the column, exactly as `utc_offset_minutes` was never selected
 * (deckService.ts's own comment records that discovery). So this file walks the
 * chain and asserts each hop, plus the two rules Seth stated:
 *
 *   "If there is number, show the button, if not dont show the button at all."
 *   "tapping the button takes the user to their phone dialer."
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

function strip(src) {
  let out = ''; let i = 0;
  while (i < src.length) {
    const c = src[i]; const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1; i += 2; continue; }
    if (c === '{' && d === '/' && src[i + 2] === '*') { i += 3; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/' && src[i + 2] === '}')) i += 1; i += 3; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += src[i]; i += 1;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') { out += src[i]; i += 1; } out += src[i]; i += 1; }
      out += src[i]; i += 1; continue;
    }
    out += c; i += 1;
  }
  return out;
}

const EDGE = strip(read('supabase/functions/discover-cards/index.ts'));
const DECK_SVC = strip(read('app-mobile/src/services/deckService.ts'));
const MAPPER = strip(read('app-mobile/src/components/utils/savedCardToExpandedCardData.ts'));
const DETAILS = strip(read('app-mobile/src/components/expandedCard/PracticalDetailsSection.tsx'));
const ACTIONS = strip(read('app-mobile/src/components/expandedCard/ActionButtons.tsx'));
const SHEET = strip(read('app-mobile/src/components/ExpandedCardModal.tsx'));

test('R-0 the stripper strips, and the needles are real', () => {
  assert.ok(EDGE.length < read('supabase/functions/discover-cards/index.ts').length);
  assert.ok(DETAILS.includes('dialablePhone'), 'R-0 (vacuity): the helper name is wrong');
});

test('R-1 hop 1 — the edge function actually fetches the columns', () => {
  // THE HOP THAT WAS BROKEN. The three serving RPCs do not return
  // national_phone_number, country_code or utc_offset_minutes, so the mapper's
  // `row.utc_offset_minutes ?? null` has always resolved to null in production.
  assert.match(EDGE, /enrichRowsWithPlaceFields/, 'R-1: nothing fetches the missing per-place columns');
  const fn = /async function enrichRowsWithPlaceFields[\s\S]*?\n\}/.exec(EDGE);
  assert.ok(fn, 'R-1: the enrichment function is gone');
  for (const col of ['utc_offset_minutes', 'national_phone_number', 'country_code']) {
    assert.match(fn[0], new RegExp(col), `R-1: the lookup does not select ${col}`);
  }
  assert.match(fn[0], /\.from\('place_pool'\)/, 'R-1: the lookup does not read place_pool');
  assert.match(fn[0], /\.in\('id',/, 'R-1: the lookup is not a keyed batch — it may be per-row');

  // It must be called from EVERY RPC fan-out, or one deck path silently keeps
  // the old nulls. Two call sites: the intersection (collab) and issue_1384.
  const calls = [...EDGE.matchAll(/await Promise\.all\(rpcResults\.map\(\(\{ res \}\) => enrichRowsWithPlaceFields/g)];
  assert.equal(calls.length, 2, `R-1: ${calls.length} of the 2 RPC fan-outs are enriched`);
});

test('R-1b the enrichment cannot take the deck down', () => {
  // A deck that fails to load because a phone number could not be fetched would
  // be a worse bug than the one being fixed.
  const fn = /async function enrichRowsWithPlaceFields[\s\S]*?\n\}/.exec(EDGE)[0];
  assert.match(fn, /try \{/, 'R-1b: the lookup is not guarded');
  assert.match(fn, /catch/, 'R-1b: the lookup has no catch');
  assert.match(fn, /if \(error \|\| !Array\.isArray\(data\)\) return;/, 'R-1b: an RPC error is not tolerated');
});

test('R-2 hops 2 and 3 — the client mappers carry both fields', () => {
  assert.match(EDGE, /phone: row\.national_phone_number/, 'R-2: the edge card shape drops the phone');
  assert.match(EDGE, /countryCode: row\.country_code/, 'R-2: the edge card shape drops the country');
  assert.match(DECK_SVC, /countryCode: card\.countryCode/, 'R-2: deckService drops the country');
  assert.match(DECK_SVC, /phone: card\.phone/, 'R-2: deckService drops the phone');
  // And the ONE mapper (#1669) — otherwise Likes, Calendar and chat lose it.
  assert.match(MAPPER, /countryCode:/, 'R-2: the shared expanded-card mapper drops the country');
});

test('R-3 hop 4 — the sheet hands the country to the row that needs it', () => {
  assert.match(SHEET, /countryCode=\{/, 'R-3: the sheet does not pass countryCode to PracticalDetailsSection');
  // A plan has no phone of its own (its STOPS do), so it must pass undefined —
  // promoting a stop's number to "the plan's number" is a lie.
  assert.match(
    SHEET, /countryCode=\{isCuratedCard \? undefined :/,
    'R-3: a curated plan is being given a country code for a phone it does not have',
  );
});

test('R-4 no raw tel: url survives anywhere in the card tree', () => {
  // The defect in one line: `tel:${phone.replace(/[^0-9+]/g, "")}`. Any tel: not
  // built from a resolved `dialablePhone` result is the bug again.
  for (const [name, code] of [['PracticalDetailsSection', DETAILS], ['ActionButtons', ACTIONS]]) {
    const tels = [...code.matchAll(/tel:\$\{([^}]*)\}/g)].map((m) => m[1].trim());
    assert.ok(tels.length > 0, `R-4 (vacuity): ${name} builds no tel: url at all`);
    for (const expr of tels) {
      assert.match(
        expr, /^dialable\.tel$/,
        `R-4: ${name} builds "tel:\${${expr}}" instead of the resolved E.164`,
      );
    }
    assert.equal(
      /replace\(\/\[\^0-9\+\]\/g/.test(code), false,
      `R-4: ${name} still strips punctuation off a raw number to dial it`,
    );
  }
});

test('R-5 no number means the button is ABSENT, never disabled', () => {
  // Seth: "if not dont show the button at all." 63% of the pool has no number,
  // so a greyed button would be the common case, not the edge case.
  assert.match(
    ACTIONS, /\{dialable !== null \? \(/,
    'R-5: the Call button is not gated on a resolvable number',
  );
  const btn = ACTIONS.slice(ACTIONS.indexOf('logId="call"'), ACTIONS.indexOf('logId="call"') + 900);
  assert.ok(btn.length > 0, 'R-5: the Call button is gone');
  assert.equal(
    /disabled=/.test(btn), false,
    'R-5: the Call button has a disabled state. It must not exist rather than exist and refuse.',
  );
});

test('R-6 one resolution, read by both the gate and the link', () => {
  // Two independent presence tests is how a button renders for a number the
  // link cannot be built from.
  for (const [name, code] of [['PracticalDetailsSection', DETAILS], ['ActionButtons', ACTIONS]]) {
    const resolutions = [...code.matchAll(/dialablePhone\(/g)];
    assert.equal(
      resolutions.length, 1,
      `R-6: ${name} calls dialablePhone ${resolutions.length} times; one resolution must serve every reader`,
    );
  }
  // The details section's own presence guard must read the resolution, not the
  // raw field.
  assert.match(
    DETAILS, /present\(address\) \|\| dialable !== null/,
    'R-6: the section renders on a raw phone value rather than a resolvable one',
  );
});

test('R-7 a dialler that refuses is surfaced, not swallowed', () => {
  // Constitution rule 3 — no silent failures. Tablets and emulators reject tel:.
  const btn = ACTIONS.slice(ACTIONS.indexOf('logId="call"'), ACTIONS.indexOf('logId="call"') + 900);
  assert.match(btn, /\.catch\(/, 'R-7: openURL is fired without a rejection handler');
  assert.match(btn, /Alert\.alert|toast|Toast/, 'R-7: a rejected dial fails silently');
});
