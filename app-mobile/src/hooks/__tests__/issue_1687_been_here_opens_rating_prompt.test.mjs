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
};

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
export const db = { user_visits: [], place_reviews: [], invokes: [] };
export const control = { reviewInsertFails: false, recordVisitFails: false };
export function resetDb() {
  db.user_visits.length = 0;
  db.place_reviews.length = 0;
  db.invokes.length = 0;
  control.reviewInsertFails = false;
  control.recordVisitFails = false;
}

let visitSeq = 0;
let reviewSeq = 0;

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
      // The edge function UPSERTS on (user_id, experience_id).
      const existing = db.user_visits.find((r) => r.experience_id === experienceId);
      if (existing) {
        existing.visited_at = new Date().toISOString();
        return { data: { visitId: existing.id, isNew: false }, error: null };
      }
      visitSeq += 1;
      const row = {
        id: 'visit-' + visitSeq,
        experience_id: experienceId,
        card_data: cardData,
        visited_at: new Date().toISOString(),
        source: 'manual',
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
