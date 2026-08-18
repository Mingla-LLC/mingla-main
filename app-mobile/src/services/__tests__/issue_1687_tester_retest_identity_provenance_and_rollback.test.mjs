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
 *    ─────────────────────────────────────────────────────────────────────────
 *    [TEST-MOD-APPROVED #1687] — REWORK 3 RETIRED PARAGRAPH 2. READ THIS FIRST.
 *    ─────────────────────────────────────────────────────────────────────────
 *
 *    Everything above this line about a rollback is now HISTORY, kept verbatim so
 *    the reversal is legible rather than quietly overwritten. THERE IS NO
 *    ROLLBACK. A failed review KEEPS the visit.
 *
 *    This suite's own FAIL is what forced it. Rework 2's rollback deleted
 *    `99081740` — a visit the demo account had made THREE DAYS earlier — because
 *    it trusted `useHasVisited`'s pre-tap answer, and that query is cached for ten
 *    minutes. Rework 1's rollback had failed in the opposite direction, trusting
 *    `record-visit`'s `isNew`, which is computed from `user_interactions` and says
 *    nothing about the `user_visits` row in front of it. Two guards, two defects,
 *    opposite directions, one cause: "is this visit mine to delete?" CANNOT be
 *    answered from the client, so on Seth's instruction the write stopped asking
 *    and stopped deleting.
 *
 *    The risks are not symmetric, and that is the whole argument. A visit with no
 *    review is TRUE, VISIBLE (the pill settles green — "You've been to X. Double
 *    tap to remove.") and USER-REVERSIBLE. A deleted visit is SILENT, WRONG and
 *    UNRECOVERABLE: `user_visits` has no history table and `place_reviews` grants
 *    users no DELETE. Given that choice, leave the recoverable thing alone.
 *
 *    FOUR OF MY OWN ASSERTIONS ENCODED THE DELETE AS THE CONTRACT and are replaced
 *    below, in place, under `[TEST-MOD-APPROVED #1687]`:
 *
 *      T-7  → T-7R. Asserted `{visits: 0}` and `deletes.length === 1`. It now
 *             asserts the inverse, and does it through a composition that
 *             re-composes EVERY export the service grows back, discovered by
 *             enumeration rather than by name.
 *      T-8  → T-8R. Called `placeReviewService.rollBackHalfLandedVisit`, which no
 *             longer exists, so it threw a TypeError before asserting anything.
 *             Its substance splits: the visitId-is-intact and the retry-reuses-it
 *             halves are covered by the implementor's B-9 and are NOT duplicated
 *             here. The halves nothing covers — the ORIGINAL error message, and
 *             the full `onError` recovery that replaces the delete — are what T-8R
 *             now asserts.
 *      T-9  → T-9R. Same TypeError. Its claim ("a pre-existing visit is never
 *             deleted") is now unconditionally true and IS proven, on a fixture
 *             that can actually fail, by the implementor's B-10 — so it is not
 *             re-asserted here. T-9's own fixture could not have proven it: it
 *             modelled `isNew` off its own `user_visits` array, which is the
 *             implementation's assumption rather than a test of it, and it
 *             survived four true reverts. That flaw is NOT carried forward. T-9R
 *             takes the job B-10 cannot do instead — it closes the hole a delete
 *             would actually come back through.
 *      T-11 → T-11R. Required the source to match
 *             `/mutationFn:[\s\S]{0,400}?rollBackHalfLandedVisit/` — the rollback
 *             composed in the mutation. That residual is GONE: the guarantee is
 *             now a property of the SERVICE, so T-11R asserts the inversion and
 *             censuses every call site in the repo.
 *
 *    T-1..T-6, T-10 and T-12 are untouched — identity provenance, the pass-through
 *    failure and the migration are unaffected by the reversal.
 *
 * Harness: the REAL `visitService`, the REAL `placeReviewService` and the REAL
 * store over an in-memory transport this file owns. `removeVisit` is reachable and
 * independently failable, which the first suite's stub could not do — and since
 * rework 3 that reachability is what lets T-7R drive the user's own un-toggle as
 * the negative control for "nothing here deleted anything".
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
 * [TEST-MOD-APPROVED #1687] rework 3 — comments OUT, string literals IN. Every
 * banned identifier T-9R and T-11R look for is discussed at length in
 * `placeReviewService`'s own header, so a raw `includes()` would fire on the
 * documentation that explains why the identifier is gone.
 */
function stripSourceComments(src) {
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
/**
 * [TEST-MOD-APPROVED #1687] rework 3 — the REAL `visitService`, so the ONE delete
 * that is still legitimate can be DRIVEN rather than described: the user's own
 * un-toggle of a settled pill. "Leave the visit, the user can undo it" is the
 * entire argument for not deleting, so T-7R runs that undo on the same transport
 * its zeros are read from.
 */
let visitService;

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
  visitService = await import(pathToFileURL(visitPath).href);
});

after(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

function rows() {
  return { visits: stub.db.user_visits.length, reviews: stub.db.place_reviews.length };
}

/**
 * [TEST-MOD-APPROVED #1687] rework 3 — the shipped `mutationFn` is now the bare
 * write, so a helper written as the bare write would be correct AND useless: a
 * rollback reintroduced tomorrow would stop being EXERCISED rather than start
 * failing. Green suite, deleted visits. That is the unfalsifiable shape this
 * file's own T-9 fell into.
 *
 * So this helper deliberately re-composes any compensating entry point the
 * service grows back — and, unlike the implementor's equivalent, it finds one by
 * ENUMERATION rather than by name. `rollBackHalfLandedVisit` was one name; a
 * revert is free to pick another. Every export that is not on the known list
 * below is treated as a candidate compensator and CALLED with the two arguments
 * a compensator takes, so it runs against the same transport the assertions
 * read. A renamed rollback is therefore driven, not missed.
 *
 * Exceptions that are not compensators, and why: `submitVoluntaryPlaceReview` is
 * the write itself, and `PlaceReviewWriteError` is a class (calling it without
 * `new` throws before it can do anything). Both are asserted present, or the
 * sweep is skipping the module rather than sweeping it.
 */
const NOT_A_COMPENSATOR = new Set(['submitVoluntaryPlaceReview', 'PlaceReviewWriteError']);

function compensatorCandidates() {
  const names = Object.keys(placeReviewService);
  for (const known of NOT_A_COMPENSATOR) {
    assert.ok(
      names.includes(known),
      `VACUITY: placeReviewService no longer exports \`${known}\`, so this sweep is enumerating `
      + 'something other than the module under test and "no compensator found" means nothing.',
    );
  }
  return names.filter(
    (n) => !NOT_A_COMPENSATOR.has(n) && typeof placeReviewService[n] === 'function',
  );
}

async function mutationFn(input, recordedVisitId = null) {
  try {
    return await placeReviewService.submitVoluntaryPlaceReview(input, recordedVisitId);
  } catch (error) {
    let outgoing = error;
    for (const name of compensatorCandidates()) {
      // Whatever it is, RUN it. If it deletes, the assertions below see the
      // delete; if it throws or returns something useless, that is fine — the
      // point is that it was exercised rather than silently absent.
      try {
        const replacement = await placeReviewService[name](outgoing, input.cardId);
        if (replacement instanceof Error) outgoing = replacement;
      } catch (thrown) {
        if (thrown instanceof Error) outgoing = thrown;
      }
    }
    throw outgoing;
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
// 2 — [TEST-MOD-APPROVED #1687] rework 3: THE VISIT STAYS. No rollback exists.
// ─────────────────────────────────────────────────────────────────────────────

test('T-7R a refused review KEEPS the visit — and a compensator under ANY name is run, not missed', async () => {
  // THE INVERSION OF MY OWN T-7, which asserted `{visits: 0}` and
  // `deletes.length === 1`. T-7 stated the compensating delete as the contract;
  // the contract changed, on Seth's instruction, after this suite's previous FAIL
  // proved that same delete destroyed a three-day-old visit (`99081740`).
  //
  // The single-path version of this claim is the implementor's B-9 and is not
  // re-litigated here. What this test adds is the thing B-9's helper cannot do:
  // it composes the write with EVERY export the service carries, found by
  // enumeration, so the guarantee is name-independent. B-9's helper re-composes
  // exactly one literal name (`rollBackHalfLandedVisit`); a revert that calls the
  // same delete `undoStrandedVisit` is not run by it at all — verified by
  // injection, and the reason this helper enumerates.
  stub.reset();
  stub.fail.reviewInsert =
    'insert or update on table "place_reviews" violates foreign key constraint '
    + '"place_reviews_place_pool_id_fkey"';

  const swept = compensatorCandidates();
  assert.deepEqual(
    swept,
    [],
    'T-7R: placeReviewService exports something beyond the write and its error — '
    + `[${swept.join(', ')}]. The sweep above CALLED it, so if it deletes the assertions below `
    + 'have already caught it. This assertion is the second half: a compensating entry point is '
    + 'not supposed to exist at all. If one is genuinely needed it must read `user_visits` fresh '
    + 'at write time (#1694), not guess from a client signal, and this is where to argue it.',
  );

  let caught = null;
  try {
    await submitThroughMutation(PLACE_CARD_CARRIED, 5);
  } catch (error) {
    caught = error;
  }

  assert.equal(caught?.name, 'PlaceReviewWriteError', 'T-7R: the refusal did not surface');
  assert.deepEqual(
    rows(),
    { visits: 1, reviews: 0 },
    'T-7R: THE VISIT WAS DELETED. Nothing on this path may remove a `user_visits` row. The client '
    + 'cannot tell whose row it is looking at — `record-visit`\'s `isNew` describes '
    + '`user_interactions` and `useHasVisited` is cached for ten minutes — and a wrong answer in '
    + 'the delete direction is silent, permanent and invisible to the user. A leftover visit is '
    + 'none of those things.',
  );
  assert.equal(
    stub.db.deletes.length,
    0,
    'T-7R: A DELETE WAS ISSUED against user_visits by a failed review. Whatever issued it '
    + '— the service, the composition, or an export added since — is the defect.',
  );
  assert.equal(
    caught.visitId,
    stub.db.user_visits[0].id,
    'T-7R: the error does not name the row that survived. That id is the only signal the mutation '
    + 'has that a real row exists, and it is what licenses the invalidation that settles the pill.',
  );
  assert.equal(
    caught.visitCreated,
    undefined,
    'T-7R: `visitCreated` is back on the error. It existed only to answer "is this row mine to '
    + 'delete", which is the question rework 3 removed; its return is a rollback growing back.',
  );

  // NEGATIVE CONTROL — the zeros above must be zeros-because-nothing-deleted, and
  // the leftover must really be retractable, because "the user can undo it" is
  // the entire justification for leaving it. Both, on the same transport.
  await visitService.removeVisit(PLACE_CARD_CARRIED.id);
  assert.deepEqual(
    rows(),
    { visits: 0, reviews: 0 },
    'T-7R: the user\'s own un-toggle no longer clears the visit. If removeVisit stops working the '
    + 'leftover really is stranded and this whole design needs revisiting.',
  );
  assert.equal(
    stub.db.deletes.length,
    1,
    'VACUITY: a real delete does not register on this transport, so `deletes.length === 0` above '
    + 'proves nothing at all.',
  );
});

test('T-8R the user is told why THEIR action failed, and the recovery that replaced the delete is whole', async () => {
  // T-8 asked what happens when the ROLLBACK itself fails. There is no rollback,
  // so the question is retired — but two of its four claims survive the reversal
  // and one of those is covered by nobody.
  //
  // WHAT IS ALREADY COVERED, AND DELIBERATELY NOT REPEATED HERE:
  //   * the surviving row is named on the error  → implementor B-9 (and T-7R
  //     above asserts it as the anchor of its own error path).
  //   * the retry reuses that id instead of calling record-visit again, so
  //     `visited_at` is not re-stamped (#1661 X-3) → implementor B-9, which
  //     counts `db.invokes` across the retry exactly as T-8 did.
  //
  // WHAT NOTHING COVERS, which is why this test still exists — I checked the
  // implementor's suite rather than taking the claim:
  //   * `caught.message`. No assertion anywhere pins that the error carries the
  //     REVIEW's message. Constitution 3: the failure reported must be the one
  //     that happened, or the console and Sentry describe the wrong event.
  //   * `savedCardKeys` appears NOWHERE in the implementor's file. S-6 checks the
  //     error branch invalidates *something*; it does not check it invalidates
  //     BOTH keys, and the saved-card list carries the same visited state.
  //   * the #1661 ordering ON THE ERROR BRANCH. S-4 pins
  //     confirmOnline-before-invalidate for `onSuccess` only. The error branch is
  //     where it is hardest to justify and most load-bearing: it is the whole
  //     reason the leftover becomes visible instead of stranded.
  stub.reset();
  stub.fail.reviewInsert = 'place_reviews insert refused';

  let caught = null;
  try {
    await submitThroughMutation(PLACE_CARD_CARRIED, 5);
  } catch (error) {
    caught = error;
  }

  assert.equal(caught?.name, 'PlaceReviewWriteError', 'T-8R: the refusal did not surface');
  assert.equal(
    caught.message,
    'place_reviews insert refused',
    'T-8R: the error no longer carries the reason the REVIEW was refused. The user took one '
    + 'action; the failure they are shown, and the one written to the console and Sentry, must be '
    + 'the failure of that action — not of something the app decided to do afterwards.',
  );

  // The recovery, in full. A leftover visit is acceptable ONLY because the deck
  // settles to it; that settling is these four lines and nothing else.
  //
  // DELIMITED PROPERLY, AND THIS MATTERS: the retired T-8 sliced the RAW file at
  // `indexOf('onError')`, and the mutationFn's own comment says "`onError` below
  // makes the screen agree with it" — three lines ABOVE `onSuccess`. So T-8's
  // "onError body" was the whole `onSuccess` block, which invalidates the same
  // two keys after the same `confirmOnlineFromCompletedWrite()`. All four of its
  // assertions passed off onSuccess and could not see the error branch at all.
  // Verified: deleting `savedCardKeys.all` from onError, and inverting the #1661
  // ordering there, both left the old slice green. Comments out first, anchor on
  // the property key, and prove the slice excludes onSuccess.
  const hook = stripSourceComments(fs.readFileSync(FILES.reviewsHook, 'utf8'));
  const onErrorAt = hook.indexOf('onError:');
  assert.ok(onErrorAt > 0, 'T-8R: usePlaceReviews has no onError');
  const onErrorBody = hook.slice(onErrorAt);
  assert.ok(
    !onErrorBody.includes('onSuccess'),
    'VACUITY: the extracted onError body still contains onSuccess, which invalidates the same two '
    + 'keys in the same order — every assertion below would pass off the SUCCESS path while the '
    + 'error path was broken. This is exactly how the retired T-8 was vacuous.',
  );
  assert.ok(
    onErrorBody.includes('PlaceReviewWriteError'),
    'VACUITY: the extracted onError body does not mention PlaceReviewWriteError, so the slice is '
    + 'not the error handler.',
  );
  assert.match(
    onErrorBody,
    /error instanceof PlaceReviewWriteError && error\.visitId/,
    'T-8R: onError does not branch on a SURVIVING visit id. Without that branch the leftover row '
    + 'exists, `useHasVisited` still says it does not, and the pill sits at REST while the '
    + 'database disagrees — the leftover becomes exactly the silent orphan the delete existed to '
    + 'prevent, which would make the whole rework-3 argument false.',
  );
  const confirmAt = onErrorBody.indexOf('confirmOnlineFromCompletedWrite()');
  const invalidateAt = onErrorBody.indexOf('invalidateQueries');
  assert.ok(confirmAt > 0, 'T-8R: the error branch never confirms connectivity');
  assert.ok(
    confirmAt < invalidateAt,
    'T-8R: #1661 — on the ERROR branch the connectivity belief must be confirmed BEFORE the '
    + 'invalidations. Invalidating first parks the refetch behind a false offline belief and the '
    + 'pill never settles, so the user is left with a visit they cannot see and cannot retract. '
    + 'S-4 pins this ordering for onSuccess only.',
  );
  assert.match(
    onErrorBody,
    /queryKey:\s*\['visits'\]/,
    "T-8R: ['visits'] is not invalidated on the surviving-row branch — that prefix is what "
    + 'useHasVisited sits under, and it is what flips the pill to settled.',
  );
  assert.match(
    onErrorBody,
    /savedCardKeys\.all/,
    'T-8R: the saved-card list is not invalidated on the surviving-row branch, so the same visit '
    + 'reads as un-visited everywhere except the deck. `savedCardKeys` is asserted in no other '
    + 'test in this work item.',
  );
});

test('T-9R the delete cannot come back under another name, in another file — the write path is closed', () => {
  // T-9 asserted "a visit the user ALREADY had is never deleted on their behalf".
  // That claim SURVIVES the contract change — it is now unconditionally true —
  // and it is proven by the implementor's B-10 on a three-day-old fixture where
  // BOTH client signals lie at once (`useHasVisited` stale false, `record-visit`
  // isNew:true), with vacuity guards that fail if the isNew:true branch was not
  // taken. B-11's second case walks it again in the sweep. So it is covered, and
  // this test does not re-assert it.
  //
  // T-9's OWN fixture could never have proven it, which I named against myself in
  // the last report: it derived `isNew` from its own `user_visits` array, so it
  // agreed with the implementation's assumption instead of testing it, and it
  // passed against four true reverts. That flaw is not carried forward — B-10's
  // harness derives `isNew` from `user_interactions`, which is where
  // `record-visit` actually computes it (record-visit/index.ts:113-148).
  //
  // WHAT T-9R DOES INSTEAD is the job nothing else does. The behavioural tests —
  // mine and the implementor's — can only see deletes reachable from
  // `submitVoluntaryPlaceReview`. S-6 bans the machinery, but in exactly TWO
  // named files. I injected the gap and confirmed it: a module
  // `services/placeVisitRecovery.ts` exporting `clearStrandedVisit`, imported by
  // `usePlaceReviews.ts` and called inside `onError`, deletes the user's visit on
  // every failed review — and the implementor's 21 tests and tester suite 1 stay
  // GREEN, all 29 of them, because neither of S-6's two files mentions
  // `removeVisit` and the mutationFn is still the bare write.
  //
  // So the unit that must be pinned is the WRITE PATH, not two filenames: the
  // transitive relative-import closure of the mutation and the service. It is
  // eight modules. A ninth is where a delete comes back.
  const APP_MOBILE = appMobile;
  const ENTRY_POINTS = ['src/hooks/usePlaceReviews.ts', 'src/services/placeReviewService.ts'];

  /**
   * The two modules on this path that legitimately OWN a `user_visits` delete.
   * `visitService.removeVisit` is the delete; `useVisits.useRemoveVisit` is the
   * deck pill's un-toggle, which is the user-facing retraction the whole design
   * depends on. They are reachable because the write path imports OTHER things
   * from them — pinned exactly, below.
   */
  const DELETE_OWNERS = new Set(['src/services/visitService.ts', 'src/hooks/useVisits.ts']);

  const EXPECTED_CLOSURE = [
    // [TEST-MOD-APPROVED #2186] appVersionIdentity.ts joined this closure. It is
    // ADMITTED, not tolerated — traced before adding, and it is not the thing T-9R
    // exists to catch.
    //
    // How it arrived: #2075 ("Block unsupported native app versions") added a
    // version header to the SHARED client —
    //     src/services/supabase.ts:4
    //       import { getNativeAppVersionHeaders } from './appVersionIdentity';
    // — and every file in this write path imports './supabase'. So it entered
    // transitively, through the one module they all share, without #2075 editing
    // any file this gate names.
    //
    // Why it is safe: it contains NO delete or remove operation of any kind. It is
    // semver parsing, platform detection and request headers
    // (getNativeAppPlatform / getInstalledNativeVersion / APP_VERSION_APP_ID).
    // T-9R's stated fear is "a new `placeVisitRecovery`-style module wired into
    // `onError` under a name nobody banned" — a reintroduced delete. This is not
    // that, and DELETE_OWNERS above is unchanged, so the delete ban still binds
    // exactly the two files it always bound.
    'src/hooks/queryKeys.ts',
    'src/hooks/usePlaceReviews.ts',
    'src/hooks/useVisits.ts',
    'src/services/appVersionIdentity.ts',
    'src/services/placeReviewService.ts',
    'src/services/supabase.ts',
    'src/services/visitService.ts',
    'src/utils/breadcrumbs.ts',
    'src/utils/logger.ts',
  ];

  const resolveSpec = (fromRel, spec) => {
    if (!spec.startsWith('.')) return null;
    const base = path.normalize(path.join(path.dirname(fromRel), spec));
    for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
      if (fs.existsSync(path.join(APP_MOBILE, base + ext))) return base + ext;
    }
    return null;
  };

  const closure = new Set();
  const queue = [...ENTRY_POINTS];
  while (queue.length) {
    const rel = queue.pop();
    if (closure.has(rel)) continue;
    closure.add(rel);
    const src = fs.readFileSync(path.join(APP_MOBILE, rel), 'utf8');
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const next = resolveSpec(rel, m[1]);
      if (next) queue.push(next);
    }
  }

  assert.ok(
    closure.has('src/services/visitService.ts') && closure.has('src/hooks/useVisits.ts'),
    'VACUITY: the walker did not even reach the two modules it is meant to be reasoning about, so '
    + 'the closure below is not the write path and every assertion here is empty.',
  );
  assert.deepEqual(
    [...closure].sort(),
    EXPECTED_CLOSURE,
    'T-9R: A MODULE JOINED OR LEFT THE VOLUNTARY REVIEW WRITE PATH. This is the exact shape a '
    + 'reintroduced delete takes once S-6\'s two-file ban is in place: not `removeVisit` in '
    + '`placeReviewService`, but a new `placeVisitRecovery`-style module wired into `onError` '
    + 'under a name nobody banned. Injected and confirmed: that change passes all 29 other tests '
    + 'in this work item. If the new module genuinely belongs here, add it AND satisfy the delete '
    + 'ban below.',
  );

  for (const rel of EXPECTED_CLOSURE) {
    if (DELETE_OWNERS.has(rel)) continue;
    const src = stripSourceComments(fs.readFileSync(path.join(APP_MOBILE, rel), 'utf8'));
    assert.ok(
      !/\bremoveVisit\b/.test(src),
      `T-9R: \`removeVisit\` is reachable from ${rel}, which is on the voluntary review write `
      + 'path. Two attempts to decide "is this visit mine to delete" shipped defects in opposite '
      + 'directions; a wrong answer is silent and unrecoverable. A rollback that genuinely belongs '
      + 'needs a fresh read of user_visits at write time (#1694), not another client-side guess.',
    );
    assert.ok(
      !/from\(\s*['"]user_visits['"]\s*\)[\s\S]{0,200}?\.delete\(/.test(src),
      `T-9R: ${rel} deletes from user_visits directly. Same rule, one layer down — routing around `
      + '`removeVisit` is not a way to satisfy the assertion above.',
    );
  }

  // The two owners are on the path only because the write path imports something
  // ELSE from them. Pin exactly what, or "owner" becomes a blanket exemption.
  const service = stripSourceComments(fs.readFileSync(FILES.placeReviewService, 'utf8'));
  assert.match(
    service,
    /import\s*\{\s*recordVisit\s*\}\s*from\s*'\.\/visitService'/,
    'T-9R: placeReviewService no longer imports EXACTLY `recordVisit` from visitService. The '
    + 'narrow import is what stops the delete being one identifier away.',
  );
  const hook = stripSourceComments(fs.readFileSync(FILES.reviewsHook, 'utf8'));
  assert.match(
    hook,
    /import\s*\{\s*confirmOnlineFromCompletedWrite\s*\}\s*from\s*'\.\/useVisits'/,
    'T-9R: usePlaceReviews no longer imports EXACTLY `confirmOnlineFromCompletedWrite` from '
    + 'useVisits. `useRemoveVisit` lives in that module; a widened import is how the mutation '
    + 'reaches a delete without any banned identifier appearing in either file.',
  );
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

test('T-11R the guarantee is a property of the SERVICE now, so every caller inherits it', async () => {
  // T-11 recorded a RESIDUAL: the rollback lived in the mutation, so
  // `submitVoluntaryPlaceReview`'s own behaviour was to orphan the visit, and a
  // second caller added later would inherit the orphan unless it remembered to
  // compose the rollback too. It required the source to match
  // `/mutationFn:[\s\S]{0,400}?rollBackHalfLandedVisit/`.
  //
  // The residual is GONE, and this is the one place the reversal is strictly
  // better rather than merely different: the correct behaviour is no longer
  // composed by the caller, it IS the service. A second caller now inherits it by
  // doing nothing. So T-11R asserts the inversion — and, because "inherits by
  // doing nothing" is only a guarantee while nobody wraps it, censuses the call
  // sites instead of pinning one file's mutationFn (which S-6 already does).
  stub.reset();
  stub.fail.reviewInsert = 'place_reviews insert refused';
  const request = store.placeReviewRequestFromCard(PLACE_CARD_CARRIED);

  let direct = null;
  await placeReviewService
    .submitVoluntaryPlaceReview({ userId: USER_ID, ...request, rating: 5 }, null)
    .catch((error) => { direct = error; });

  assert.equal(direct?.name, 'PlaceReviewWriteError', 'T-11R: the direct call did not surface the refusal');
  assert.deepEqual(
    rows(),
    { visits: 1, reviews: 0 },
    'T-11R: the SERVICE deleted the visit. Nothing composed a rollback here — this is the bare '
    + 'service — so a delete at this level is the service itself deciding a row is disposable.',
  );
  assert.equal(
    stub.db.deletes.length,
    0,
    'T-11R: the bare service issued a delete against user_visits.',
  );
  assert.equal(
    direct.visitId,
    stub.db.user_visits[0].id,
    'T-11R: the bare service does not name the surviving row, so a caller that is not the hook '
    + 'has no way to retry without re-stamping visited_at.',
  );

  // T-7R drove the SAME failure through the full composition. Both must land in
  // the same state, or "the guarantee is a property of the service" is false and
  // the caller is still the thing that decides.
  const throughComposition = { visits: stub.db.user_visits.length, deletes: stub.db.deletes.length };
  stub.reset();
  stub.fail.reviewInsert = 'place_reviews insert refused';
  await submitThroughMutation(PLACE_CARD_CARRIED, 5).catch(() => {});
  assert.deepEqual(
    { visits: stub.db.user_visits.length, deletes: stub.db.deletes.length },
    throughComposition,
    'T-11R: the composed path and the bare service now disagree about a refused review. Whichever '
    + 'one deletes is the defect; the point of moving the guarantee into the service was that a '
    + 'caller can no longer change the answer.',
  );

  // THE CENSUS. `submitVoluntaryPlaceReview` must have exactly one product call
  // site, and it must be the bare mutationFn — a second caller wrapping it in its
  // own try/catch is precisely how the composed rollback would return, and it
  // would live in a file S-6 does not read.
  const callers = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const src = stripSourceComments(fs.readFileSync(full, 'utf8'));
      // A CALL, not the declaration — `placeReviewService` obviously contains its
      // own name, and counting that would make this assertion about nothing.
      if (/(?<!function\s)\bsubmitVoluntaryPlaceReview\s*\(/.test(src)) {
        callers.push(path.relative(appMobile, full));
      }
    }
  };
  walk(path.join(appMobile, 'src'));
  walk(path.join(appMobile, 'app'));

  assert.deepEqual(
    callers.sort(),
    ['src/hooks/usePlaceReviews.ts'],
    'T-11R: `submitVoluntaryPlaceReview` gained or lost a product call site. Exactly one caller is '
    + 'what makes the no-delete guarantee checkable at all; a second one is where a compensating '
    + 'try/catch comes back, in a file S-6\'s two-file ban does not read. If a second caller is '
    + 'genuinely needed, it inherits the guarantee for free — but say so here.',
  );
  const hook = stripSourceComments(fs.readFileSync(FILES.reviewsHook, 'utf8'));
  assert.ok(
    !/try\s*\{[\s\S]{0,300}?submitVoluntaryPlaceReview/.test(hook),
    'T-11R: the one call site wraps the write in a try/catch again. That wrapper is where both '
    + 'deleted-visit defects lived; the mutation reports what landed and `onError` (T-8R) is the '
    + 'entire recovery.',
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
