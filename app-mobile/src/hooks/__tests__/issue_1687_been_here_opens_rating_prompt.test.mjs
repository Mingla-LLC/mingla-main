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
 * #1687 rework 2 (P1-2) — `hadVisitBeforeTap` is the second argument because it
 * is the second argument in the product: `BeenHereControl` passes
 * `useHasVisited`'s value into `placeReviewRequestFromCard` at the tap. Passing
 * it here is what makes these tests drive the shipped decision rather than a
 * default; leaving it off drives the [TRANSITIONAL] `isNew` fallback on purpose.
 */
function freshSession(card, hadVisitBeforeTap) {
  supabaseStub.resetDb();
  supabaseStub.resetRollback();
  store.usePlaceReviewRequestStore.setState({
    request: null,
    confirmedCardId: null,
    confirmToken: 0,
  });
  if (card) {
    store.openPlaceReviewRequest(
      store.placeReviewRequestFromCard(card, hadVisitBeforeTap),
    );
  }
}

/**
 * EXACTLY what `useSubmitVoluntaryPlaceReview`'s mutationFn does — the write,
 * then the compensating rollback on failure. S-6 pins that the shipped hook is
 * this pair and not a re-implementation of it.
 */
async function submitWithRollback(rating, recordedVisitId = null) {
  const request = store.usePlaceReviewRequestStore.getState().request;
  assert.ok(request, 'VACUITY: submit was driven with no open request');
  try {
    return await placeReviewService.submitVoluntaryPlaceReview(
      { userId: USER_ID, ...request, rating },
      recordedVisitId,
    );
  } catch (error) {
    throw await placeReviewService.rollBackHalfLandedVisit(error, request.cardId);
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
  const result = await submitWithRollback(5);

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

test('B-9 a REFUSED review rolls the visit back — a failed write leaves nothing behind', async () => {
  // `false` is what BeenHereControl passes: the pill was NOT settled, so
  // `useHasVisited` had already answered "no visit for this card".
  freshSession(SINGLE_CARD, false);
  supabaseStub.control.reviewInsertFails = true;

  let caught = null;
  try {
    await submitWithRollback(4);
  } catch (error) {
    caught = error;
  }

  assert.equal(caught?.name, 'PlaceReviewWriteError', 'B-9: the refusal did not surface');
  assert.deepEqual(
    rows(),
    { visits: 0, reviews: 0 },
    'B-9: a refused review left an orphaned user_visits row. "A cancelled tap writes nothing" '
    + 'must hold when the write FAILS too, or the FK-refusal path leaves a permanently '
    + 'unretryable visit the user cannot delete.',
  );
  assert.equal(
    supabaseStub.deletes.length,
    1,
    'B-9: the compensating delete was never issued',
  );
  assert.equal(
    supabaseStub.deletes[0].filters.experience_id,
    SINGLE_CARD.id,
    'B-9: the rollback deleted a different card\'s visit',
  );
  assert.equal(
    caught.visitId,
    null,
    'B-9: the error still names a visit that no longer exists. A retry would pass it as '
    + '`recordedVisitId` and SKIP the record, so the second review would attach to nothing.',
  );

  // And the retry, which must now record afresh, works end to end.
  supabaseStub.control.reviewInsertFails = false;
  await submitWithRollback(4, caught.visitId);
  assert.deepEqual(rows(), { visits: 1, reviews: 1 }, 'B-9: the retry after a rollback did not land');
});

test('B-10 a visit the user ALREADY had is never deleted on their behalf', async () => {
  // #1687 rework 2 (P1-2) — REWRITTEN, because the version this replaces could not
  // fail. It read `isNew` off the harness's own `user_visits` array, which is not
  // where record-visit reads it, so it asserted against an edge function that does
  // not exist and agreed with the bug it was supposed to catch. This drives the
  // divergence for real, in the direction that would DESTROY the user's data.
  //
  // Seed the pre-existing visit with the interaction insert FAILING — that is how
  // production reaches "a user_visits row with no user_interactions row behind
  // it" (record-visit:143 logs it and carries on). The NEXT call then reports
  // `isNew: true` for a row that already existed.
  freshSession(SINGLE_CARD, false);
  supabaseStub.control.interactionInsertFails = true;
  await submitWithRollback(5);
  assert.deepEqual(rows(), { visits: 1, reviews: 1 }, 'VACUITY: the first submit did not land');
  const preExistingVisitId = supabaseStub.db.user_visits[0].id;
  assert.equal(
    supabaseStub.db.user_interactions.length,
    0,
    'VACUITY: the swallowed interaction insert did not leave the two tables diverged, so the '
    + 'next record-visit would report isNew:false and this test would prove nothing.',
  );

  // The deck now shows this card as settled, so `useHasVisited` answers TRUE.
  // That is the fact the rollback must obey — over the server flag, which is
  // about to say the opposite.
  supabaseStub.control.interactionInsertFails = false;
  store.openPlaceReviewRequest(store.placeReviewRequestFromCard(SINGLE_CARD, true));
  supabaseStub.control.reviewInsertFails = true;

  let caught = null;
  try {
    await submitWithRollback(2);
  } catch (error) {
    caught = error;
  }

  assert.equal(caught?.name, 'PlaceReviewWriteError');
  assert.equal(
    supabaseStub.db.user_interactions.length,
    1,
    'VACUITY: record-visit did not take the "no interaction row -> insert one" branch, so it did '
    + 'NOT return isNew:true and this test is not exercising the lying flag at all.',
  );
  assert.equal(
    supabaseStub.db.user_visits.length,
    1,
    'B-10: the rollback deleted a visit the user already had. record-visit reported isNew:true '
    + 'for it — that flag counts user_interactions rows, not user_visits rows, and one swallowed '
    + 'interaction insert is all it takes to make it lie in this direction. removeVisit deletes '
    + 'by (user, experience) rather than by row id, so believing it erases history the user '
    + 'marked weeks ago.',
  );
  assert.equal(supabaseStub.deletes.length, 0, 'B-10: a delete was issued for a pre-existing visit');
  assert.equal(
    caught.visitId,
    preExistingVisitId,
    'B-10: the surviving visit is not named in the failure, so the retry would re-record it and '
    + 're-stamp visited_at (#1661 X-3)',
  );
  assert.equal(caught.visitCreated, false, 'B-10: a pre-existing visit was reported as ours');
});

test('B-11a record-visit says isNew:FALSE for a row it just created — undo it anyway', async () => {
  // #1687 rework 2 (P1-2) — THE DEFECT, reproduced. The tester hit this on an
  // iPhone against production: The Parlour carried a user_interactions row from
  // an earlier un-toggle (18:31:05) and no user_visits row. The tap CREATED
  // `user_visits 44c459c9` at 00:53:12.679, and because the interaction row was
  // still there record-visit reported isNew:FALSE. The first rework's guard read
  // that flag and would have refused to undo a row it had just created — exactly
  // the orphan P1-1 exists to remove, on the likeliest path to reach it (three
  // pairs in production are in this state today).
  freshSession(SINGLE_CARD, false);
  supabaseStub.seedOrphanInteraction(SINGLE_CARD.id);
  assert.deepEqual(rows(), { visits: 0, reviews: 0 }, 'VACUITY: the un-toggled state is not empty');
  assert.equal(
    supabaseStub.db.user_interactions.length,
    1,
    'VACUITY: no orphaned interaction row, so record-visit would report isNew:true and the '
    + 'divergence this test exists for would not be present.',
  );

  supabaseStub.control.reviewInsertFails = true;
  let caught = null;
  try {
    await submitWithRollback(4);
  } catch (error) {
    caught = error;
  }

  assert.equal(caught?.name, 'PlaceReviewWriteError', 'B-11a: the refusal did not surface');
  assert.deepEqual(
    rows(),
    { visits: 0, reviews: 0 },
    'B-11a: a visit CREATED by this submit survived a refused review, because record-visit '
    + 'reported isNew:false for it. That flag is computed from user_interactions '
    + '(record-visit/index.ts:113-148), and removeVisit deletes only from user_visits '
    + '(visitService.ts:167), so every un-toggled place is permanently in the state where the '
    + 'two disagree. The rollback must decide from what useHasVisited said before the tap.',
  );
  assert.equal(supabaseStub.deletes.length, 1, 'B-11a: the compensating delete was never issued');
  assert.equal(supabaseStub.deletes[0].filters.experience_id, SINGLE_CARD.id);
  assert.equal(caught.visitId, null, 'B-11a: a rolled-back visit must hand back a null id');
  assert.equal(
    supabaseStub.db.user_interactions.length,
    1,
    'VACUITY: a second interaction row appeared, which means record-visit took the isNew:true '
    + 'branch and the flag was never lying in this fixture.',
  );
});

test('B-11 a rollback that ITSELF fails keeps the visit id, so nothing is silently lost', async () => {
  freshSession(SINGLE_CARD, false);
  supabaseStub.control.reviewInsertFails = true;
  supabaseStub.rollbackControl.fails = true;

  let caught = null;
  try {
    await submitWithRollback(3);
  } catch (error) {
    caught = error;
  }

  assert.equal(caught?.name, 'PlaceReviewWriteError', 'B-11: the refusal did not surface');
  assert.deepEqual(
    rows(),
    { visits: 1, reviews: 0 },
    'VACUITY: the rollback was supposed to fail and leave the row',
  );
  assert.equal(
    caught.visitId,
    supabaseStub.db.user_visits[0].id,
    'B-11: a failed rollback reported the visit as gone. The row is real and outstanding — its '
    + 'id is what stops the retry re-stamping visited_at, and what tells the mutation to '
    + 'invalidate ["visits"] so the pill stops claiming the user has not been.',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Structural — the rework's seams.
// ─────────────────────────────────────────────────────────────────────────────

test('S-6 the write owns the rollback, and the derivation reads provenance not shape', () => {
  const hook = stripComments(read('hook'));

  assert.match(
    hook,
    /mutationFn[\s\S]{0,400}rollBackHalfLandedVisit\(\s*error\s*,\s*input\.cardId\s*\)/,
    'S-6: the voluntary write no longer rolls back a half-landed visit. B-9 proves the pair '
    + 'behaves; this proves the SHIPPED mutation is that pair rather than a re-implementation '
    + 'of it. Putting the rollback in the component instead would race the component\'s own '
    + 'unmount — the modal is rendered conditionally on the open request.',
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
// #1687 rework 2 (P1-2) — THE SEAM THAT CARRIES THE PRE-TAP FACT.
//
// B-10 and B-11a prove the DECISION is right. They cannot see whether the
// product actually states the fact the decision is made from: the behavioural
// half constructs its own requests, so a control that stopped passing
// `useHasVisited`'s value, or a modal that stopped forwarding it, would leave
// every one of them green while the shipped write silently fell back to the flag
// that lies. This pins the three joints of that thread, and the model the harness
// above is built on.
// ─────────────────────────────────────────────────────────────────────────────

/** The deployed edge function the whole finding is about. */
const RECORD_VISIT_FN = path.resolve(
  appMobile,
  '../supabase/functions/record-visit/index.ts',
);

test('S-9 the pre-tap answer is stated by the control, forwarded by the modal, and preferred by the write', () => {
  // 1 — the control. It has already read useHasVisited to pick its own label;
  //     that same value must reach the request, verbatim.
  const swipeable = stripComments(read('swipeable'));
  const start = swipeable.indexOf('const BeenHereControl');
  const end = swipeable.indexOf('const CardHeroImage', start);
  assert.ok(start > 0 && end > start, 'VACUITY: could not delimit BeenHereControl');
  const control = swipeable.slice(start, end);
  assert.match(
    control,
    /const\s*\{\s*data:\s*visited[\s\S]{0,200}useHasVisited\(/,
    'VACUITY: BeenHereControl no longer reads useHasVisited into `visited`, so the assertion '
    + 'below is about a name that means something else now.',
  );
  assert.match(
    control,
    /placeReviewRequestFromCard\(\s*card\s*,\s*visited\s*\)/,
    'S-9: the tap no longer carries what useHasVisited said. That value is the ONLY evidence '
    + 'the app has about whether a half-landed visit is its own to undo — record-visit\'s isNew '
    + 'is computed from user_interactions and disagrees with user_visits in both directions '
    + '(#1694). Without it the write falls back to that flag and B-11a\'s orphan comes back.',
  );

  // 2 — the modal. One mount for the whole app, no useHasVisited of its own, and
  //     by submit time the answer would already have been changed by the write it
  //     is asking about. So it forwards; it must not re-derive.
  const modal = stripComments(read('modal'));
  assert.match(
    modal,
    /hadVisitBeforeTap:\s*voluntaryVisit\.hadVisitBeforeTap/,
    'S-9: the modal stopped forwarding the pre-tap answer into the write, so the request carries '
    + 'it and nothing reads it.',
  );

  // 3 — the write. The client's stated answer must OUTRANK the server flag, and
  //     the flag must be reachable only when nothing was stated.
  const service = stripComments(read('placeReviewService'));
  const fn = service.slice(service.indexOf('function visitIsOursToUndo'));
  assert.ok(fn.length > 80, 'S-9: visitIsOursToUndo is gone — the derivation moved or was inlined');
  const statedFalseAt = fn.indexOf('hadVisitBeforeTap === false');
  const statedTrueAt = fn.indexOf('hadVisitBeforeTap === true');
  // Anchored on the RETURN, not on the name: `serverIsNew` also appears in the
  // signature, which is above both branches by construction.
  const serverAt = fn.indexOf('return serverIsNew');
  assert.ok(statedFalseAt > 0, 'S-9: a stated "the user had no visit" is no longer honoured');
  assert.ok(statedTrueAt > 0, 'S-9: a stated "the user already had one" is no longer honoured');
  assert.ok(
    serverAt > statedFalseAt && serverAt > statedTrueAt,
    'S-9: record-visit\'s isNew is consulted BEFORE the client\'s own answer. It is the '
    + '[TRANSITIONAL] last resort for a caller that stated nothing, not the rule — reversing the '
    + 'order restores the P1 exactly.',
  );
  assert.ok(
    !/visitCreated\s*=\s*recorded\.isNew\s*===\s*true/.test(service),
    'S-9: the rollback guard is derived straight from record-visit\'s isNew again. Proven on '
    + 'device: a tap created user_visits 44c459c9 at 00:53:12.679 while the interaction row still '
    + 'read 18:31:05, and the function reported isNew:false for the row it had just created.',
  );

  // 4 — the model this whole file is built on. If #1694 ever makes isNew describe
  //     the user_visits upsert, the harness above is no longer faithful and the
  //     [TRANSITIONAL] fallback stops being a hazard — both need revisiting, and
  //     this is what will say so.
  const fnSrc = fs.readFileSync(RECORD_VISIT_FN, 'utf8');
  const isNewAt = fnSrc.indexOf('let isNew');
  assert.ok(isNewAt > 0, 'S-9: record-visit no longer computes isNew the way this harness models');
  const derivation = fnSrc.slice(fnSrc.indexOf('user_interactions'), isNewAt);
  assert.match(
    derivation,
    /interaction_type"?,?\s*,?\s*"visit"/,
    'S-9 (model check): record-visit no longer derives isNew from a user_interactions lookup. '
    + 'If #1694 landed and it now reports the user_visits upsert itself, this suite\'s stub is '
    + 'modelling a function that no longer exists — fix the stub, then re-read '
    + 'visitIsOursToUndo\'s [TRANSITIONAL] fallback, which exists only because of this.',
  );
  assert.ok(
    !/xmax/.test(fnSrc),
    'S-9 (model check): record-visit appears to report the upsert itself now (#1694). Same '
    + 'action as above — the stub and the fallback both assume it does not.',
  );
});
