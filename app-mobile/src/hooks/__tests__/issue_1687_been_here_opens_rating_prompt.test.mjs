/**
 * #1687 — "Been here" opens the rating prompt. IMPLEMENTOR happy-path regression.
 *
 * WHAT THIS PROTECTS, in Seth's words (issue #1687, comment 5209318118):
 *
 *   "when you click been there, it triggers the pop up, and in this exceptional
 *    case, it has a cancel icon up top because in this case it is voluntarily and
 *    also because it may be a mistake. After the review it then says thank you."
 *
 * The property that actually matters is a NEGATIVE one — a cancelled tap must
 * leave NOTHING behind — and a negative property is exactly the kind a source
 * grep cannot check. So the first half of this file is behavioural: it loads the
 * REAL store, the REAL `visitService` and the REAL `placeReviewService`, points
 * them at an in-memory database that records every write, and drives them in the
 * exact order the UI does. `user_visits` and `place_reviews` are counted after the
 * tap, after the cancel, and after the submit, on the SAME transport — so the
 * zeros are provably zeros-because-nothing-wrote, not zeros-because-broken (B-3
 * is the negative control for B-1 and B-2: the same fake server that stayed empty
 * then holds two rows now).
 *
 * The second half is structural, and it exists because the behavioural half can
 * only reach the non-JSX layers: it pins the seams that carry the contract into
 * the components — that the tap holds no record mutation, that the modal opens on
 * the rating step with a close icon, and that there is still exactly ONE
 * `PostExperienceModal` in the app (ORCH-1063: a second RN <Modal> instance
 * unmounted mid-presentation froze the entire app on device).
 *
 * WHY RECORDING HAPPENS ON CONFIRM, which is what B-1/B-2 pin: writing on tap and
 * deleting on cancel means two round trips against a write whose COLD path
 * measures 11.8 seconds (warm: 0.24s), so the delete can be issued against a row
 * that has not landed. #1618, #1642 and #1661 are all that same control; this is
 * deliberately not a fourth.
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

const SRC = {
  store: path.join(appMobile, 'src/store/placeReviewRequestStore.ts'),
  visitService: path.join(appMobile, 'src/services/visitService.ts'),
  placeReviewService: path.join(appMobile, 'src/services/placeReviewService.ts'),
  swipeable: path.join(appMobile, 'src/components/SwipeableCards.tsx'),
  modal: path.join(appMobile, 'src/components/PostExperienceModal.tsx'),
  plate: path.join(appMobile, 'src/components/deckCardPlate.tsx'),
  index: path.join(appMobile, 'app/index.tsx'),
  hook: path.join(appMobile, 'src/hooks/usePlaceReviews.ts'),
  // #1687 rework — the seams the P1/P2 fixes added.
  deckService: path.join(appMobile, 'src/services/deckService.ts'),
  scheduledCheck: path.join(appMobile, 'src/hooks/usePostExperienceCheck.ts'),
};

/** #1687 rework (P2-1) — the schema half, outside app-mobile. */
const REVIEW_UNIQUENESS_MIGRATION = path.resolve(
  appMobile,
  '../supabase/migrations/20270223001687_issue_1687_one_voluntary_review_per_place.sql',
);

const read = (key) => fs.readFileSync(SRC[key], 'utf8');

/** Comments out, string literals in — the same discipline as the #1593/#1609 guards. */
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
// The harness: real modules, fake transport.
// ─────────────────────────────────────────────────────────────────────────────

let tmpDir;
let store;
let placeReviewService;
let supabaseStub;
/**
 * #1687 rework 3 — the REAL `visitService`, imported so the tests can drive the
 * ONE delete that is still legitimate: the user's own un-toggle of a settled
 * pill. The "a visit with no review is recoverable" argument is only true if that
 * path works, so B-9 drives it rather than asserting it.
 */
let visitService;

/** A single place card as the deck actually serves it: `id` IS the place_pool id. */
const SINGLE_CARD = {
  id: 'cc3213ba-2491-4bdb-8488-f5e0c3e2b03e',
  title: 'Dram & Draught',
  category: 'Drinks',
  image: 'https://example.invalid/dram.jpg',
  address: '623 Iredell Dr, Raleigh',
  placeId: 'ChIJO0VhT-vzrIkRZ31FGBdp1EQ',
  priceRange: '$$',
};

/** A curated card. Its id is not a place at all, so it must yield no place_pool_id. */
const CURATED_CARD = {
  id: 'curated_first-date_1785970643499_hqmpf9',
  title: 'Regal Crossroads → Rey\'s Restaurant',
  category: 'First Date',
  image: 'https://example.invalid/curated.jpg',
  priceRange: '$$$',
};

const USER_ID = '6c61590c-4e8e-4040-bd7c-29870ba6d736';

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue1687-'));

  // — the in-memory database + the client that writes to it —
  const supabasePath = path.join(tmpDir, 'supabaseStub.mjs');
  fs.writeFileSync(
    supabasePath,
    `
export const db = { user_visits: [], place_reviews: [], invokes: [], user_interactions: [] };
export const control = {
  reviewInsertFails: false,
  recordVisitFails: false,
  // #1687 rework 2 (P1-2) — record-visit:143 swallows a failed interaction insert
  // as non-fatal and STILL reports isNew: true. Modelled so the divergence this
  // harness previously could not express is drivable.
  interactionInsertFails: false,
};
export function resetDb() {
  db.user_visits.length = 0;
  db.place_reviews.length = 0;
  db.invokes.length = 0;
  db.user_interactions.length = 0;
  control.reviewInsertFails = false;
  control.recordVisitFails = false;
  control.interactionInsertFails = false;
}

/**
 * The state an UN-TOGGLE leaves: removeVisit deletes from user_visits only
 * (visitService.ts:167), so the user_interactions row survives it. 3 places in
 * production are in exactly this state today.
 */
export function seedOrphanInteraction(experienceId) {
  interactionSeq += 1;
  db.user_interactions.push({
    id: 'interaction-' + interactionSeq,
    experience_id: experienceId,
    interaction_type: 'visit',
  });
}

/**
 * #1687 rework 3 — A VISIT THE USER ALREADY HAD, put there by something other
 * than the deck in front of us: another device, an earlier session, or this one
 * before useHasVisited's TEN-MINUTE cache (useVisits.ts:80) was last filled.
 * The tester created exactly this on the demo account — visit \`99081740\`, dated
 * three days back — and rework 2 destroyed it.
 *
 * Seeded WITHOUT a user_interactions row on purpose: that is how production
 * reaches the state where record-visit reports \`isNew: true\` for a row that
 * already existed (record-visit:143 swallows a failed interaction insert). So
 * this fixture is a lie in BOTH available signals at once — the server flag says
 * "new", and a stale deck would say "no visit" — which is precisely why neither
 * may authorise a delete.
 */
export function seedPreExistingVisit(experienceId, visitedAt) {
  visitSeq += 1;
  const row = {
    id: 'pre-existing-visit-' + visitSeq,
    experience_id: experienceId,
    card_data: { title: 'seeded by another client' },
    visited_at: visitedAt,
    source: 'manual',
  };
  db.user_visits.push(row);
  return row.id;
}

// #1687 rework — the DELETE side of user_visits, so the compensating rollback
// runs against the same in-memory database the forward write does. Added, never
// swapped in: everything above is untouched and B-1..B-6 still drive it.
export const deletes = [];
export const rollbackControl = { fails: false };
export function resetRollback() {
  deletes.length = 0;
  rollbackControl.fails = false;
}

let visitSeq = 0;
let reviewSeq = 0;
let interactionSeq = 0;

export const supabase = {
  functions: {
    async invoke(name, options) {
      db.invokes.push({ name, body: options?.body });
      if (name !== 'record-visit') {
        return { data: null, error: { message: 'unexpected function ' + name } };
      }
      if (control.recordVisitFails) {
        return { data: null, error: { message: 'record-visit exploded' } };
      }
      const { experienceId, cardData } = options.body;

      // #1687 rework 2 (P1-2) — THIS IS NOW THE REAL SHAPE OF record-visit, and
      // the previous model of it is what let the bug through. The function does
      // TWO independent things, and the flag it returns describes the SECOND.
      //
      // Step 1: UPSERT user_visits on (user_id, experience_id). The result is
      // consumed for the row id ONLY (record-visit/index.ts:88-101) — whether it
      // inserted or updated is never looked at and never returned.
      const existing = db.user_visits.find((r) => r.experience_id === experienceId);
      let visitId;
      if (existing) {
        existing.visited_at = new Date().toISOString();
        visitId = existing.id;
      } else {
        visitSeq += 1;
        const row = {
          id: 'visit-' + visitSeq,
          experience_id: experienceId,
          card_data: cardData,
          visited_at: new Date().toISOString(),
          source: 'manual',
        };
        db.user_visits.push(row);
        visitId = row.id;
      }

      // Step 2: isNew comes from a DIFFERENT TABLE — whether a user_interactions
      // row of type 'visit' already exists (record-visit/index.ts:113-148). The
      // old harness returned it off db.user_visits, so it agreed with the
      // implementation's assumption instead of testing it, and B-10 could not
      // fail. The two tables drift: removeVisit deletes only from user_visits, and
      // the interaction insert below is swallowed when it fails.
      const existingInteraction = db.user_interactions.find(
        (r) => r.experience_id === experienceId && r.interaction_type === 'visit',
      );
      let isNew = true;
      if (existingInteraction) {
        isNew = false;
      } else if (!control.interactionInsertFails) {
        interactionSeq += 1;
        db.user_interactions.push({
          id: 'interaction-' + interactionSeq,
          experience_id: experienceId,
          interaction_type: 'visit',
        });
      }
      // record-visit:143 — "Non-fatal: visit was recorded, interaction tracking
      // failed". isNew stays true even though nothing was inserted anywhere new.

      return { data: { visitId, isNew }, error: null };
    },
  },
  auth: {
    async getUser() {
      return { data: { user: { id: '${USER_ID}' } }, error: null };
    },
  },
  from(table) {
    return {
      delete() {
        const filters = {};
        const builder = {
          eq(column, value) { filters[column] = value; return builder; },
          then(resolve) {
            if (table !== 'user_visits') {
              return resolve({ error: { message: 'unexpected delete on ' + table } });
            }
            if (rollbackControl.fails) {
              return resolve({ error: { message: 'delete refused' } });
            }
            const kept = db.user_visits.filter(
              (r) => r.experience_id !== filters.experience_id,
            );
            const removed = db.user_visits.length - kept.length;
            db.user_visits.length = 0;
            db.user_visits.push(...kept);
            deletes.push({ table, filters, removed });
            return resolve({ error: null });
          },
        };
        return builder;
      },
      insert(row) {
        return {
          select() {
            return {
              async single() {
                if (table !== 'place_reviews') {
                  return { data: null, error: { message: 'unexpected table ' + table } };
                }
                if (control.reviewInsertFails) {
                  return { data: null, error: { message: 'place_reviews insert refused' } };
                }
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

  // — the REAL visitService, over the fake client. Its operation-level bound
  //   (#1618) and its supabase.functions.invoke('record-visit') call are the real
  //   shipped lines; only the transport underneath is ours. —
  const visitPath = path.join(tmpDir, 'visitService.mjs');
  {
    const raw = stripTypeScriptTypes(read('visitService'), { mode: 'strip' });
    const rewritten = raw.replace(
      "from './supabase'",
      `from ${JSON.stringify(pathToFileURL(supabasePath).href)}`,
    );
    assert.notEqual(rewritten, raw, 'VACUITY: visitService\'s supabase import was not rewritten');
    assert.ok(
      !rewritten.includes("from './supabase'"),
      'VACUITY: a real ./supabase import survived in visitService',
    );
    fs.writeFileSync(visitPath, rewritten);
  }

  // — the REAL placeReviewService, over the same fake client and that visitService —
  const prsPath = path.join(tmpDir, 'placeReviewService.mjs');
  {
    const raw = stripTypeScriptTypes(read('placeReviewService'), { mode: 'strip' });
    const rewritten = raw
      .replace("from './supabase'", `from ${JSON.stringify(pathToFileURL(supabasePath).href)}`)
      .replace("from './visitService'", `from ${JSON.stringify(pathToFileURL(visitPath).href)}`);
    assert.notEqual(rewritten, raw, 'VACUITY: placeReviewService\'s imports were not rewritten');
    for (const spec of ['./supabase', './visitService']) {
      assert.ok(
        !rewritten.includes(`from '${spec}'`),
        `VACUITY: the '${spec}' import survived in placeReviewService`,
      );
    }
    fs.writeFileSync(prsPath, rewritten);
  }

  // — the REAL store, over the real zustand the app ships —
  const storePath = path.join(tmpDir, 'placeReviewRequestStore.mjs');
  {
    const raw = stripTypeScriptTypes(read('store'), { mode: 'strip' });
    const zustandEntry = require_.resolve('zustand');
    const rewritten = raw.replace(
      "from 'zustand'",
      `from ${JSON.stringify(pathToFileURL(zustandEntry).href)}`,
    );
    assert.notEqual(rewritten, raw, "VACUITY: the store's zustand import was not rewritten");
    fs.writeFileSync(storePath, rewritten);
  }

  supabaseStub = await import(pathToFileURL(supabasePath).href);
  placeReviewService = await import(pathToFileURL(prsPath).href);
  store = await import(pathToFileURL(storePath).href);
  visitService = await import(pathToFileURL(visitPath).href);
});

after(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

function rows() {
  return {
    visits: supabaseStub.db.user_visits.length,
    reviews: supabaseStub.db.place_reviews.length,
  };
}

/** Everything the modal does on submit, from the request the tap wrote. */
function submitFromOpenRequest(rating, recordedVisitId = null) {
  const request = store.usePlaceReviewRequestStore.getState().request;
  assert.ok(request, 'VACUITY: submit was driven with no open request');
  return placeReviewService.submitVoluntaryPlaceReview(
    { userId: USER_ID, ...request, rating },
    recordedVisitId,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Behavioural — the tap, the cancel, the submit, against a real database.
// ─────────────────────────────────────────────────────────────────────────────

test('B-1 the TAP opens the prompt and writes NOTHING', () => {
  supabaseStub.resetDb();
  store.usePlaceReviewRequestStore.setState({ request: null, confirmedCardId: null, confirmToken: 0 });

  store.openPlaceReviewRequest(store.placeReviewRequestFromCard(SINGLE_CARD));

  const s = store.usePlaceReviewRequestStore.getState();
  assert.equal(s.request?.cardId, SINGLE_CARD.id, 'B-1: the tap did not open a request');
  assert.deepEqual(
    rows(),
    { visits: 0, reviews: 0 },
    'B-1: the TAP wrote to the database. The visit is recorded on CONFIRM — writing here and '
    + 'deleting on cancel races a delete against an insert whose cold path is 11.8 seconds '
    + '(#1618/#1642/#1661), and it makes an errant thumb mid-swipe cost a real row.',
  );
  assert.equal(
    supabaseStub.db.invokes.length,
    0,
    'B-1: an edge function was called on the tap. Nothing may leave the device until confirm.',
  );
});

test('B-2 CANCEL leaves nothing written, and nothing to thank the user for', () => {
  // Continues B-1's session deliberately: same store, same database.
  store.cancelPlaceReviewRequest();

  const s = store.usePlaceReviewRequestStore.getState();
  assert.equal(s.request, null, 'B-2: cancel did not close the request');
  assert.deepEqual(
    rows(),
    { visits: 0, reviews: 0 },
    'B-2: cancelling wrote (or failed to un-write) a row. Seth\'s close icon exists BECAUSE the '
    + 'tap may be a mistake; a mistake must cost nothing.',
  );
  assert.equal(
    s.confirmToken,
    0,
    'B-2: cancel moved the confirm token, so the deck control would flash "Thank you" for a '
    + 'review the user just abandoned — #1686\'s "thanking someone for taking something back".',
  );
  assert.equal(s.confirmedCardId, null, 'B-2: cancel recorded a confirmed card');
});

test('B-3 SUBMIT records the visit AND writes the review — one confirm, two rows', async () => {
  // The negative control for B-1 and B-2: same fake server, same session.
  store.openPlaceReviewRequest(store.placeReviewRequestFromCard(SINGLE_CARD));
  assert.deepEqual(rows(), { visits: 0, reviews: 0 }, 'VACUITY: the session did not start empty');

  const result = await submitFromOpenRequest(4);

  assert.deepEqual(
    rows(),
    { visits: 1, reviews: 1 },
    'B-3: submitting did not produce exactly one visit and one review.',
  );

  const [invoke] = supabaseStub.db.invokes;
  assert.equal(invoke.name, 'record-visit', 'B-3: the visit did not go through record-visit');
  assert.equal(invoke.body.experienceId, SINGLE_CARD.id);
  assert.equal(invoke.body.cardData.title, SINGLE_CARD.title);
  assert.equal(invoke.body.cardData.category, SINGLE_CARD.category);

  const [visit] = supabaseStub.db.user_visits;
  assert.equal(visit.experience_id, SINGLE_CARD.id, 'B-3: the visit row is for the wrong card');

  const [review] = supabaseStub.db.place_reviews;
  assert.equal(review.user_id, USER_ID);
  assert.equal(review.rating, 4, 'B-3: the rating the user chose did not reach the row');
  assert.equal(review.did_attend, true, 'B-3: the tap IS the answer to "did you go?"');
  assert.equal(
    review.calendar_entry_id,
    null,
    'B-3: a voluntary review stamped a calendar entry. It has none — the row is anchored to '
    + 'the PLACE, which is why this work was small.',
  );
  assert.equal(review.card_id, SINGLE_CARD.id);
  assert.equal(
    review.place_pool_id,
    SINGLE_CARD.id,
    'B-3: place_pool_id was not derived from the card id. On the current serving shape a single '
    + 'place card\'s id IS its place_pool.id — all 32 rows in production carry NULL here.',
  );
  assert.equal(review.google_place_id, SINGLE_CARD.placeId);
  assert.equal(review.place_name, SINGLE_CARD.title);
  assert.equal(review.place_address, SINGLE_CARD.address);
  assert.equal(review.place_category, SINGLE_CARD.category);

  assert.equal(result.visitId, visit.id);
  assert.equal(result.reviewId, review.id);
});

test('B-4 CONFIRM clears the request and arms exactly one "Thank you" flash', () => {
  store.confirmPlaceReviewRequest();

  const s = store.usePlaceReviewRequestStore.getState();
  assert.equal(s.request, null, 'B-4: confirm did not close the request');
  assert.equal(
    s.confirmedCardId,
    SINGLE_CARD.id,
    'B-4: the deck control cannot tell WHICH card was confirmed, so the wrong card would flash',
  );
  assert.equal(
    s.confirmToken,
    1,
    'B-4: the confirm token did not move, so the control settles without ever saying "Thank you"',
  );
});

test('B-5 a curated card yields no place_pool_id rather than a fabricated one', async () => {
  supabaseStub.resetDb();
  store.usePlaceReviewRequestStore.setState({ request: null, confirmedCardId: null, confirmToken: 0 });

  const request = store.placeReviewRequestFromCard(CURATED_CARD);
  assert.equal(
    request.placePoolId,
    undefined,
    'B-5: a curated card id (curated_<type>_<ts>_<rand>) was written into place_pool_id, which '
    + 'is a uuid column pointing at a real place. Constitution rule 9 — missing is hidden.',
  );
  assert.equal(
    request.googlePlaceId,
    undefined,
    'B-5: google_place_id was invented for a card that carries no placeId',
  );

  store.openPlaceReviewRequest(request);
  await submitFromOpenRequest(5);

  const [review] = supabaseStub.db.place_reviews;
  assert.equal(review.place_pool_id, null);
  assert.equal(review.google_place_id, null);
  assert.equal(review.card_id, CURATED_CARD.id, 'B-5: the curated card lost its own identity');
});

test('B-6 a retry after a failed review insert does NOT re-record the visit', async () => {
  supabaseStub.resetDb();
  store.usePlaceReviewRequestStore.setState({ request: null, confirmedCardId: null, confirmToken: 0 });
  store.openPlaceReviewRequest(store.placeReviewRequestFromCard(SINGLE_CARD));

  supabaseStub.control.reviewInsertFails = true;
  let caught = null;
  try {
    await submitFromOpenRequest(3);
  } catch (error) {
    caught = error;
  }

  assert.ok(caught, 'B-6: a refused review insert resolved successfully');
  assert.equal(
    caught.name,
    'PlaceReviewWriteError',
    'B-6: the failure does not carry the visit that already landed, so a retry cannot avoid '
    + 're-recording it',
  );
  assert.deepEqual(
    rows(),
    { visits: 1, reviews: 0 },
    'B-6: the visit should have landed and the review should not have',
  );
  const visitedAtAfterFirst = supabaseStub.db.user_visits[0].visited_at;

  // The retry, exactly as the modal issues it.
  supabaseStub.control.reviewInsertFails = false;
  await submitFromOpenRequest(3, caught.visitId);

  assert.deepEqual(
    rows(),
    { visits: 1, reviews: 1 },
    'B-6: the retry wrote a second visit or a second review',
  );
  assert.equal(
    supabaseStub.db.invokes.length,
    1,
    'B-6: the retry called record-visit again. The edge function stamps visited_at at EXECUTION '
    + 'time, so a second call rewrites the recorded time of the user\'s own visit — the drift '
    + '#1661 X-3 exists to catch.',
  );
  assert.equal(supabaseStub.db.user_visits[0].visited_at, visitedAtAfterFirst);
});

// ─────────────────────────────────────────────────────────────────────────────
// Structural — the seams the behavioural half cannot reach.
// ─────────────────────────────────────────────────────────────────────────────

function beenHereControlBody() {
  const src = stripComments(read('swipeable'));
  const start = src.indexOf('const BeenHereControl');
  assert.ok(start > 0, 'VACUITY: BeenHereControl is gone from SwipeableCards');
  const end = src.indexOf('const CardHeroImage', start);
  assert.ok(end > start, 'VACUITY: could not delimit the BeenHereControl body');
  const body = src.slice(start, end);
  assert.ok(body.length > 400, `VACUITY: the extracted body is implausibly short (${body.length})`);
  return body;
}

test('S-1 the deck control opens the prompt and holds no record mutation', () => {
  const body = beenHereControlBody();

  assert.ok(
    body.includes('openPlaceReviewRequest'),
    'S-1: the tap no longer opens the rating prompt. Before #1687 there was no user-initiated '
    + 'way to rate anywhere in the app — rating only happened TO you, if you had scheduled a '
    + 'place and let the time pass.',
  );
  assert.ok(
    body.includes('removeVisit.mutate'),
    'S-1: the settled tap no longer removes the visit. That is the un-toggle.',
  );
  for (const forbidden of ['recordVisit.mutate', 'useRecordVisit']) {
    assert.ok(
      !body.includes(forbidden),
      `S-1: the control reaches "${forbidden}" again — the tap writes. B-1 asserts the write is `
      + 'on confirm; this asserts the component agrees.',
    );
  }
});

test('S-2 the modal opens on the rating step, with a close icon, only when voluntary', () => {
  const modal = stripComments(read('modal'));

  assert.match(
    modal,
    /const\s+initialStep[^=]*=\s*isVoluntary\s*\?\s*["']rate["']\s*:\s*["']prompt["']/,
    'S-2: the voluntary entry no longer opens on the rating step. Arriving from "Been here" the '
    + 'tap IS the answer to "did you go?" — and the scheduled prompt must still ask it.',
  );
  assert.match(
    modal,
    /dismissible\s*&&\s*step\s*!==\s*["']thank-you["']/,
    'S-2: the close icon is no longer gated. It must exist on the voluntary entry (the tap may '
    + 'be a mistake) and NOT on the "thank-you" step, where the write has already landed.',
  );
  assert.match(
    modal,
    /onPress=\{handleDismiss\}/,
    'S-2: the close icon no longer routes through handleDismiss, so a cancel would be reported '
    + 'as a completion and the deck would flash "Thank you" for an abandoned review.',
  );
  assert.match(
    modal,
    /!isVoluntary\s*&&\s*\(\s*<TouchableOpacity/,
    'S-2: the rating step\'s back arrow is unconditional again. On the voluntary entry there is '
    + 'no "did you go?" step behind it to go back to.',
  );
  assert.match(
    modal,
    /submitVoluntary\.mutateAsync/,
    'S-2: the voluntary submit no longer issues the confirm-time write',
  );

  // The scheduled path keeps its calendar stamp; only the voluntary one is null.
  assert.match(
    modal,
    /resolvedCalendarEntryId\s*=\s*isVoluntary\s*\n?\s*\?\s*null/,
    'S-2: the voluntary review can now stamp a calendar entry it does not have',
  );
});

test('S-3 there is still EXACTLY ONE PostExperienceModal in the app (ORCH-1063)', () => {
  const mounts = [];
  for (const [name, file] of Object.entries(SRC)) {
    if (!file.endsWith('.tsx')) continue;
    const code = stripComments(fs.readFileSync(file, 'utf8'));
    let idx = code.indexOf('<PostExperienceModal');
    while (idx !== -1) {
      mounts.push(name);
      idx = code.indexOf('<PostExperienceModal', idx + 1);
    }
  }
  assert.deepEqual(
    mounts,
    ['index'],
    'S-3: PostExperienceModal is mounted somewhere other than app/index.tsx, or more than once. '
    + 'ORCH-1063 was a TOTAL APP FREEZE caused by an RN <Modal> rendered inside the deck-state '
    + 'switch: a transient deck-state flip unmounted the PRESENTED modal and left an invisible '
    + 'full-screen window eating every touch. The deck reaches the single instance through '
    + 'placeReviewRequestStore, never by mounting its own.',
  );

  const index = stripComments(read('index'));
  assert.match(
    index,
    /voluntaryVisit=\{voluntaryPlaceReview\}/,
    'S-3: the single mount no longer receives the voluntary request, so the deck tap opens '
    + 'nothing',
  );
  assert.match(
    index,
    /dismissible=\{!!voluntaryPlaceReview\}/,
    'S-3: the close icon is no longer scoped to the voluntary entry — either the scheduled '
    + 'prompt became dismissible, or the voluntary one lost its way out',
  );
  assert.match(
    index,
    /onCancel=\{[\s\S]{0,400}cancelPlaceReviewRequest\(\)/,
    'S-3: cancelling no longer routes to cancelPlaceReviewRequest',
  );
  assert.match(
    index,
    /onComplete=\{[\s\S]{0,400}confirmPlaceReviewRequest\(\)/,
    'S-3: completing no longer routes to confirmPlaceReviewRequest, so the deck never flashes',
  );
});

test('S-4 the confirm-time write keeps #1642/#1661\'s protections', () => {
  const hook = stripComments(read('hook'));

  assert.match(
    hook,
    /networkMode:\s*['"]always['"]/,
    'S-4: the voluntary write lost `networkMode: "always"` (#1642). With the default "online", '
    + 'query-core PAUSES the mutation before mutationFn runs — the operation bound inside '
    + 'visitService is never even created and the modal spins forever instead of reaching an '
    + 'error the user can act on.',
  );
  const onSuccess = hook.slice(hook.indexOf('onSuccess'), hook.indexOf('onError'));
  assert.ok(onSuccess.length > 40, 'VACUITY: could not delimit onSuccess');
  assert.ok(
    onSuccess.indexOf('confirmOnlineFromCompletedWrite')
      < onSuccess.indexOf('invalidateQueries'),
    'S-4: confirmOnlineFromCompletedWrite must run BEFORE the invalidations (#1661). Invalidating '
    + 'while the connectivity belief is still false parks the refetch, so both rows land and the '
    + 'deck control never settles.',
  );
  assert.match(
    onSuccess,
    /queryKey:\s*\[['"]visits['"]\]/,
    "S-4: the ['visits'] prefix is gone, so useHasVisited never refetches and the control never "
    + 'reaches its settled state',
  );
});

test('S-5 #1686 — the settled state reads as pressable to everyone, not just VoiceOver', () => {
  const plate = stripComments(read('plate'));

  const bodyAt = plate.indexOf('export function BeenHereBody');
  assert.ok(bodyAt > 0, 'VACUITY: BeenHereBody is gone from deckCardPlate');
  const body = plate.slice(bodyAt, plate.indexOf('export function beenHereStateStyle', bodyAt));
  assert.ok(body.length > 200, `VACUITY: the extracted BeenHereBody is too short (${body.length})`);

  assert.match(
    body,
    /state === 'settled' &&[\s\S]{0,200}<Icon\s+name="close"/,
    'S-5: the settled control carries no visible removal affordance again. It genuinely '
    + 'un-records on a second press, and the ONLY string in the app that says so — '
    + 'swipeable.been_here_on, "Double tap to remove" — is passed to accessibilityLabel only. '
    + 'The undo was announced to VoiceOver and to nobody else.',
  );

  // The copy is NOT how this is solved: been_here_settled is pinned by #1609 T-4,
  // and the pill is deliberately not redesigned.
  const copy = JSON.parse(fs.readFileSync(path.join(appMobile, 'src/i18n/locales/en/cards.json'), 'utf8'));
  assert.equal(
    copy['swipeable.been_here_settled'],
    "You've been here",
    'S-5: the settled label changed. The affordance is visual; the copy is pinned by #1609 T-4.',
  );
  assert.match(
    copy['swipeable.been_here_on'],
    /remove/i,
    'S-5: the VoiceOver removal label is gone — the sighted affordance ADDS to it, it does not '
    + 'replace it',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// #1687 REWORK — the tester's P1-1 (CONDITIONAL PASS, comment 5209937972).
//
// `place_pool_id` was derived from the SHAPE of the card's id. That is correct
// for the two `place_pool` card types (a pool place and a claimed venue) and
// falls out correctly for a curated plan, whose id is not uuid-shaped. It is
// WRONG for the fourth type the same ungated control renders on: a brand
// experience, which `discover-cards` builds with `id: String(row.event_id)`.
// An `events.id` is uuid-shaped, and 0 of the 65 `events` rows in production
// exist in `place_pool`, so `place_reviews_place_pool_id_fkey` refuses the row
// with 23503 — AFTER the visit has landed, on every retry, with no user DELETE
// policy to clear it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A BRAND EXPERIENCE card as `deckService.experienceCardToRecommendation` builds
 * it: the explicit discriminator, and an `events.id` in `id`.
 */
const EXPERIENCE_CARD = {
  cardType: 'experience',
  id: '4d0f0be1-1a5a-4f7f-9d3f-6a0a6a1c2e77',
  title: 'Sunset Rooftop Tasting',
  category: 'Date Night',
  image: 'https://example.invalid/exp.jpg',
  priceRange: '$$$',
};

/** A single place card carrying its `place_pool.id` explicitly, per the rework. */
const CARRIED_PLACE_CARD = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  placePoolId: 'f0e1d2c3-1111-4111-8111-000000000002',
  title: 'Bar Virgile',
  category: 'Drinks',
  image: 'https://example.invalid/virgile.jpg',
  placeId: 'ChIJ_carried_place',
  priceRange: '$$',
};

/**
 * #1687 rework 3 — ONE ARGUMENT, because the product's tap now passes one. The
 * second one carried `useHasVisited`'s pre-tap answer and existed only to
 * authorise a delete; there is no delete to authorise.
 */
function freshSession(card) {
  supabaseStub.resetDb();
  supabaseStub.resetRollback();
  store.usePlaceReviewRequestStore.setState({
    request: null,
    confirmedCardId: null,
    confirmToken: 0,
  });
  if (card) {
    store.openPlaceReviewRequest(store.placeReviewRequestFromCard(card));
  }
}

/**
 * EXACTLY what `useSubmitVoluntaryPlaceReview`'s `mutationFn` does — which, since
 * rework 3, is the write and nothing else. There is no catch, because there is no
 * compensating action: a refused review keeps the visit and reports it, and
 * `onError` invalidates so the deck settles to what the database holds. S-6 pins
 * that the shipped hook really is this and not a re-implementation of it.
 */
async function submitVoluntary(rating, recordedVisitId = null) {
  const request = store.usePlaceReviewRequestStore.getState().request;
  assert.ok(request, 'VACUITY: submit was driven with no open request');
  try {
    return await placeReviewService.submitVoluntaryPlaceReview(
      { userId: USER_ID, ...request, rating },
      recordedVisitId,
    );
  } catch (error) {
    // THE TRAP THIS AVOIDS. Writing the helper as the bare write would make every
    // behavioural test below stop EXERCISING a reintroduced rollback rather than
    // fail on it — green suite, deleted visits, exactly the unfalsifiable shape
    // that let the first B-10 through. So the helper re-composes whatever
    // compensating entry point the service grows back, on purpose: if one
    // returns, these tests RUN it and fail. S-6 separately pins that the SHIPPED
    // mutationFn composes nothing.
    const compensate = placeReviewService.rollBackHalfLandedVisit;
    if (typeof compensate === 'function') {
      throw await compensate(error, request.cardId);
    }
    throw error;
  }
}

/** Drive `rating` stars and hand back whatever came out, thrown or returned. */
async function submitAndCatch(rating, recordedVisitId = null) {
  try {
    await submitVoluntary(rating, recordedVisitId);
    return null;
  } catch (error) {
    return error;
  }
}

test('B-7 a BRAND EXPERIENCE yields no place anchor — its id is an events.id, not a place', async () => {
  const request = store.placeReviewRequestFromCard(EXPERIENCE_CARD);

  assert.equal(
    request.placePoolId,
    undefined,
    'B-7: the events.id of a brand experience was written into place_pool_id. It is uuid-SHAPED '
    + 'and it is not a place: place_reviews_place_pool_id_fkey refuses the row with 23503 AFTER '
    + 'record-visit has already landed, every retry reproduces it, and place_reviews grants '
    + 'users no DELETE — an orphaned visit that can never be cleaned up. The card carries its '
    + 'own cardType; identity must come from that, never from the shape of a string.',
  );

  freshSession(null);
  store.openPlaceReviewRequest(request);
  const result = await submitVoluntary(5);

  assert.deepEqual(
    rows(),
    { visits: 1, reviews: 1 },
    'B-7: the experience review did not land as a normal, place-less review',
  );
  const [review] = supabaseStub.db.place_reviews;
  assert.equal(review.place_pool_id, null, 'B-7: a place_pool_id was fabricated for an experience');
  assert.equal(review.card_id, EXPERIENCE_CARD.id);
  assert.ok(result.reviewId, 'B-7: the write did not return the row it claims to have made');
});

test('B-8 the place id is CARRIED, and an unknown card type yields nothing at all', () => {
  const carried = store.placeReviewRequestFromCard(CARRIED_PLACE_CARD);
  assert.equal(
    carried.placePoolId,
    CARRIED_PLACE_CARD.placePoolId,
    'B-8: a card that carries its own place_pool.id was ignored in favour of its card id. '
    + 'deckService attaches it in the single-place branch — the one place in the pipeline that '
    + 'KNOWS the id is a pool row — so this is the value that must win.',
  );
  assert.notEqual(
    carried.placePoolId,
    CARRIED_PLACE_CARD.id,
    'VACUITY: the fixture cannot tell the carried id from the card id',
  );

  // The rule that closes the CLASS rather than this instance: a fifth card type
  // nobody has written yet must not inherit "looks like a uuid, must be a place".
  const future = store.placeReviewRequestFromCard({
    cardType: 'itinerary',
    id: '9f8e7d6c-2222-4222-8222-000000000003',
    title: 'Something newer than this test',
    category: 'New',
    image: 'https://example.invalid/new.jpg',
  });
  assert.equal(
    future.placePoolId,
    undefined,
    'B-8: a card DECLARING a type this code has never heard of was still treated as a place. '
    + 'The default must be "no place anchor" — the experience bug was exactly this assumption, '
    + 'and #1672 was the same assumption on the saved path.',
  );
});

test('B-9 a REFUSED review KEEPS the visit, deletes NOTHING, and the user can undo it themselves', async () => {
  // #1687 rework 3 — THE DECISION, in one test. Two attempts to compensate a
  // half-landed submit by deleting the visit each shipped a defect, in opposite
  // directions, because both had to decide whether the row was theirs to destroy
  // and neither signal on the client answers that. So the write stopped asking.
  //
  // What replaces the delete is not "nothing" — it is the pair below: the error
  // NAMES the row that landed, and `onError` (S-6) invalidates so the deck pill
  // settles to "You've been to X. Double tap to remove." That tap is the second
  // half, and it is driven here rather than assumed: a visit with no review is
  // only acceptable because the user can retract it.
  freshSession(SINGLE_CARD);
  supabaseStub.control.reviewInsertFails = true;

  const caught = await submitAndCatch(4);

  assert.equal(caught?.name, 'PlaceReviewWriteError', 'B-9: the refusal did not surface');
  assert.deepEqual(
    rows(),
    { visits: 1, reviews: 0 },
    'B-9: the visit did not survive a refused review. It must: the user DID say they went, that '
    + 'is the truth, and a deleted user_visits row is unrecoverable — no history table, no user '
    + 'DELETE policy on place_reviews, nothing to restore it from.',
  );
  assert.equal(
    supabaseStub.deletes.length,
    0,
    'B-9: A COMPENSATING DELETE WAS ISSUED. Nothing on this path may delete a user_visits row. '
    + 'Deciding "is this visit mine to destroy" from the client produced a defect twice — '
    + 'record-visit\'s isNew describes user_interactions, and useHasVisited is cached for ten '
    + 'minutes — and a wrong answer in this direction is silent and permanent.',
  );
  assert.equal(
    caught.visitId,
    supabaseStub.db.user_visits[0].id,
    'B-9: the error does not name the row that landed. That id is what stops the retry '
    + 're-stamping visited_at (#1661 X-3) AND what tells the mutation a real row exists, which '
    + 'is what licenses the invalidation that settles the pill.',
  );

  // The recoverability claim, driven rather than asserted: the settled pill's own
  // un-toggle is a real delete on the same transport, and it clears the row.
  await visitService.removeVisit(SINGLE_CARD.id);
  assert.deepEqual(
    rows(),
    { visits: 0, reviews: 0 },
    'B-9: the user\'s own un-toggle no longer clears the visit. "Leave it, the user can undo it" '
    + 'is the whole argument for not deleting; if removeVisit stops working the leftover really '
    + 'is stranded and this design needs revisiting.',
  );
  assert.equal(
    supabaseStub.deletes.length,
    1,
    'VACUITY: the un-toggle did not reach the same in-memory transport the assertions above read, '
    + 'so "deletes.length === 0" up there proves nothing.',
  );

  // And the retry reuses the visit rather than recording a second time.
  freshSession(SINGLE_CARD);
  supabaseStub.control.reviewInsertFails = true;
  const first = await submitAndCatch(4);
  supabaseStub.control.reviewInsertFails = false;
  const invokesBefore = supabaseStub.db.invokes.length;
  await submitVoluntary(4, first.visitId);
  assert.deepEqual(rows(), { visits: 1, reviews: 1 }, 'B-9: the retry did not complete cleanly');
  assert.equal(
    supabaseStub.db.invokes.length,
    invokesBefore,
    'B-9: the retry called record-visit again and re-stamped visited_at on the user\'s own visit.',
  );
  assert.equal(supabaseStub.deletes.length, 0, 'B-9: the retry path issued a delete');
});

test('B-10 a THREE-DAY-OLD visit survives a refused review, with BOTH client signals lying about it', async () => {
  // #1687 rework 3 — THE P1-3 REGRESSION, reproduced, and the reason the delete
  // is gone rather than re-guarded. The tester drove this on an iPhone against
  // production: visit `99081740`, dated 2026-08-04, upserted at 21:57:00.79 and
  // DELETED at 21:57:01.253 by a review the foreign key refused.
  //
  // The fixture makes BOTH signals a rework could consult say "delete it", at the
  // same time, which is the whole point — there is no third signal to add:
  //
  //   * `useHasVisited` answers FALSE. Its staleTime is TEN MINUTES
  //     (useVisits.ts:80), so a visit written by another client, another session,
  //     or out of band sits behind a cached "no". Rework 2 trusted this and
  //     destroyed the row. Here the request carries no such field at all, so a
  //     revert that reintroduces it lands on exactly this state.
  //   * `record-visit` answers isNew: TRUE. The seeded row has no
  //     `user_interactions` row behind it — the state record-visit:143 leaves
  //     whenever the interaction insert is swallowed — so the flag reports "new"
  //     for a row that is three days old. Rework 1 trusted this.
  //
  // Nothing may delete this row. Not on a stale client answer, not on a server
  // flag about another table, not on the two of them agreeing.
  freshSession(SINGLE_CARD);
  const preExistingVisitId = supabaseStub.seedPreExistingVisit(
    SINGLE_CARD.id,
    '2026-08-04T01:56:29.000Z',
  );
  assert.deepEqual(rows(), { visits: 1, reviews: 0 }, 'VACUITY: the pre-existing visit was not seeded');
  assert.equal(
    supabaseStub.db.user_interactions.length,
    0,
    'VACUITY: the seeded visit has an interaction row behind it, so record-visit would report '
    + 'isNew:false and this test would not be driving the destructive direction of that flag.',
  );

  supabaseStub.control.reviewInsertFails = true;
  const caught = await submitAndCatch(2);

  assert.equal(caught?.name, 'PlaceReviewWriteError', 'B-10: the refusal did not surface');
  assert.equal(
    supabaseStub.db.user_interactions.length,
    1,
    'VACUITY: record-visit did not take the "no interaction row -> insert one" branch, so it did '
    + 'NOT return isNew:true and the flag was never lying in this fixture.',
  );
  assert.equal(
    supabaseStub.db.user_visits.length,
    1,
    'B-10: A VISIT THE USER MADE THREE DAYS AGO WAS DESTROYED by a failed review write. There is '
    + 'no user_visits history and no way to restore it, and the user is never told. This is the '
    + 'harm the whole design change exists to remove: whatever a rollback thinks it knows about '
    + 'this row, it is wrong often enough that it must not act.',
  );
  assert.equal(
    supabaseStub.db.user_visits[0].id,
    preExistingVisitId,
    'B-10: the surviving row is not the original — it was deleted and re-created, which loses the '
    + 'real visited_at the user\'s history is built on.',
  );
  assert.equal(
    supabaseStub.deletes.length,
    0,
    'B-10: a DELETE was issued against a visit this submit did not create.',
  );
  assert.equal(
    caught.visitId,
    preExistingVisitId,
    'B-10: the surviving visit is not named in the failure, so the retry would re-record it and '
    + 're-stamp visited_at (#1661 X-3).',
  );
});

test('B-11a record-visit says isNew:FALSE for a row it just created — keep it anyway', async () => {
  // #1687 rework 2 (P1-2) — THE DEFECT, reproduced. The tester hit this on an
  // iPhone against production: The Parlour carried a user_interactions row from
  // an earlier un-toggle (18:31:05) and no user_visits row. The tap CREATED
  // `user_visits 44c459c9` at 00:53:12.679, and because the interaction row was
  // still there record-visit reported isNew:FALSE. The first rework's guard read
  // that flag and would have refused to undo a row it had just created — exactly
  // the orphan P1-1 exists to remove, on the likeliest path to reach it (three
  // pairs in production are in this state today).
  freshSession(SINGLE_CARD);
  supabaseStub.seedOrphanInteraction(SINGLE_CARD.id);
  assert.deepEqual(rows(), { visits: 0, reviews: 0 }, 'VACUITY: the un-toggled state is not empty');
  assert.equal(
    supabaseStub.db.user_interactions.length,
    1,
    'VACUITY: no orphaned interaction row, so record-visit would report isNew:true and the '
    + 'divergence this test exists for would not be present.',
  );

  supabaseStub.control.reviewInsertFails = true;
  const caught = await submitAndCatch(4);

  assert.equal(caught?.name, 'PlaceReviewWriteError', 'B-11a: the refusal did not surface');
  // #1687 rework 3 — B-10's fixture makes the flag say "new" about an old row;
  // this one makes it say "old" about a row created a millisecond ago. The write
  // must behave IDENTICALLY in both, because it no longer reads the flag: the
  // visit stays, the user is told, and the pill settles to the truth.
  assert.deepEqual(
    rows(),
    { visits: 1, reviews: 0 },
    'B-11a: the visit this submit created did not survive the refused review.',
  );
  assert.equal(
    supabaseStub.deletes.length,
    0,
    'B-11a: A DELETE WAS ISSUED. A newly created visit is no more deletable than an old one — the '
    + 'app cannot reliably tell them apart, which is the finding, and the one it CAN act on '
    + '(record-visit\'s isNew) says "not new" about this very row.',
  );
  assert.equal(
    caught.visitId,
    supabaseStub.db.user_visits[0].id,
    'B-11a: the created visit is not named in the failure.',
  );
  assert.equal(
    supabaseStub.db.user_interactions.length,
    1,
    'VACUITY: a second interaction row appeared, which means record-visit took the isNew:true '
    + 'branch and the flag was never lying in this fixture.',
  );

  // The user's own un-toggle still clears it — the same recovery B-9 drives, on
  // the row that made the tester file P1-1 in the first place.
  await visitService.removeVisit(SINGLE_CARD.id);
  assert.deepEqual(rows(), { visits: 0, reviews: 0 }, 'B-11a: the leftover could not be undone');
});

test('B-11 EVERY failure this write can reach deletes nothing — the sweep', async () => {
  // #1687 rework 3 — B-9/B-10/B-11a each pin one state. This walks all of them
  // plus the two the others do not reach, on ONE transport, and asserts the same
  // two things every time: `user_visits` never shrinks, and no delete is issued.
  // A reintroduced delete cannot hide in a corner of the state space.
  const cases = [
    {
      name: 'nothing existed, the review is refused',
      seed: () => null,
      control: { reviewInsertFails: true },
      expectVisits: 1,
      halfLanded: true,
    },
    {
      name: 'a pre-existing visit behind a stale deck, the review is refused',
      seed: () => supabaseStub.seedPreExistingVisit(SINGLE_CARD.id, '2026-08-04T01:56:29.000Z'),
      control: { reviewInsertFails: true },
      expectVisits: 1,
      halfLanded: true,
    },
    {
      name: 'an un-toggled place, so record-visit lies the other way',
      seed: () => { supabaseStub.seedOrphanInteraction(SINGLE_CARD.id); return null; },
      control: { reviewInsertFails: true },
      expectVisits: 1,
      halfLanded: true,
    },
    {
      name: 'the VISIT itself fails — nothing landed, nothing to compensate',
      seed: () => null,
      control: { recordVisitFails: true },
      expectVisits: 0,
      halfLanded: false,
    },
    {
      name: 'a pre-existing visit and the VISIT call fails',
      seed: () => supabaseStub.seedPreExistingVisit(SINGLE_CARD.id, '2026-08-04T01:56:29.000Z'),
      control: { recordVisitFails: true },
      expectVisits: 1,
      halfLanded: false,
    },
  ];

  for (const c of cases) {
    freshSession(SINGLE_CARD);
    const seeded = c.seed();
    Object.assign(supabaseStub.control, c.control);

    const caught = await submitAndCatch(3);

    assert.ok(caught, `B-11 [${c.name}]: the failure did not surface at all`);
    assert.equal(
      caught instanceof placeReviewService.PlaceReviewWriteError,
      c.halfLanded,
      `B-11 [${c.name}]: a half-landed write and a write that landed nothing must be `
      + 'distinguishable — the retry skips the re-record on one and not the other.',
    );
    assert.equal(
      supabaseStub.db.user_visits.length,
      c.expectVisits,
      `B-11 [${c.name}]: the visit count moved. Every failure on this path must leave `
      + 'user_visits exactly as it found it, plus at most the row record-visit itself wrote.',
    );
    assert.equal(
      supabaseStub.deletes.length,
      0,
      `B-11 [${c.name}]: A DELETE WAS ISSUED. No failure state on the voluntary review path may `
      + 'remove a user_visits row — the app cannot tell whose it is, and the mistake is silent '
      + 'and permanent.',
    );
    if (seeded) {
      assert.equal(
        supabaseStub.db.user_visits[0].id,
        seeded,
        `B-11 [${c.name}]: the pre-existing row was replaced rather than left alone`,
      );
    }
  }

  // VACUITY: the same transport records a delete when one really is issued, so
  // the five zeros above are zeros-because-nothing-deleted.
  freshSession(SINGLE_CARD);
  supabaseStub.seedPreExistingVisit(SINGLE_CARD.id, '2026-08-04T01:56:29.000Z');
  await visitService.removeVisit(SINGLE_CARD.id);
  assert.equal(
    supabaseStub.deletes.length,
    1,
    'VACUITY: a real delete does not register on this transport, so B-11 cannot detect one.',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Structural — the rework's seams.
// ─────────────────────────────────────────────────────────────────────────────

test('S-6 NO DELETE PATH EXISTS on the voluntary write, and the recovery that replaces it is wired', () => {
  const hook = stripComments(read('hook'));
  const service = stripComments(read('placeReviewService'));

  // 1 — the source-level half of B-9/B-10/B-11. Those drive behaviour through a
  //     transport; this refuses the machinery outright, so a delete cannot come
  //     back through a path they happen not to reach.
  for (const [label, src] of [['placeReviewService.ts', service], ['usePlaceReviews.ts', hook]]) {
    for (const banned of ['removeVisit', 'rollBackHalfLandedVisit', 'visitIsOursToUndo', 'visitCreated']) {
      assert.ok(
        !src.includes(banned),
        `S-6: \`${banned}\` is back in ${label}. The voluntary review write must not be able to `
        + 'delete a user_visits row. Two attempts to decide "is this visit mine to undo" shipped '
        + 'defects in opposite directions — isNew describes user_interactions, useHasVisited is '
        + 'cached for ten minutes — and the wrong answer is silent and unrecoverable. If a '
        + 'rollback genuinely needs to come back, it needs a fresh read of user_visits at write '
        + 'time (#1694), not another client-side guess, and this assertion is where to argue it.',
      );
    }
    assert.ok(
      !/\.delete\(/.test(src),
      `S-6: ${label} issues a delete directly. Same rule, one layer down: this file writes.`,
    );
  }
  assert.match(
    service,
    /import\s*\{\s*recordVisit\s*\}\s*from\s*'\.\/visitService'/,
    'S-6: placeReviewService no longer imports EXACTLY `recordVisit` from visitService. It must '
    + 'not be able to reach removeVisit at all — the narrow import is the guard.',
  );

  // 2 — what replaces the delete. A leftover visit is acceptable ONLY because the
  //     deck settles to it and the user can un-toggle it, so both halves of that
  //     are load-bearing: the invalidation here, and the un-toggle in S-9.
  assert.match(
    hook,
    /mutationFn:\s*\(\{\s*input,\s*recordedVisitId\s*\}\)\s*=>\s*\n?\s*submitVoluntaryPlaceReview\(input,\s*recordedVisitId\)/,
    'S-6: the shipped mutationFn is no longer the bare write. Anything wrapped around it is where '
    + 'a compensating action would live.',
  );
  const onError = hook.slice(hook.indexOf('onError'));
  assert.match(
    onError,
    /error\.visitId[\s\S]{0,400}invalidateQueries/,
    'S-6: a visit that SURVIVED the rollback no longer invalidates the visit queries. The row '
    + 'exists, useHasVisited still says it does not, and the pill sits at REST while the '
    + 'database disagrees — the tester\'s X-2, with no way for the user to see or clear it.',
  );

  const storeSrc = stripComments(read('store'));
  assert.match(
    storeSrc,
    /card\.cardType\s*!==\s*SINGLE_PLACE_CARD_TYPE/,
    'S-6: the store no longer refuses a card that DECLARES a non-place type. That single line is '
    + 'what closes the class: a curated plan, a brand experience and every card type added after '
    + 'this was written all fail closed instead of being guessed at.',
  );
  assert.ok(
    !/placePoolId:\s*UUID_RE\.test\(card\.id\)/.test(storeSrc),
    'S-6: place_pool_id is derived from the shape of the card id again. An events.id is '
    + 'uuid-shaped and is not a place; the FK is live.',
  );

  const deck = stripComments(read('deckService'));
  assert.match(
    deck,
    /placeId:\s*card\.placeId,[\s\S]{0,200}placePoolId:/,
    'S-6: the single-place branch of deckService no longer attaches the place_pool id. It is the '
    + 'only point in the pipeline that KNOWS `card.id` is a place_pool row (discover-cards '
    + 'builds these with `id: row.place_id`), so nothing downstream has to infer it.',
  );
});

test('S-7 a voluntary close hands the deck back, not a LOCKED scheduled prompt', () => {
  const check = stripComments(read('scheduledCheck'));

  assert.match(
    check,
    /const\s+deferScheduledPrompt\s*=\s*useCallback\([\s\S]{0,600}setTimeout\([\s\S]{0,120}MODAL_DELAY_MS\)/,
    'S-7: the scheduled prompt can no longer be RE-ARMED. The poll arms it 3 seconds after every '
    + 'foreground; a voluntary tap inside that window correctly holds the modal, but the timer '
    + 'keeps running, so pressing the close icon handed the SAME instance straight to a locked '
    + 'prompt with no way out. It must go back to arming and present on its own delay.',
  );
  assert.match(
    check,
    /deferScheduledPrompt,/,
    'S-7: deferScheduledPrompt is no longer returned from the hook, so the mount cannot call it',
  );

  // Anchored on the MOUNT, not on the first onComplete in a 3000-line file —
  // `app/index.tsx` has several, and the onboarding flow's is not this one.
  const index = stripComments(read('index'));
  const mountAt = index.indexOf('<PostExperienceModal');
  assert.ok(mountAt > 0, 'VACUITY: the single PostExperienceModal mount is gone');
  const mount = index.slice(mountAt, index.indexOf('/>', mountAt));
  assert.ok(mount.length > 400, `VACUITY: the extracted mount is too short (${mount.length})`);

  const cancelAt = mount.indexOf('onCancel={');
  assert.ok(cancelAt > 0, 'VACUITY: the modal mount has no onCancel');
  assert.match(
    mount.slice(cancelAt),
    /deferScheduledPrompt\(\)/,
    'S-7: cancelling a voluntary review no longer defers the scheduled prompt — the ✕ opens '
    + 'something the user cannot dismiss.',
  );
  const completeAt = mount.indexOf('onComplete={');
  assert.ok(completeAt > 0, 'VACUITY: the modal mount has no onComplete');
  assert.match(
    mount.slice(completeAt, cancelAt > completeAt ? cancelAt : mount.length),
    /deferScheduledPrompt\(\)/,
    'S-7: finishing a voluntary review no longer defers the scheduled prompt. "Done" has the '
    + 'same collision as ✕ — the arming timer ran while the user was rating.',
  );
});

test('S-8 the database, not the client, is what makes a re-rate replace rather than duplicate', () => {
  assert.ok(
    fs.existsSync(REVIEW_UNIQUENESS_MIGRATION),
    'S-8: the uniqueness migration is gone. Reproduced live by the tester: rate, un-toggle the '
    + 'pill (which deletes the visit and leaves the review), rate again — two rows for one place, '
    + 'and RLS gives users no DELETE so they cannot undo their own duplicate.',
  );
  const sql = fs.readFileSync(REVIEW_UNIQUENESS_MIGRATION, 'utf8');

  const cleanupAt = sql.indexOf('DELETE FROM public.place_reviews r');
  const indexAt = sql.indexOf('CREATE UNIQUE INDEX');
  assert.ok(cleanupAt > 0, 'S-8: the existing duplicates are no longer collapsed');
  assert.ok(
    indexAt > cleanupAt,
    'S-8: the unique index is created BEFORE the cleanup, so `db push` aborts on the duplicate '
    + 'production already holds (user c727d491…, curated_adventurous_1779562052422_1pg5oi, two '
    + 'rows from 2026-05-30).',
  );
  assert.match(
    sql,
    /CREATE UNIQUE INDEX[\s\S]{0,400}\(user_id,\s*card_id\)[\s\S]{0,300}WHERE\s+calendar_entry_id\s+IS\s+NULL/,
    'S-8: the index is no longer a partial unique index on (user_id, card_id) scoped to '
    + 'voluntary rows. Widening it to every row breaks the SCHEDULED path, where the same place '
    + 'legitimately carries one review per calendar entry.',
  );
  assert.match(
    sql,
    /BEFORE INSERT ON public\.place_reviews/,
    'S-8: the replace-on-re-rate trigger is gone, so a second rating raises a raw 23505 the user '
    + 'can never resolve — they cannot delete the first one.',
  );
  assert.match(
    sql,
    /IF NEW\.calendar_entry_id IS NOT NULL THEN\s*\n\s*RETURN NEW;/,
    'S-8: the trigger no longer returns early for scheduled reviews, so it would delete a row '
    + 'the calendar flow owns.',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// #1687 rework 3 — THE SEAM THAT NO LONGER CARRIES ANYTHING, AND THE ONE THAT
// CARRIES THE RECOVERY.
//
// Rework 2 threaded `useHasVisited`'s pre-tap answer from the control, through
// the store, into the write, so a failed review could decide whether to delete
// the visit. That answer is up to TEN MINUTES old and it destroyed a real visit
// on device. The thread is gone — S-9 refuses it at all three joints, because a
// field that still exists anywhere is a field a future rollback can read.
//
// What must exist instead is the user's own way out: the settled pill un-toggles.
// That is the entire reason a leftover visit is acceptable, so it is pinned here
// as hard as the absence is.
// ─────────────────────────────────────────────────────────────────────────────

/** The deployed edge function whose `isNew` this write deliberately ignores. */
const RECORD_VISIT_FN = path.resolve(
  appMobile,
  '../supabase/functions/record-visit/index.ts',
);

test('S-9 the pre-tap belief is gone from every joint, and the user-visible undo is still wired', () => {
  const swipeable = stripComments(read('swipeable'));
  const modal = stripComments(read('modal'));
  const storeSrc = stripComments(read('store'));
  const service = stripComments(read('placeReviewService'));

  // 1 — the flag is gone from all four files it touched. Anywhere it survives is
  //     somewhere a rollback can be re-derived from a ten-minute-old belief.
  for (const [label, src] of [
    ['SwipeableCards.tsx', swipeable],
    ['PostExperienceModal.tsx', modal],
    ['placeReviewRequestStore.ts', storeSrc],
    ['placeReviewService.ts', service],
  ]) {
    assert.ok(
      !src.includes('hadVisitBeforeTap'),
      `S-9: \`hadVisitBeforeTap\` is back in ${label}. useHasVisited's staleTime is ten minutes `
      + '(useVisits.ts:80), so that value can be a cached "no visit" over a visit the user really '
      + 'made — on device it deleted one that was three days old (99081740, 21:57:01.253). It '
      + 'exists only to authorise a delete; nothing on this path deletes.',
    );
  }
  assert.match(
    storeSrc,
    /export function placeReviewRequestFromCard\(\s*card: PlaceReviewCard,\s*\): VoluntaryPlaceReviewRequest/,
    'S-9: placeReviewRequestFromCard takes more than the card again. The second parameter WAS the '
    + 'pre-tap belief; re-adding one is how it comes back without the name.',
  );
  assert.match(
    swipeable,
    /placeReviewRequestFromCard\(\s*card\s*\)/,
    'S-9: the tap passes something extra into the request again.',
  );

  // 2 — the write reads no provenance signal at all. `isNew` is still returned by
  //     record-visit and must stay unread here: it describes user_interactions.
  assert.ok(
    !/isNew/.test(service),
    'S-9: the write consults record-visit\'s `isNew` again. It is computed from a '
    + 'user_interactions lookup, not from the user_visits upsert, and it lied in BOTH directions '
    + 'on device — isNew:false for a row it had just created (124da062), isNew:true for rows that '
    + 'already existed. Nothing may branch on it here.',
  );

  // 3 — THE UNDO. A visit with no review is acceptable ONLY because the deck
  //     settles to it and one tap removes it. B-9 drives removeVisit through the
  //     service; this pins that the settled pill is what calls it, and that the
  //     settled pill does NOT open the prompt (which is why the "already visited"
  //     branch of any rollback guard was unreachable in the first place).
  const start = swipeable.indexOf('const BeenHereControl');
  const end = swipeable.indexOf('const CardHeroImage', start);
  assert.ok(start > 0 && end > start, 'VACUITY: could not delimit BeenHereControl');
  const control = swipeable.slice(start, end);
  assert.match(
    control,
    /const\s*\{\s*data:\s*visited[\s\S]{0,200}useHasVisited\(/,
    'VACUITY: BeenHereControl no longer reads useHasVisited into `visited`, so the assertions '
    + 'below are about a name that means something else now.',
  );
  assert.match(
    control,
    /if\s*\(isVisited\)\s*\{\s*removeVisit\.mutate\(card\.id\);\s*return;\s*\}/,
    'S-9: a settled pill no longer un-toggles the visit. That tap is the ONLY way a user can '
    + 'retract a visit whose review failed, and "they can undo it themselves" is the entire '
    + 'reason a leftover is preferred to a delete. Without it the leftover is stranded and this '
    + 'design is wrong.',
  );
  const removeAt = control.indexOf('removeVisit.mutate(card.id)');
  const openAt = control.indexOf('openPlaceReviewRequest(');
  assert.ok(
    removeAt > 0 && openAt > removeAt,
    'S-9: the prompt is now reachable BEFORE the settled un-toggle. The order is what makes a '
    + 'settled card un-toggle rather than re-rate, and it is why no rollback guard could ever '
    + 'observe "the user already had a visit" at this call site.',
  );

  // 4 — the model check. `isNew` must still BE there for "the write ignores it"
  //     to mean anything, and #1694 landing changes what this file should say.
  const fnSrc = fs.readFileSync(RECORD_VISIT_FN, 'utf8');
  const isNewAt = fnSrc.indexOf('let isNew');
  assert.ok(
    isNewAt > 0,
    'S-9 (model check): record-visit no longer computes isNew at all, so "the write must not read '
    + 'it" is now vacuous. Re-read this suite against whatever replaced it.',
  );
  const derivation = fnSrc.slice(fnSrc.indexOf('user_interactions'), isNewAt);
  assert.match(
    derivation,
    /interaction_type"?,?\s*,?\s*"visit"/,
    'S-9 (model check): record-visit no longer derives isNew from a user_interactions lookup. If '
    + '#1694 landed and it now reports the user_visits upsert itself, a rollback becomes arguable '
    + 'again on a FRESH signal — but it still needs the argument made explicitly, not inherited.',
  );

  // 5 — the belief that made a client answer look trustworthy is still there, so
  //     nobody re-reads this and concludes the cache was tightened.
  const visits = stripComments(fs.readFileSync(path.join(appMobile, 'src/hooks/useVisits.ts'), 'utf8'));
  const hasVisitedAt = visits.indexOf('export function useHasVisited');
  assert.ok(hasVisitedAt > 0, 'VACUITY: useHasVisited moved');
  assert.match(
    visits.slice(hasVisitedAt, hasVisitedAt + 400),
    /staleTime:\s*10\s*\*\s*60\s*\*\s*1000/,
    'S-9 (model check): useHasVisited\'s ten-minute staleTime changed. That window is why the '
    + 'client cannot answer "does this user have a visit for this card" — if it is gone, re-read '
    + 'the argument in placeReviewService\'s header before acting on it.',
  );
});
