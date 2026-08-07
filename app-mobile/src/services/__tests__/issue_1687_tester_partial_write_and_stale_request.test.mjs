/**
 * #1687 — TESTER adversarial regression. A DIFFERENT ANGLE from the implementor's.
 *
 * The implementor's suite (`src/hooks/__tests__/issue_1687_been_here_opens_rating_prompt.test.mjs`)
 * drives the HAPPY order — tap, cancel, submit — and one failure: the review insert
 * refusing AFTER the visit landed, retried inside the same modal session.
 *
 * This file attacks the three things that suite does not reach:
 *
 *  1. THE OTHER HALF OF THE PARTIAL WRITE. Submit does two things. The implementor
 *     proved what happens when the SECOND fails. Nobody proved what happens when
 *     the FIRST does — and "a review with no visit" is the indefensible direction,
 *     because `place_reviews` would then carry a rating for an attendance that was
 *     never recorded. X-1 pins the order that prevents it. X-2 then states, on the
 *     record, exactly what a cancelled-after-failure tap leaves behind, because
 *     "cancel writes nothing" stops being true the moment a submit has half-landed.
 *     X-3 shows the re-record guard is scoped to ONE modal session: the modal is
 *     conditionally rendered on the open request, so a cancel UNMOUNTS it and
 *     `recordedVisitIdRef` resets — the next attempt re-stamps `visited_at`, which
 *     is the drift #1661 X-3 exists to catch.
 *
 *  2. THE STORE AS A NEW SIGNAL PATH. It is non-persisted, but a request that
 *     survived a card change would open the prompt for the WRONG PLACE, and a
 *     `place_pool_id` derived from a card id is only correct while every
 *     uuid-shaped deck card id is a `place_pool` row. X-4 pins the derivation's
 *     blast radius against the LIVE `place_reviews_place_pool_id_fkey`; X-5 and
 *     X-6 attack the request itself — replacement must leave no field of the
 *     previous card behind, and the snapshot must be by VALUE, so a deck that
 *     advances (or a card object that is mutated in place) cannot retarget a write
 *     that is already in flight.
 *
 *  3. THE TWO ENTRIES COLLIDING. One `PostExperienceModal` instance now serves both
 *     the scheduled calendar poll and the voluntary tap, and the poll re-runs every
 *     60 seconds and on every foreground (`usePostExperienceCheck`). X-7 pins the
 *     confirm token's scoping; X-8 pins the precedence and the re-arm, which are
 *     each one character away from submitting the user's stars against a different
 *     place with a calendar stamp.
 *
 * Harness: the REAL `visitService` and the REAL `placeReviewService` over an
 * in-memory transport this file owns, plus the REAL store over the real zustand.
 * Deliberately built independently of the implementor's harness — a shared fixture
 * that is wrong is wrong in both suites at once.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { before, after } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appMobile = path.resolve(__dirname, '../../..');
const require_ = createRequire(import.meta.url);

const FILES = {
  store: path.join(appMobile, 'src/store/placeReviewRequestStore.ts'),
  visitService: path.join(appMobile, 'src/services/visitService.ts'),
  placeReviewService: path.join(appMobile, 'src/services/placeReviewService.ts'),
  modal: path.join(appMobile, 'src/components/PostExperienceModal.tsx'),
  index: path.join(appMobile, 'app/index.tsx'),
};

/** Comments out, string literals in. */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i += 1;
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        out += src[i];
        if (src[i] === quote) { i += 1; break; }
        i += 1;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const USER_ID = '6c61590c-4e8e-4040-bd7c-29870ba6d736';

/** A single place card. Its `id` IS its `place_pool.id` — verified in production. */
const PLACE_CARD = {
  id: '98c498d9-da81-4863-a17d-04c5e5208220',
  title: 'The Parlour',
  category: 'Icebreakers',
  image: 'https://example.invalid/parlour.jpg',
  address: '108 E Main St, Durham',
  placeId: 'ChIJvR4VdHLkrIkRQAffX2_rw0w',
  priceRange: '$$',
};

/** A curated card. Not a place at all. */
const CURATED_CARD = {
  id: 'curated_picnic-dates_1786057423390_wapjzm',
  title: "Trader Joe's -> Brentwood Park",
  category: 'Picnic Dates',
  image: 'https://example.invalid/tj.jpg',
  priceRange: null,
};

/**
 * A BRAND EXPERIENCE card. `discover-cards` builds it with `id: String(row.event_id)`
 * — an `events.id`, which is uuid-shaped and is NOT a `place_pool` row. Same
 * `BeenHereControl`, no card-type gate.
 */
const EXPERIENCE_CARD = {
  id: '4d0f0be1-1a5a-4f7f-9d3f-6a0a6a1c2e77',
  title: 'Sunset Rooftop Tasting',
  category: 'Date Night',
  image: 'https://example.invalid/exp.jpg',
  priceRange: '$$$',
};

let tmpDir;
let store;
let placeReviewService;
let stub;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue1687-tester-'));

  const supabasePath = path.join(tmpDir, 'supabase.mjs');
  fs.writeFileSync(
    supabasePath,
    `
export const db = { user_visits: [], place_reviews: [], invokes: [] };
export const fail = { recordVisit: null, reviewInsert: null };
export function reset() {
  db.user_visits.length = 0;
  db.place_reviews.length = 0;
  db.invokes.length = 0;
  fail.recordVisit = null;
  fail.reviewInsert = null;
}

let visitSeq = 0;
let reviewSeq = 0;
let clock = 1000;

export const supabase = {
  functions: {
    async invoke(name, options) {
      db.invokes.push({ name, body: options?.body });
      if (name !== 'record-visit') return { data: null, error: { message: 'unexpected fn ' + name } };
      if (fail.recordVisit) return { data: null, error: { message: fail.recordVisit } };
      clock += 1000;
      const stamp = new Date(clock).toISOString();
      const existing = db.user_visits.find((r) => r.experience_id === options.body.experienceId);
      if (existing) {
        // The edge function UPSERTS and re-stamps visited_at at EXECUTION time.
        existing.visited_at = stamp;
        return { data: { visitId: existing.id, isNew: false }, error: null };
      }
      visitSeq += 1;
      const row = {
        id: 'visit-' + visitSeq,
        experience_id: options.body.experienceId,
        card_data: options.body.cardData,
        visited_at: stamp,
      };
      db.user_visits.push(row);
      return { data: { visitId: row.id, isNew: true }, error: null };
    },
  },
  from(table) {
    return {
      insert(row) {
        return {
          select() {
            return {
              async single() {
                if (table !== 'place_reviews') {
                  return { data: null, error: { message: 'unexpected table ' + table } };
                }
                if (fail.reviewInsert) return { data: null, error: { message: fail.reviewInsert } };
                reviewSeq += 1;
                const stored = { id: 'review-' + reviewSeq, ...row };
                db.place_reviews.push(stored);
                return { data: { id: stored.id }, error: null };
              },
            };
          },
        };
      },
    };
  },
};
`,
  );

  const visitPath = path.join(tmpDir, 'visitService.mjs');
  {
    const raw = stripTypeScriptTypes(fs.readFileSync(FILES.visitService, 'utf8'), { mode: 'strip' });
    const rewritten = raw.replace(
      "from './supabase'",
      `from ${JSON.stringify(pathToFileURL(supabasePath).href)}`,
    );
    assert.notEqual(rewritten, raw, 'VACUITY: visitService supabase import was not rewritten');
    assert.ok(!rewritten.includes("from './supabase'"), 'VACUITY: a real ./supabase import survived');
    fs.writeFileSync(visitPath, rewritten);
  }

  const prsPath = path.join(tmpDir, 'placeReviewService.mjs');
  {
    const raw = stripTypeScriptTypes(
      fs.readFileSync(FILES.placeReviewService, 'utf8'),
      { mode: 'strip' },
    );
    const rewritten = raw
      .replace("from './supabase'", `from ${JSON.stringify(pathToFileURL(supabasePath).href)}`)
      .replace("from './visitService'", `from ${JSON.stringify(pathToFileURL(visitPath).href)}`);
    assert.notEqual(rewritten, raw, 'VACUITY: placeReviewService imports were not rewritten');
    for (const spec of ['./supabase', './visitService']) {
      assert.ok(!rewritten.includes(`from '${spec}'`), `VACUITY: '${spec}' survived`);
    }
    fs.writeFileSync(prsPath, rewritten);
  }

  const storePath = path.join(tmpDir, 'store.mjs');
  {
    const raw = stripTypeScriptTypes(fs.readFileSync(FILES.store, 'utf8'), { mode: 'strip' });
    const rewritten = raw.replace(
      "from 'zustand'",
      `from ${JSON.stringify(pathToFileURL(require_.resolve('zustand')).href)}`,
    );
    assert.notEqual(rewritten, raw, 'VACUITY: the store zustand import was not rewritten');
    fs.writeFileSync(storePath, rewritten);
  }

  stub = await import(pathToFileURL(supabasePath).href);
  placeReviewService = await import(pathToFileURL(prsPath).href);
  store = await import(pathToFileURL(storePath).href);
});

after(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

function rows() {
  return { visits: stub.db.user_visits.length, reviews: stub.db.place_reviews.length };
}

function freshSession(card) {
  stub.reset();
  store.usePlaceReviewRequestStore.setState({
    request: null,
    confirmedCardId: null,
    confirmToken: 0,
  });
  if (card) store.openPlaceReviewRequest(store.placeReviewRequestFromCard(card));
}

/** Exactly what `handleSubmitVoluntary` issues, from the open request. */
function submit(rating, recordedVisitId = null) {
  const request = store.usePlaceReviewRequestStore.getState().request;
  assert.ok(request, 'VACUITY: submit was driven with no open request');
  return placeReviewService.submitVoluntaryPlaceReview(
    { userId: USER_ID, ...request, rating },
    recordedVisitId,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1 — the partial write, both directions
// ─────────────────────────────────────────────────────────────────────────────

test('X-1 when the VISIT fails, no review is written — a rating never outlives its visit', async () => {
  freshSession(PLACE_CARD);
  stub.fail.recordVisit = 'record-visit exploded';

  let caught = null;
  try {
    await submit(5);
  } catch (error) {
    caught = error;
  }

  assert.ok(caught, 'X-1: a refused record-visit resolved successfully');
  assert.deepEqual(
    rows(),
    { visits: 0, reviews: 0 },
    'X-1: the review was written even though the visit never landed. That is the ONE partial '
    + 'state that cannot be defended: `place_reviews.did_attend` is hard-coded true on this '
    + 'path, so the row asserts an attendance `user_visits` has no record of. The visit must '
    + 'be step 1 and its failure must abort before the insert.',
  );
  assert.notEqual(
    caught.name,
    'PlaceReviewWriteError',
    'X-1: a failed VISIT was reported as a failed REVIEW write. PlaceReviewWriteError means '
    + '"the visit landed, retry without re-recording"; raising it here would make the retry '
    + 'skip a record that never happened, and the review would then be the only row.',
  );
  assert.equal(
    stub.db.invokes.length,
    1,
    'X-1: record-visit was called more than once for a single submit',
  );
});

test('X-2 a review insert that fails leaves an ORPHANED VISIT, and cancelling does not undo it', async () => {
  // The contract is "a cancelled tap writes nothing". That holds for a tap that was
  // never submitted. It does NOT hold once a submit has half-landed, and this pins
  // exactly how far the guarantee reaches.
  freshSession(PLACE_CARD);
  stub.fail.reviewInsert = 'place_reviews insert refused';

  let caught = null;
  try {
    await submit(4);
  } catch (error) {
    caught = error;
  }
  assert.equal(caught?.name, 'PlaceReviewWriteError', 'X-2: the half-landed write did not surface');
  assert.deepEqual(rows(), { visits: 1, reviews: 0 }, 'X-2: expected visit-without-review');

  // Now the user takes the way out the close icon offers.
  store.cancelPlaceReviewRequest();
  const s = store.usePlaceReviewRequestStore.getState();

  assert.equal(s.request, null, 'X-2: cancel did not close the request');
  assert.deepEqual(
    rows(),
    { visits: 1, reviews: 0 },
    'X-2: cancelling after a half-landed submit is NOT a no-op — a `user_visits` row survives '
    + 'it. If a future change makes cancel delete that row, it re-creates the delete-races-an-'
    + '11.8s-insert shape #1687 exists to remove; the correct direction is to keep this true '
    + 'and make the leftover visible.',
  );
  assert.equal(
    s.confirmToken,
    0,
    'X-2: the confirm token moved on a failed submit, so the deck would flash "Thank you" for '
    + 'a review that was refused.',
  );
  assert.equal(
    s.confirmedCardId,
    null,
    'X-2: a failed submit recorded a confirmed card, so the wrong pill would settle.',
  );
});

test('X-3 the no-re-record guard is scoped to ONE modal session — a later attempt re-stamps visited_at', async () => {
  // The modal is rendered conditionally on the open request, so cancelling UNMOUNTS
  // it and `recordedVisitIdRef` resets to null. The next attempt therefore arrives
  // with recordedVisitId = null, which is the state this asserts.
  freshSession(PLACE_CARD);
  stub.fail.reviewInsert = 'place_reviews insert refused';
  await submit(4).catch(() => {});
  const firstVisitedAt = stub.db.user_visits[0].visited_at;
  assert.equal(stub.db.invokes.length, 1, 'VACUITY: the first attempt did not record once');

  // Session 2: the request re-opened by a second tap, the ref gone with the unmount.
  stub.fail.reviewInsert = null;
  store.cancelPlaceReviewRequest();
  store.openPlaceReviewRequest(store.placeReviewRequestFromCard(PLACE_CARD));
  await submit(4, null);

  assert.deepEqual(
    rows(),
    { visits: 1, reviews: 1 },
    'X-3: the second session created a duplicate row. `user_visits` is unique on '
    + '(user_id, experience_id), so a second record must upsert, not insert.',
  );
  assert.equal(
    stub.db.invokes.length,
    2,
    'X-3: this test asserts the CURRENT behaviour so a change to it is visible: the retry '
    + 'guard lives in a ref on a component that unmounts with the request, so a second '
    + 'session DOES call record-visit again.',
  );
  assert.notEqual(
    stub.db.user_visits[0].visited_at,
    firstVisitedAt,
    'X-3: `record-visit` stamps `visited_at` at EXECUTION time, so the second call rewrote the '
    + 'recorded time of the user\'s own visit — the exact drift #1661 X-3 exists to catch. The '
    + 'within-session guard (`recordedVisitId`) does not reach across sessions; if that is '
    + 'ever fixed, this assertion is the one to invert.',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 — the store: derivation blast radius, and stale/wrong-place requests
// ─────────────────────────────────────────────────────────────────────────────

test('X-4 a uuid-shaped card id that is NOT a place is still written into place_pool_id', async () => {
  // `placeReviewRequestFromCard` derives `place_pool_id` from the SHAPE of the id.
  // `place_reviews.place_pool_id` carries a live FK to `place_pool(id)`, and the
  // deck also serves `cardType: 'experience'` cards whose id is an `events.id` —
  // uuid-shaped, not a place. The same BeenHereControl renders on that tree.
  const request = store.placeReviewRequestFromCard(EXPERIENCE_CARD);
  assert.equal(
    request.placePoolId,
    EXPERIENCE_CARD.id,
    'X-4: the derivation changed. If it now consults the card\'s PROVENANCE rather than the '
    + 'shape of its id, this assertion should be inverted to expect undefined — that is the fix.',
  );

  freshSession(null);
  store.openPlaceReviewRequest(request);
  // Postgres 23503 is what the FK produces for this row.
  stub.fail.reviewInsert = 'insert or update on table "place_reviews" violates foreign key '
    + 'constraint "place_reviews_place_pool_id_fkey"';

  let caught = null;
  try {
    await submit(5);
  } catch (error) {
    caught = error;
  }

  assert.equal(caught?.name, 'PlaceReviewWriteError', 'X-4: the FK refusal did not surface');
  assert.deepEqual(
    rows(),
    { visits: 1, reviews: 0 },
    'X-4: a foreign-key refusal on the review leaves a `user_visits` row behind and NO review, '
    + 'and every retry hits the same constraint — the user can never clear it. A uuid is not '
    + 'proof of `place_pool` membership; the card knows its own `cardType`.',
  );
  assert.equal(
    caught.visitId,
    stub.db.user_visits[0].id,
    'X-4: the orphaned visit is not carried out of the failure, so nothing downstream can '
    + 'even name the row that was left behind',
  );
});

test('X-5 a replaced request keeps NO field of the card it replaced', async () => {
  // Two taps in quick succession, place card then curated. If the store merged
  // instead of replacing, the curated review would inherit the place's
  // `place_pool_id` and `google_place_id` — a rating filed against a place the
  // user never named.
  freshSession(PLACE_CARD);
  store.openPlaceReviewRequest(store.placeReviewRequestFromCard(CURATED_CARD));

  const request = store.usePlaceReviewRequestStore.getState().request;
  assert.equal(request.cardId, CURATED_CARD.id, 'X-5: the second tap did not win');
  for (const [field, stale] of [
    ['placePoolId', PLACE_CARD.id],
    ['googlePlaceId', PLACE_CARD.placeId],
    ['placeAddress', PLACE_CARD.address],
    ['priceTier', PLACE_CARD.priceRange],
  ]) {
    assert.notEqual(
      request[field],
      stale,
      `X-5: \`${field}\` still carries the PREVIOUS card's value. The request must be replaced '
       + 'wholesale, never merged — a partial overwrite files the rating against the wrong place.`,
    );
  }

  await submit(3);
  const [review] = stub.db.place_reviews;
  assert.equal(review.card_id, CURATED_CARD.id, 'X-5: the review was written for the wrong card');
  assert.equal(review.place_pool_id, null, 'X-5: the curated review inherited a place_pool_id');
  assert.equal(review.google_place_id, null, 'X-5: the curated review inherited a google_place_id');
  assert.equal(review.place_name, CURATED_CARD.title);
});

test('X-6 the request is a by-VALUE snapshot — the deck moving on cannot retarget the write', async () => {
  // The card object the deck holds is re-used and re-rendered. If the request kept
  // a REFERENCE to it (or the modal read live deck state), a deck that advanced
  // while the prompt was open would file the rating against whatever card is now
  // in front.
  const live = { ...PLACE_CARD };
  freshSession(null);
  store.openPlaceReviewRequest(store.placeReviewRequestFromCard(live));

  // The deck advances underneath: same object, different place.
  live.id = CURATED_CARD.id;
  live.title = CURATED_CARD.title;
  live.placeId = undefined;
  live.address = undefined;

  await submit(2);

  const [review] = stub.db.place_reviews;
  assert.equal(
    review.card_id,
    PLACE_CARD.id,
    'X-6: the write followed the deck instead of the tap. The user rated the card that was in '
    + 'front when they tapped; a snapshot taken by reference lets a later render change what '
    + 'is recorded.',
  );
  assert.equal(review.place_name, PLACE_CARD.title);
  assert.equal(review.google_place_id, PLACE_CARD.placeId);
  const [visit] = stub.db.user_visits;
  assert.equal(visit.experience_id, PLACE_CARD.id, 'X-6: the VISIT followed the deck');
});

test('X-7 the confirm signal stays pinned to the card that was confirmed', () => {
  freshSession(PLACE_CARD);
  store.confirmPlaceReviewRequest();
  const afterConfirm = store.usePlaceReviewRequestStore.getState();
  assert.equal(afterConfirm.confirmedCardId, PLACE_CARD.id);
  assert.equal(afterConfirm.confirmToken, 1);

  // A second card is tapped and abandoned.
  store.openPlaceReviewRequest(store.placeReviewRequestFromCard(CURATED_CARD));
  store.cancelPlaceReviewRequest();

  const s = store.usePlaceReviewRequestStore.getState();
  assert.equal(
    s.confirmToken,
    1,
    'X-7: an abandoned review moved the token. Every mounted BeenHereControl watches this one '
    + 'number, so a move fires the flash effect on all of them at once.',
  );
  assert.equal(
    s.confirmedCardId,
    PLACE_CARD.id,
    'X-7: cancelling card B overwrote the confirmed card. The flash is gated on '
    + '`confirmedCardId === card.id`, so the wrong pill would be the one to light up.',
  );

  // Confirming the SAME card again must still move the token, or a second genuine
  // review of a re-served card settles with no acknowledgement at all.
  store.openPlaceReviewRequest(store.placeReviewRequestFromCard(PLACE_CARD));
  store.confirmPlaceReviewRequest();
  assert.equal(
    store.usePlaceReviewRequestStore.getState().confirmToken,
    2,
    'X-7: re-confirming the same card did not move the token, so the control cannot tell a '
    + 'fresh confirmation from a re-mount',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 — the two entries into one modal instance
// ─────────────────────────────────────────────────────────────────────────────

test('X-8 the voluntary request outranks the scheduled one, and a target swap re-arms the modal', () => {
  const index = stripComments(fs.readFileSync(FILES.index, 'utf8'));

  // `usePostExperienceCheck` polls every 60s and on every foreground, so a
  // scheduled review can arm WHILE a voluntary prompt is open on its rating step.
  assert.match(
    index,
    /const\s+activeReviewTarget\s*=\s*voluntaryReviewTarget\s*\?\?\s*pendingReview\s*;/,
    'X-8: the voluntary target no longer wins. Reversed, a scheduled review arming mid-rating '
    + 'would swap the modal\'s `review` underneath the stars the user already picked, and the '
    + 'submit would file them against the OTHER place — with a calendar entry stamped on it.',
  );
  assert.match(
    index,
    /visible=\{voluntaryPlaceReview\s*\?\s*true\s*:\s*showReviewModal\}/,
    'X-8: the voluntary prompt no longer forces `visible`. It has no 3-second arming timer of '
    + 'its own — the tap IS the trigger — so gating it on `showReviewModal` makes the tap open '
    + 'nothing until an unrelated calendar poll happens to fire.',
  );
  assert.match(
    index,
    /dismissible=\{!!voluntaryPlaceReview\}/,
    'X-8: the close icon is no longer scoped to the voluntary entry. On the scheduled prompt it '
    + 'is a way out of a locked modal that the calendar flow does not have.',
  );

  const modal = stripComments(fs.readFileSync(FILES.modal, 'utf8'));

  // One mount, two entries: the reset must follow the TARGET, not only `visible`.
  assert.match(
    modal,
    /\}\s*,\s*\[\s*visible\s*,\s*initialStep\s*,\s*review\.cardId\s*\]\s*\)\s*;/,
    'X-8: the modal\'s reset no longer re-arms on the target. `visible` stays true across a '
    + 'voluntary -> scheduled swap, so without `review.cardId` in the dependencies the new '
    + 'session inherits the previous one\'s step, its chosen rating and its recorded-visit id.',
  );
  const resetAt = modal.indexOf('setStep(initialStep)');
  assert.ok(resetAt > 0, 'VACUITY: the reset no longer sets the initial step');
  const resetBody = modal.slice(resetAt, resetAt + 700);
  assert.match(
    resetBody,
    /setRating\(0\)/,
    'X-8: the rating survives a re-arm, so stars picked for one place would be submitted for '
    + 'the next one',
  );
  assert.match(
    resetBody,
    /recordedVisitIdRef\.current\s*=\s*null/,
    'X-8: the recorded-visit id survives a re-arm. Carried into a DIFFERENT card it makes the '
    + 'submit skip the record entirely, and the new place\'s review is attached to the previous '
    + 'place\'s visit.',
  );

  // The voluntary entry must never stamp a calendar entry it does not have.
  assert.match(
    modal,
    /resolvedCalendarEntryId\s*=\s*isVoluntary\s*\n?\s*\?\s*null/,
    'X-8: a voluntary review can stamp a calendar entry again. With one mount shared by both '
    + 'entries, the scheduled target\'s id is in scope on the voluntary path.',
  );
});
