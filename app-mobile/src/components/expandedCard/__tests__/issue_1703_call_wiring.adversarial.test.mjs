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
// #4347 wave 3 — Call moved off the action bar entirely: a place dials from its
// Details phone row, a plan's stop dials from the stop card's More.
const PLAN = strip(read('app-mobile/src/components/expandedCard/CuratedPlanBody.tsx'));
const STOPCARD = strip(read('app-mobile/src/components/expandedCard/PlanStopCard.tsx'));

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
  // A place: its own number and country go to the Details row.
  assert.match(SHEET, /countryCode=\{card\.countryCode\}/, 'R-3: the sheet does not pass countryCode to PracticalDetailsSection');
  // A plan has no phone of its own (its STOPS do): the plan body never mounts
  // the place Details, and each stop resolves its OWN number and country.
  assert.equal(/<PracticalDetailsSection/.test(PLAN), false, 'R-3: a curated plan is given a place Details (and a borrowed phone)');
  assert.match(PLAN, /dialablePhone\(stop\.phone \?\? null, stop\.countryCode \?\? null\)/, 'R-3: a stop is dialled without its own country');
});
test('R-4 no raw tel: url survives anywhere in the card tree', () => {
  const tels = [...DETAILS.matchAll(/tel:\$\{([^}]*)\}/g)].map((m) => m[1].trim());
  assert.ok(tels.length > 0, 'R-4 (vacuity): PracticalDetailsSection builds no tel: url at all');
  for (const expr of tels) assert.match(expr, /^dialable\.tel$/, `R-4: PracticalDetailsSection builds "tel:\${${expr}}" instead of the resolved E.164`);
  assert.equal(/tel:/.test(ACTIONS), false, 'R-4: the action bar dials again (Call left it in #4347 wave 2/3)');
  // The plan: the stop card hands up the RESOLVED number, the sheet dials it.
  assert.match(PLAN, /onCall\(dial\.tel, dial\.display\)/, 'R-4: a stop is dialled with something other than its resolved E.164');
  assert.match(SHEET, /Linking\.openURL\(`tel:\$\{tel\}`\)/, 'R-4 (vacuity): the plan stop call is not wired');
  for (const [name, code] of [['PracticalDetailsSection', DETAILS], ['CuratedPlanBody', PLAN], ['ExpandedCardModal', SHEET]]) {
    assert.equal(/replace\(\/\[\^0-9\+\]\/g/.test(code), false, `R-4: ${name} still strips punctuation off a raw number to dial it`);
  }
});
test('R-5 no number means the button is ABSENT, never disabled', () => {
  // Seth: "if not dont show the button at all."
  assert.match(DETAILS, /value=\{dialable === null \? null : dialable\.display\}/, 'R-5: the Details phone row is gone, so a place cannot be called');
  assert.match(PLAN, /onCall=\{dial \? \(\) => onCall\(dial\.tel, dial\.display\) : undefined\}/, 'R-5: a stop with no resolvable number still gets a Call handler');
  assert.match(STOPCARD, /more\.phone && onCall \? \(/, 'R-5: the stop Call is not gated on a resolvable number');
  const btn = STOPCARD.slice(STOPCARD.indexOf("-call`"), STOPCARD.indexOf("-call`") + 400);
  assert.ok(btn.length > 0, 'R-5: the stop Call button is gone');
  assert.equal(/disabled=/.test(btn), false, 'R-5: the stop Call button has a disabled state.');
});
test('R-6 one resolution, read by both the gate and the link', () => {
  for (const [name, code] of [['PracticalDetailsSection', DETAILS], ['CuratedPlanBody', PLAN]]) {
    const resolutions = [...code.matchAll(/dialablePhone\(/g)];
    assert.equal(resolutions.length, 1, `R-6: ${name} calls dialablePhone ${resolutions.length} times; one resolution must serve every reader`);
  }
  assert.match(DETAILS, /present\(address\) \|\| dialable !== null/, 'R-6: the section renders on a raw phone value rather than a resolvable one');
  // The stop's gate (`phone: dial ? …`) and its link (`dial.tel`) read the same `dial`.
  assert.match(PLAN, /phone: dial \? \{ display: dial\.display \} : null/, 'R-6: the stop gate reads a raw phone value');
});
test('R-7 a dialler that refuses is surfaced, not swallowed', () => {
  // Constitution rule 3 — no silent failures. Tablets and emulators reject tel:.
  const call = SHEET.slice(SHEET.indexOf('onCall={(tel, display)'), SHEET.indexOf('onCall={(tel, display)') + 300);
  assert.ok(call.length > 20, 'R-7 (vacuity): the plan stop call handler is gone');
  assert.match(call, /\.catch\(/, 'R-7: openURL is fired without a rejection handler');
  assert.match(call, /toastManager\.show|Alert\.alert/, 'R-7: a rejected dial fails silently');
});
