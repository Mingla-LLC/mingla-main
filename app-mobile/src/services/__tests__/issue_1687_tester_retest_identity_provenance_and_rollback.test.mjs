/**
 * #1687 RETEST — TESTER ADVERSARIAL SUITE 2.
 *
 * The first tester suite (`issue_1687_tester_partial_write_and_stale_request.test.mjs`)
 * attacked the write ORDER and the store. The rework changed two things it cannot
 * see, and made one of its own fixtures unfaithful. This file exists for both
 * reasons, and is deliberately APPEND-ONLY alongside it — the first suite still
 * pins the SERVICE's behaviour, which is unchanged and still correct.
 *
 * 1. IDENTITY IS NOW CARRIED, NOT INFERRED. `resolvePlacePoolId` gained a
 *    three-step ladder: a DECLARED type other than 'place' yields nothing; a
 *    CARRIED `placePoolId` is believed; and only a card with neither falls back to
 *    the old shape test.
 *
 *    The first suite's X-4 named this fix and can no longer detect it: its
 *    `EXPERIENCE_CARD` fixture omits `cardType`, which the real serving shape sets
 *    (`supabase/functions/discover-cards/index.ts` builds `cardType: 'experience'`,
 *    and `deckService.experienceCardToRecommendation` carries it verbatim onto the
 *    Recommendation). X-4 therefore now exercises the TRANSITIONAL fallback while
 *    claiming to exercise the experience card. T-1 below is the faithful fixture it
 *    should have carried; T-3 is what X-4 is actually testing, stated honestly.
 *
 *    The claim under attack is that rule 1 "closes the CLASS, not the instance — a
 *    fifth card type fails closed before anyone has to remember it exists."
 *    T-1/T-2/T-6 show that is true for every card type that DECLARES itself.
 *    T-3 shows the exact residual: a card that declares NOTHING is indistinguishable
 *    from a single pool place, because declaring nothing is precisely how a real
 *    place card identifies itself today. The class is closed against declared
 *    types and open against undeclared ones.
 *
 * 2. A FAILED REVIEW NOW ROLLS THE VISIT BACK — but `rollBackHalfLandedVisit` is
 *    wired into `useSubmitVoluntaryPlaceReview`'s `mutationFn`, NOT into
 *    `submitVoluntaryPlaceReview`. Every assertion the first suite makes about a
 *    surviving orphan is still true of the service and no longer true of the
 *    product. T-7..T-12 attack the composition the product actually runs: the
 *    rollback path, the rollback that ITSELF fails, and the pre-existing visit that
 *    must never be deleted on the user's behalf.
 *
 * Harness: the REAL `visitService`, the REAL `placeReviewService` and the REAL
 * store over an in-memory transport this file owns. `removeVisit` is reachable and
 * independently failable, which the first suite's stub could not do.
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
const repoRoot = path.resolve(appMobile, '..');
const require_ = createRequire(import.meta.url);

const FILES = {
  store: path.join(appMobile, 'src/store/placeReviewRequestStore.ts'),
  visitService: path.join(appMobile, 'src/services/visitService.ts'),
  placeReviewService: path.join(appMobile, 'src/services/placeReviewService.ts'),
  reviewsHook: path.join(appMobile, 'src/hooks/usePlaceReviews.ts'),
  deckService: path.join(appMobile, 'src/services/deckService.ts'),
  discoverCards: path.join(repoRoot, 'supabase/functions/discover-cards/index.ts'),
  migration: path.join(
    repoRoot,
    'supabase/migrations/20270223001687_issue_1687_one_voluntary_review_per_place.sql',
  ),
};

const USER_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

/**
 * The REAL serving shape of a brand experience: `discover-cards` builds it with
 * `id: String(row.event_id)` AND `cardType: 'experience'`, and `deckService`
 * carries both onto the Recommendation. An `events.id` is uuid-shaped and is not
 * a `place_pool` row — 0 of the 65 production `events` rows exist in `place_pool`,
 * and `place_reviews.place_pool_id` carries a live FK to it.
 */
const EXPERIENCE_CARD_FAITHFUL = {
  id: '4d0f0be1-1a5a-4f7f-9d3f-6a0a6a1c2e77',
  title: 'Sunset Rooftop Tasting',
  category: 'Date Night',
  image: 'https://example.invalid/exp.jpg',
  priceRange: '$$$',
  cardType: 'experience',
};

/** A single pool place off `deckService.unifiedCardToRecommendation`: no declared
 *  type, and the `place_pool.id` CARRIED rather than inferred. */
const PLACE_CARD_CARRIED = {
  id: '98c498d9-da81-4863-a17d-04c5e5208220',
  title: 'The Parlour',
  category: 'Icebreakers',
  image: 'https://example.invalid/place.jpg',
  address: '117 Market St, Durham, NC 27701, USA',
  placeId: 'ChIJvR4VdHLkrIkRQAffX2_rw0w',
  placePoolId: '98c498d9-da81-4863-a17d-04c5e5208220',
};

/** The SAME place rebuilt by a producer that does not go through `deckService` —
 *  a saved card, a collab deck, a restored deck-state snapshot. No declared type,
 *  no carried id. This is the live transitional path. */
const PLACE_CARD_REBUILT = {
  id: '98c498d9-da81-4863-a17d-04c5e5208220',
  title: 'The Parlour',
  category: 'Icebreakers',
  image: 'https://example.invalid/place.jpg',
  address: '117 Market St, Durham, NC 27701, USA',
  placeId: 'ChIJvR4VdHLkrIkRQAffX2_rw0w',
};

let tmpDir;
let store;
let placeReviewService;
let stub;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue1687-retest-'));

  const supabasePath = path.join(tmpDir, 'supabase.mjs');
  fs.writeFileSync(
    supabasePath,
    `
export const db = { user_visits: [], place_reviews: [], invokes: [], deletes: [] };
export const fail = { recordVisit: null, reviewInsert: null, removeVisit: null, getUser: false };
export function reset() {
  db.user_visits.length = 0;
  db.place_reviews.length = 0;
  db.invokes.length = 0;
  db.deletes.length = 0;
  fail.recordVisit = null;
  fail.reviewInsert = null;
  fail.removeVisit = null;
  fail.getUser = false;
}

let visitSeq = 0;
let reviewSeq = 0;
let clock = 1000;

export const supabase = {
  auth: {
    async getUser() {
      if (fail.getUser) return { data: { user: null } };
      return { data: { user: { id: ${JSON.stringify(USER_ID)} } } };
    },
  },
  functions: {
    async invoke(name, options) {
      db.invokes.push({ name, body: options?.body });
      if (name !== 'record-visit') return { data: null, error: { message: 'unexpected fn ' + name } };
      if (fail.recordVisit) return { data: null, error: { message: fail.recordVisit } };
      clock += 1000;
      const stamp = new Date(clock).toISOString();
      const existing = db.user_visits.find((r) => r.experience_id === options.body.experienceId);
      if (existing) {
        existing.visited_at = stamp;
        return { data: { visitId: existing.id, isNew: false }, error: null };
      }
      visitSeq += 1;
      const row = {
        id: 'visit-' + visitSeq,
        user_id: ${JSON.stringify(USER_ID)},
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
      delete() {
        const filters = {};
        const chain = {
          eq(col, val) {
            filters[col] = val;
            // The real client resolves on the SECOND .eq() in removeVisit.
            if (Object.keys(filters).length < 2) return chain;
            return (async () => {
              db.deletes.push({ table, filters: { ...filters } });
              if (fail.removeVisit) return { error: { message: fail.removeVisit } };
              if (table !== 'user_visits') return { error: { message: 'unexpected table ' + table } };
              for (let i = db.user_visits.length - 1; i >= 0; i -= 1) {
                const r = db.user_visits[i];
                if (r.user_id === filters.user_id && r.experience_id === filters.experience_id) {
                  db.user_visits.splice(i, 1);
                }
              }
              return { error: null };
            })();
          },
          then(resolve, rejectFn) {
            return Promise.resolve({ error: null }).then(resolve, rejectFn);
          },
        };
        return chain;
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

/**
 * EXACTLY what `useSubmitVoluntaryPlaceReview`'s `mutationFn` does — the write,
 * and the compensating rollback on the way out. The first tester suite calls the
 * service directly and therefore never reaches the rollback at all.
 */
async function mutationFn(input, recordedVisitId = null) {
  try {
    return await placeReviewService.submitVoluntaryPlaceReview(input, recordedVisitId);
  } catch (error) {
    throw await placeReviewService.rollBackHalfLandedVisit(error, input.cardId);
  }
}

function submitThroughMutation(card, rating, recordedVisitId = null) {
  const request = store.placeReviewRequestFromCard(card);
  return mutationFn({ userId: USER_ID, ...request, rating }, recordedVisitId);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1 — identity is CARRIED, never inferred. Attacking rule 1's "closes the class".
// ─────────────────────────────────────────────────────────────────────────────

test('T-1 the FAITHFUL experience card yields NO place anchor — the fixture X-4 should have carried', () => {
  // VACUITY: the fixture must actually be the shape the server sends, or this
  // test degrades into T-3 exactly as X-4 did.
  const serving = fs.readFileSync(FILES.discoverCards, 'utf8');
  assert.match(
    serving,
    /cardType:\s*'experience'/,
    'VACUITY: discover-cards no longer declares cardType on the experience card, so this fixture '
    + 'is no longer faithful and the test proves nothing.',
  );
  assert.match(
    serving,
    /id:\s*String\(row\.event_id\)/,
    "VACUITY: discover-cards no longer builds the experience card's id from events.id, so the "
    + 'FK hazard this test exists for may have moved.',
  );

  const request = store.placeReviewRequestFromCard(EXPERIENCE_CARD_FAITHFUL);
  assert.equal(
    request.placePoolId,
    undefined,
    'T-1: a card that DECLARES cardType "experience" still produced a place anchor. Its id is an '
    + '`events.id`, and `place_reviews.place_pool_id` carries a live FK to `place_pool` — the row '
    + 'would be refused with 23503 AFTER the visit had already landed.',
  );
  assert.equal(request.cardId, EXPERIENCE_CARD_FAITHFUL.id, 'T-1: the card id must still be carried');
});

test('T-2 an UNKNOWN future card type fails CLOSED even when it carries a placePoolId', () => {
  // The claim is that rule 1 closes the CLASS. This is the strongest form of it:
  // a type nobody has written yet, arriving with BOTH a uuid-shaped id and a
  // carried anchor. Declared-not-place must outrank a carried value, or the
  // "believe what is carried" rule becomes the new inference bug.
  const request = store.placeReviewRequestFromCard({
    id: '11111111-2222-4333-8444-555555555555',
    title: 'A card type invented after this line was written',
    category: 'Whatever',
    cardType: 'venue_bundle_v3',
    placePoolId: '99999999-8888-4777-8666-555555555555',
  });
  assert.equal(
    request.placePoolId,
    undefined,
    'T-2: a DECLARED non-place type produced a place anchor. Rule 1 must be evaluated BEFORE the '
    + 'carried value, otherwise a producer that sets `placePoolId` on a non-place card re-opens '
    + 'the class this fix exists to close.',
  );
});

test('T-3 THE RESIDUAL — a card that declares NOTHING is still trusted by its id shape', () => {
  // This is what the first suite's X-4 actually tests, now that its fixture omits
  // `cardType`. It is not a redundant assertion — it is the boundary of rule 1.
  //
  // Rule 1 keys on a DECLARATION. A single pool place declares nothing (deckService
  // sets no cardType on that branch), so "no declaration" is the SAFE signal and the
  // DANGEROUS signal at the same time. A fifth card type added by a producer that
  // follows the place card's own precedent — set no cardType — is NOT refused.
  const undeclaredNonPlace = {
    id: '4d0f0be1-1a5a-4f7f-9d3f-6a0a6a1c2e77', // an events.id, uuid-shaped
    title: 'A future card whose author copied the place branch',
    category: 'Date Night',
  };
  assert.equal(
    store.placeReviewRequestFromCard(undeclaredNonPlace).placePoolId,
    undeclaredNonPlace.id,
    'T-3: this asserts the CURRENT behaviour so a change to it is visible. The [TRANSITIONAL] '
    + 'shape fallback still writes any uuid-shaped id into a live foreign key when the card '
    + 'declares no type and carries no anchor. Rule 1 closes the class of DECLARED types; it '
    + 'cannot close the class of undeclared ones. Invert this assertion when the fallback is '
    + 'deleted — its stated exit condition is "every place-card producer sets placePoolId".',
  );

  // And the exit condition must actually be written down (Constitution rule 7).
  const storeSrc = fs.readFileSync(FILES.store, 'utf8');
  assert.match(
    storeSrc,
    /\[TRANSITIONAL\]/,
    'T-3: the shape fallback is temporary and must be labelled [TRANSITIONAL] with an exit '
    + 'condition, or it becomes permanent by default.',
  );
});

test('T-4 the transitional path is LIVE and CORRECT for a place rebuilt outside deckService', async () => {
  // Saved cards, collab decks and restored deck-state snapshots rebuild the place
  // shape without going through `unifiedCardToRecommendation`, so path 3 is not
  // theoretical. It must still produce the RIGHT anchor for a genuine place, or
  // deleting it later would be a regression rather than a cleanup.
  const carried = store.placeReviewRequestFromCard(PLACE_CARD_CARRIED);
  const rebuilt = store.placeReviewRequestFromCard(PLACE_CARD_REBUILT);
  assert.equal(carried.placePoolId, PLACE_CARD_CARRIED.placePoolId, 'T-4: the carried anchor was lost');
  assert.equal(
    rebuilt.placePoolId,
    PLACE_CARD_REBUILT.id,
    'T-4: the same place rebuilt without a carried anchor lost its place_pool_id, so a saved-card '
    + 'or collab-deck rating would be written with a NULL anchor while the identical card off the '
    + 'solo deck is written with one.',
  );
  assert.equal(carried.placePoolId, rebuilt.placePoolId, 'T-4: the two producers disagree');

  // And it round-trips into the row.
  stub.reset();
  await mutationFn({ userId: USER_ID, ...rebuilt, rating: 4 });
  assert.equal(stub.db.place_reviews[0].place_pool_id, PLACE_CARD_REBUILT.id);
  assert.equal(stub.db.place_reviews[0].google_place_id, PLACE_CARD_REBUILT.placeId);
});

test('T-5 a carried anchor that is not uuid-shaped is NOT believed', () => {
  // "Believe what is carried" must still be bounded by the column's own type, or a
  // producer bug becomes a 22P02 the user cannot resolve.
  const request = store.placeReviewRequestFromCard({
    id: 'curated_picnic-dates_1786063246605_opzi2g',
    title: "Trader Joe's -> Brentwood Park",
    category: 'Picnic Dates',
    placePoolId: 'not-a-uuid',
  });
  assert.equal(
    request.placePoolId,
    undefined,
    'T-5: a non-uuid carried value reached a uuid column.',
  );
});

test('T-6 the declared-place constant is honoured in both directions', () => {
  // `SINGLE_PLACE_CARD_TYPE` is 'place' and nothing in the pipeline emits it today,
  // so the constant is currently inert. Pin what it MEANS before someone starts
  // emitting it: declaring 'place' must not by itself manufacture an anchor.
  assert.equal(
    store.placeReviewRequestFromCard({
      id: 'not-a-uuid-at-all',
      title: 'Declared place, non-uuid id',
      category: 'X',
      cardType: 'place',
    }).placePoolId,
    undefined,
    'T-6: declaring "place" fabricated an anchor out of an id that is not one (Constitution 9).',
  );
  assert.equal(
    store.placeReviewRequestFromCard({
      id: '98c498d9-da81-4863-a17d-04c5e5208220',
      title: 'Declared place, uuid id',
      category: 'X',
      cardType: 'place',
    }).placePoolId,
    '98c498d9-da81-4863-a17d-04c5e5208220',
    'T-6: declaring "place" must not be treated as "some other type" and blocked.',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 — the rollback. Both rows, or neither.
// ─────────────────────────────────────────────────────────────────────────────

test('T-7 a refused review leaves NO visit behind — the tap records both rows or neither', async () => {
  stub.reset();
  stub.fail.reviewInsert =
    'insert or update on table "place_reviews" violates foreign key constraint '
    + '"place_reviews_place_pool_id_fkey"';

  let caught = null;
  try {
    await submitThroughMutation(PLACE_CARD_CARRIED, 5);
  } catch (error) {
    caught = error;
  }

  assert.equal(caught?.name, 'PlaceReviewWriteError', 'T-7: the refusal did not surface');
  assert.deepEqual(
    rows(),
    { visits: 0, reviews: 0 },
    'T-7: the visit survived a refused review. This is the state that made the FK failure '
    + 'unrecoverable: a `user_visits` row the deck does not show, and `place_reviews` grants '
    + 'the user no DELETE.',
  );
  assert.equal(stub.db.deletes.length, 1, 'T-7: the compensating delete was never issued');
  assert.deepEqual(stub.db.deletes[0].filters, {
    user_id: USER_ID,
    experience_id: PLACE_CARD_CARRIED.id,
  });
  assert.equal(
    caught.visitId,
    null,
    'T-7: a rolled-back visit must hand back a NULL id, or the retry reuses a row that no longer '
    + 'exists and skips recording the visit entirely.',
  );
  assert.equal(caught.visitCreated, false, 'T-7: visitCreated must not survive the rollback');
});

test('T-8 when the ROLLBACK ITSELF fails, the screen stops disagreeing with the database', async () => {
  // The one case where a row genuinely survives. The contract then is: surface the
  // ORIGINAL error, keep the visit id so the retry does not re-stamp `visited_at`,
  // and let the caller settle the pill to the truth.
  stub.reset();
  stub.fail.reviewInsert = 'place_reviews insert refused';
  stub.fail.removeVisit = 'delete refused too';

  let caught = null;
  try {
    await submitThroughMutation(PLACE_CARD_CARRIED, 5);
  } catch (error) {
    caught = error;
  }

  assert.equal(caught?.name, 'PlaceReviewWriteError', 'T-8: the rollback failure masked the original error');
  assert.equal(
    caught.message,
    'place_reviews insert refused',
    'T-8: the user must be shown why the REVIEW failed, not why the cleanup failed — the cleanup '
    + 'is not an action they took.',
  );
  assert.deepEqual(rows(), { visits: 1, reviews: 0 }, 'T-8: expected the visit to survive');
  assert.equal(
    caught.visitId,
    stub.db.user_visits[0].id,
    'T-8: the surviving row must be named on the error. It is the ONLY signal the mutation has '
    + 'that a real row exists, and it is what both drives the invalidation that settles the pill '
    + 'AND stops the retry re-stamping visited_at.',
  );

  // The retry must reuse it rather than record again.
  stub.fail.reviewInsert = null;
  stub.fail.removeVisit = null;
  const before = stub.db.invokes.length;
  await submitThroughMutation(PLACE_CARD_CARRIED, 5, caught.visitId);
  assert.equal(
    stub.db.invokes.length,
    before,
    'T-8: the retry called record-visit again and re-stamped visited_at on the user\'s own visit '
    + '— the #1661 X-3 drift.',
  );
  assert.deepEqual(rows(), { visits: 1, reviews: 1 }, 'T-8: the retry did not complete cleanly');

  // And the hook must actually react to that field, or the pill stays wrong.
  const hook = fs.readFileSync(FILES.reviewsHook, 'utf8');
  const onErrorAt = hook.indexOf('onError');
  assert.ok(onErrorAt > 0, 'T-8: usePlaceReviews has no onError');
  const onErrorBody = hook.slice(onErrorAt);
  assert.match(
    onErrorBody,
    /error instanceof PlaceReviewWriteError && error\.visitId/,
    'T-8: onError does not branch on a SURVIVING visit id, so a real leftover row leaves '
    + '`useHasVisited` stale and the pill at REST while the database says the user has been there.',
  );
  assert.match(
    onErrorBody,
    /confirmOnlineFromCompletedWrite\(\)[\s\S]{0,400}?invalidateQueries/,
    'T-8: #1661 — the connectivity belief must be confirmed BEFORE the invalidation or the '
    + 'refetch parks and the disagreement survives.',
  );
  assert.match(onErrorBody, /queryKey:\s*\['visits'\]/, "T-8: ['visits'] is not invalidated on the surviving-row branch");
  assert.match(onErrorBody, /savedCardKeys\.all/, 'T-8: the saved-card list is not invalidated');
});

test('T-9 a visit the user ALREADY had is never deleted on their behalf', async () => {
  // `record-visit` upserts on (user_id, experience_id) and `removeVisit` deletes by
  // the same pair, so the delete cannot tell "the row I just created" from "the row
  // that was already there". Only `visitCreated` can. Get this wrong and a failed
  // rating silently erases a visit the user marked weeks ago.
  stub.reset();
  await submitThroughMutation(PLACE_CARD_CARRIED, 4);
  assert.deepEqual(rows(), { visits: 1, reviews: 1 }, 'VACUITY: the pre-existing visit was not created');
  const originalVisitId = stub.db.user_visits[0].id;
  const deletesBefore = stub.db.deletes.length;

  // Now the user rates it again and the review is refused.
  stub.fail.reviewInsert = 'place_reviews insert refused';
  let caught = null;
  try {
    await submitThroughMutation(PLACE_CARD_CARRIED, 2);
  } catch (error) {
    caught = error;
  }

  assert.equal(caught?.name, 'PlaceReviewWriteError', 'T-9: the refusal did not surface');
  assert.equal(
    stub.db.user_visits.length,
    1,
    'T-9: the pre-existing visit was DELETED by a failed second rating. `record-visit` returned '
    + 'isNew:false, so that row predates this submit entirely and is not ours to undo.',
  );
  assert.equal(stub.db.user_visits[0].id, originalVisitId, 'T-9: the surviving row is not the original');
  assert.equal(
    stub.db.deletes.length,
    deletesBefore,
    'T-9: a compensating delete was issued against a row this attempt did not create.',
  );
  assert.equal(
    caught.visitId,
    originalVisitId,
    'T-9: the un-rolled-back visit must still be named so the retry does not re-stamp it.',
  );
  assert.equal(caught.visitCreated, false, 'T-9: visitCreated must be false for an upserted row');
});

test('T-10 a failure that is NOT a half-landed write is passed through untouched', async () => {
  // When the VISIT itself fails there is nothing to compensate. A rollback that
  // fired here would issue a delete against a row that was never written — the
  // delete-races-an-insert shape the confirm-time order exists to remove.
  stub.reset();
  stub.fail.recordVisit = 'record-visit exploded';

  let caught = null;
  try {
    await submitThroughMutation(PLACE_CARD_CARRIED, 3);
  } catch (error) {
    caught = error;
  }

  assert.ok(caught, 'T-10: the visit failure did not surface');
  assert.notEqual(
    caught.name,
    'PlaceReviewWriteError',
    'T-10: a failed VISIT was reported as a half-landed review write, so a retry would skip '
    + 'recording a visit that never happened.',
  );
  assert.deepEqual(rows(), { visits: 0, reviews: 0 }, 'T-10: something was written');
  assert.equal(stub.db.deletes.length, 0, 'T-10: a delete was issued against a row that never existed');
});

test('T-11 the rollback lives in the MUTATION, not the service — the residual, stated', async () => {
  // `rollBackHalfLandedVisit` is a separate entry point called by
  // `useSubmitVoluntaryPlaceReview`'s mutationFn. That is a deliberate design
  // choice (the write reports exactly what landed), but it means the guarantee is
  // NOT a property of `submitVoluntaryPlaceReview`. A second caller added later
  // inherits the orphan unless it composes the rollback too.
  stub.reset();
  stub.fail.reviewInsert = 'place_reviews insert refused';
  const request = store.placeReviewRequestFromCard(PLACE_CARD_CARRIED);
  await placeReviewService
    .submitVoluntaryPlaceReview({ userId: USER_ID, ...request, rating: 5 }, null)
    .catch(() => {});
  assert.deepEqual(
    rows(),
    { visits: 1, reviews: 0 },
    'T-11: this asserts the CURRENT behaviour so a change to it is visible. Calling the SERVICE '
    + 'directly still orphans a visit; only the mutation composes the rollback. If a second '
    + 'caller of `submitVoluntaryPlaceReview` is ever added, it must compose '
    + '`rollBackHalfLandedVisit` or move the composition into the service.',
  );

  const hook = fs.readFileSync(FILES.reviewsHook, 'utf8');
  assert.match(
    hook,
    /mutationFn:[\s\S]{0,400}?rollBackHalfLandedVisit/,
    'T-11: the mutation no longer composes the rollback, so nothing in the product does.',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 — the migration states the invariant the client cannot.
// ─────────────────────────────────────────────────────────────────────────────

test('T-12 the dedup migration replaces rather than refuses, and never touches the scheduled path', () => {
  const sql = fs.readFileSync(FILES.migration, 'utf8');

  // The trigger must exist AND be BEFORE INSERT — an AFTER trigger fires too late
  // to stop the unique index raising a 23505 the user cannot resolve.
  assert.match(
    sql,
    /CREATE TRIGGER[\s\S]{0,200}?BEFORE INSERT ON public\.place_reviews/,
    'T-12: the replace trigger is not a BEFORE INSERT trigger, so the unique index below it '
    + 'turns a legitimate re-rate into a raw 23505 — and `place_reviews` grants users no DELETE, '
    + 'so their first rating would be permanent.',
  );

  // History must not be falsified by a re-rate.
  assert.match(
    sql,
    /NEW\.created_at\s*:=\s*prior\.created_at/,
    'T-12: a re-rate does not carry the FIRST rating\'s created_at, so "rated since" would jump '
    + 'forward every time the user changed their mind.',
  );
  assert.match(
    sql,
    /IF NEW\.feedback_text IS NULL THEN[\s\S]{0,120}?NEW\.feedback_text\s*:=\s*prior\.feedback_text/,
    'T-12: a star-only re-rate silently discards feedback the user already wrote.',
  );

  // The scheduled path owns one review per calendar entry, in BOTH halves.
  assert.match(
    sql,
    /IF NEW\.calendar_entry_id IS NOT NULL THEN[\s\S]{0,60}?RETURN NEW/,
    'T-12: the trigger does not return early for a scheduled review, so the same place scheduled '
    + 'twice would lose the first review.',
  );
  const idxAt = sql.indexOf('CREATE UNIQUE INDEX');
  assert.ok(idxAt > 0, 'T-12: no unique index — the trigger alone is intent, not a guarantee');
  const idx = sql.slice(idxAt);
  assert.match(idx, /WHERE calendar_entry_id IS NULL/, 'T-12: the index predicate covers the scheduled path');
  assert.match(idx, /AND user_id IS NOT NULL/, 'T-12: the index predicate would collide legacy ownerless rows');
  assert.match(idx, /card_id <> ''/, 'T-12: the index predicate would collide rows with an empty card_id');

  // The cleanup must keep the OLDEST row, or applying it rewrites history.
  assert.match(
    sql,
    /ORDER BY created_at ASC, id ASC[\s\S]{0,200}?dupes\.rn > 1/,
    'T-12: the pre-index cleanup does not deterministically keep the oldest row in each group.',
  );

  // SECURITY DEFINER is load-bearing here (no user DELETE policy) and must be
  // pinned to the inserting user's own rows.
  const fnAt = sql.indexOf('CREATE OR REPLACE FUNCTION');
  const fnBody = sql.slice(fnAt, idxAt);
  assert.match(fnBody, /SECURITY DEFINER/, 'T-12: the trigger cannot delete without SECURITY DEFINER');
  assert.match(fnBody, /SET search_path = public, pg_temp/, 'T-12: a SECURITY DEFINER function without a pinned search_path');
  assert.match(
    fnBody,
    /DELETE FROM public\.place_reviews[\s\S]{0,200}?WHERE user_id = NEW\.user_id/,
    'T-12: the elevated DELETE is not pinned to NEW.user_id, so it could reach another user\'s rows.',
  );
});
