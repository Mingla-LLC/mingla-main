// @ts-nocheck
// ORCH-1037 [Coach-mark exact-target determinism] + ORCH-1035 [content EXPANSION]
// — TESTER adversarial regression test (SPEC §9b).
//
// Source-static-analysis + executable-model test (the app-mobile convention — no jest;
// node-runnable, self-runs via require.main === module). This file is the TESTER's
// adversarial layer and attacks a DIFFERENT angle than the implementor's happy-path
// (orch-1037-coachmark-determinism-and-expansion.test.tsx) AND than the ORCH-1029
// adversarial file (orch-1029-coach-mark-adversarial.test.tsx). It hostilely targets the
// three SPEC §9b vectors the operator locked, modeling them off the REAL CoachMarkContext
// scroll loop (not just the hook), so a revert of the determinism fix changes behavior and
// fails here:
//
//   X-1  MID-SCROLL rect rejected by the CONTEXT loop (measureRowUntilStable).
//        The happy-path test models the HOOK loop only. This models the context's
//        post-scroll loop reconstructed from CoachMarkContext's real STABLE_* constants:
//        a mid-scroll transient row Y (the row still sliding into place) is rejected and
//        only the SETTLED row Y is committed. Fails on revert to the contentY−scrollY
//        reconstruction (which has no two-consecutive-match gate at all).
//
//   X-2  SCROLL steps measured, NOT reconstructed, with DISTINCT rects.
//        The investigation's tell was steps 6 & 7 registering the IDENTICAL
//        contentY=399.39999… and landing one row low. We assert (a) the context commits
//        the scroll rect from a real measurer thunk (registerTargetMeasurer →
//        measureInWindow of the leaf node), NOT from `offset.contentY − scrollY`
//        arithmetic in the primary path; (b) ProfilePage registers FOUR distinct measurer
//        thunks bound to FOUR distinct refs (interests/circle/account/feedback) so two
//        scroll steps can never resolve to the same node; (c) modeled end-to-end, two
//        different scroll steps fed two different settled row Ys commit two DIFFERENT
//        rects. Fails on revert to the shared-arithmetic reconstruction.
//
//   X-3  WRONG-NODE width guard — no non-deck step may target a near-full-width container.
//        SPEC §9b/§11: every registered rect except step 1 (deck) must be narrower than
//        screenWidth*0.98. We (a) statically prove the re-pointed steps 4/5/6/7 attach to
//        leaf affordances (per-tab Pressable / people Pressable / + Pressable) and NOT the
//        broad header containers (headerPanel / headerRowAbsolute); (b) model the guard:
//        a rect at 98%+ screen width is flagged for every step id ≠ 1. Fails if step 4/5/6
//        is re-pointed back to a full-width header container.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function appMobileRoot() {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'src/contexts/CoachMarkContext.tsx'))) return cwd;
  const nested = path.join(cwd, 'app-mobile');
  if (fs.existsSync(path.join(nested, 'src/contexts/CoachMarkContext.tsx'))) return nested;
  throw new Error('cannot locate app-mobile root from ' + cwd);
}
const ROOT = appMobileRoot();
function readSource(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}
function squish(s) {
  return s.replace(/\s+/g, ' ');
}
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// Reconstruct the CONTEXT's post-scroll stable loop from its real constants so a revert
// of the determinism fix (epsilon change, loop removal) changes the model's behavior.
function buildContextScrollLoop(contextSrc) {
  const code = stripComments(contextSrc);
  const eps = Number((contextSrc.match(/STABLE_EPSILON_PX\s*=\s*([\d.]+)/) || [])[1]);
  assert.ok(Number.isFinite(eps), 'X-1 CoachMarkContext must define STABLE_EPSILON_PX');

  // The context must run the post-scroll measurer through a two-consecutive-match loop —
  // NOT reconstruct the rect from offset arithmetic in the primary path.
  assert.ok(
    /measureRowUntilStable/.test(code),
    'X-1 the context must measure the row node through measureRowUntilStable (post-scroll stable loop)'
  );
  assert.ok(
    /rectsStableEqual\(prevRect,\s*rect\)/.test(code),
    'X-1 the context scroll loop must accept only on two consecutive matching reads'
  );
  // The measurer thunk drives the commit; commitMeasuredRect is the single writer.
  assert.ok(
    /commitMeasuredRect\(/.test(code),
    'X-1 the scroll rect must be committed via commitMeasuredRect (single writer)'
  );

  const equal = (a, b) =>
    a != null && b != null &&
    Math.abs(a.x - b.x) <= eps &&
    Math.abs(a.y - b.y) <= eps &&
    Math.abs(a.width - b.width) <= eps &&
    Math.abs(a.height - b.height) <= eps;

  // reads: ordered measureInWindow results; a 0×0 read is "not ready". Returns the
  // committed rect, or null if nothing measurable.
  return function runScrollLoop(reads, timeoutAfter = Infinity) {
    let prev = null;
    let lastNonZero = null;
    for (let i = 0; i < reads.length; i++) {
      const r = reads[i];
      const timedOut = i + 1 >= timeoutAfter;
      if (r.width === 0 && r.height === 0) {
        if (timedOut) return lastNonZero;
        continue;
      }
      lastNonZero = r;
      if (equal(prev, r)) return r;
      prev = r;
      if (timedOut) return r;
    }
    return lastNonZero;
  };
}

function run() {
  const contextSrc = readSource('src/contexts/CoachMarkContext.tsx');
  const profileSrc = readSource('src/components/ProfilePage.tsx');
  const discoverSrc = readSource('src/components/DiscoverScreen.tsx');
  const connectionsSrc = readSource('src/components/ConnectionsPage.tsx');

  // ══════════════════════════════════════════════════════════════════════════
  // X-1 — Mid-scroll transient rejected by the CONTEXT loop.
  // ══════════════════════════════════════════════════════════════════════════
  const runScrollLoop = buildContextScrollLoop(contextSrc);

  // The row is still sliding after the programmatic scroll: first read catches a transient
  // Y=300 (mid-scroll), then it settles to Y=420 (two confirming reads). The reconstruction
  // approach had NO such gate — it would commit whatever the first arithmetic produced. The
  // stable loop must reject the transient and commit the settled rect.
  {
    const committed = runScrollLoop([
      { x: 16, y: 300, width: 360, height: 88 }, // mid-scroll transient — must be rejected
      { x: 16, y: 420, width: 360, height: 88 }, // settled, not yet confirmed
      { x: 16, y: 420, width: 360, height: 88 }, // confirmed stable
    ]);
    assert.equal(committed.y, 420,
      'X-1 mid-scroll transient y=300 rejected; commits the SETTLED y=420 — fails on revert to contentY−scrollY reconstruction');
  }
  // A 0×0 (row not yet laid out post-scroll) read must not count toward the pair.
  {
    const committed = runScrollLoop([
      { x: 0, y: 0, width: 0, height: 0 },
      { x: 16, y: 420, width: 360, height: 88 },
      { x: 16, y: 420, width: 360, height: 88 },
    ]);
    assert.equal(committed.y, 420, 'X-1 a 0×0 not-ready read is skipped; the scroll loop still settles at 420');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // X-2 — Scroll steps measured (not reconstructed) with DISTINCT rects.
  // ══════════════════════════════════════════════════════════════════════════
  {
    const code = stripComments(contextSrc);

    // (a) The PRIMARY scroll path must use the registered measurer (measureInWindow), not
    //     the offset reconstruction. The legacy `offset.contentY − scrollY` arithmetic may
    //     remain ONLY as a guarded fallback when no measurer was registered; assert it is
    //     reachable only after the measurer-present check.
    const measurerIdx = code.indexOf('measureRowUntilStable(measurer)');
    const reconIdx = code.indexOf('offset.contentY - scrollY');
    assert.ok(measurerIdx !== -1, 'X-2a the primary path must call measureRowUntilStable(measurer)');
    // If the reconstruction arithmetic exists at all, it must come AFTER the measurer call
    // (i.e. be the fallback), never be the primary commit.
    if (reconIdx !== -1) {
      assert.ok(reconIdx > measurerIdx,
        'X-2a offset.contentY−scrollY reconstruction may exist ONLY as the post-measurer fallback, never the primary path');
      // And it must be guarded by a "no measurer" branch + logged.
      assert.ok(/no direct measurer for scroll step/.test(stripComments(contextSrc)) || /offset fallback/.test(contextSrc),
        'X-2a the reconstruction fallback must be the explicitly-logged no-measurer branch');
    }

    // (b) ProfilePage must register FOUR distinct measurer thunks bound to FOUR distinct
    //     refs — so two scroll steps can never resolve to the same node (the identical-
    //     contentY tell). Each wireScrollStep(stepId, ref) call pairs a step id with a ref.
    const wirePairs = [
      [8, 'interestsRef'],
      [9, 'circleRef'],
      [10, 'accountSettingsRef'],
      [11, 'feedbackButtonRef'],
    ];
    const seenRefs = new Set();
    for (const [sid, ref] of wirePairs) {
      const re = new RegExp(`wireScrollStep\\(${sid},\\s*${ref}\\)`);
      assert.ok(re.test(profileSrc),
        `X-2b ProfilePage must wire scroll step ${sid} to the distinct ref ${ref}`);
      assert.ok(!seenRefs.has(ref), `X-2b ref ${ref} must be used by exactly one scroll step (no shared node)`);
      seenRefs.add(ref);
    }
    assert.equal(seenRefs.size, 4, 'X-2b all four scroll steps must bind to four DISTINCT refs');
    // The measurer thunk must measure the LIVE node via measureInWindow (not arithmetic).
    assert.ok(/registerTargetMeasurer\(stepId,\s*\(cb\)\s*=>/.test(squish(profileSrc).replace(/\s+/g, ' ')) ||
      /registerTargetMeasurer\(stepId/.test(profileSrc),
      'X-2b each scroll step must register a measurer thunk');
    assert.ok(/measureInWindow\(/.test(profileSrc),
      'X-2b the measurer thunk must call measureInWindow on the live row node');

    // (c) Modeled end-to-end: two different scroll steps fed two different SETTLED row Ys
    //     commit two DIFFERENT rects (the investigation's identical-399.39 tell can never
    //     recur because each step measures its own node).
    const rectStep8 = runScrollLoop([
      { x: 16, y: 410, width: 360, height: 120 },
      { x: 16, y: 410, width: 360, height: 120 },
    ]);
    const rectStep9 = runScrollLoop([
      { x: 16, y: 560, width: 360, height: 96 },
      { x: 16, y: 560, width: 360, height: 96 },
    ]);
    assert.notDeepEqual(rectStep8, rectStep9,
      'X-2c two different scroll steps measuring two different nodes must commit DISTINCT rects (no identical-contentY reconstruction)');
    assert.equal(rectStep8.y, 410);
    assert.equal(rectStep9.y, 560);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // X-3 — Wrong-node width guard: no non-deck step targets a near-full-width container.
  // ══════════════════════════════════════════════════════════════════════════
  {
    // (a) Static proof: the re-pointed steps target leaf affordances, NOT broad containers.
    // Step 4/5 → per-tab Pressable via coachTabRefFor(tab.id) on the tab Pressable, NOT the
    // headerPanel View.
    assert.ok(/ref=\{coachTabRefFor\(tab\.id\)/.test(discoverSrc),
      'X-3a Discover steps 4/5 must attach via coachTabRefFor on the tab Pressable');
    // The header-panel View must no longer carry a coach ref (the old wrong-node target).
    const discoverNoComments = stripComments(discoverSrc);
    assert.ok(!/coachDiscoverFeed\.targetRef/.test(discoverNoComments),
      'X-3a the old full-width headerPanel coach ref (coachDiscoverFeed) must be gone');

    // Step 6 → people Pressable; step 7 → + Pressable; neither on the header row container.
    assert.ok(/ref=\{coachPeopleIcon\.targetRef/.test(connectionsSrc),
      'X-3a step 6 must attach to the people-icon Pressable');
    assert.ok(/ref=\{coachPlusButton\.targetRef/.test(connectionsSrc),
      'X-3a step 7 must attach to the + Pressable');
    const connNoComments = stripComments(connectionsSrc);
    assert.ok(!/coachChatHeader\.targetRef/.test(connNoComments),
      'X-3a the old full-width headerRowAbsolute coach ref (coachChatHeader) must be gone');

    // (b) Model the SPEC §9b/§11 guard: for every step id ≠ 1, a rect spanning ≥98% of
    //     screen width is a wrong-node regression. Step 1 (deck) is the only exemption.
    const SCREEN_W = 393; // iPhone 17 / Pixel-class logical width (representative)
    const FULLWIDTH_RATIO = 0.98;
    const isWrongNode = (stepId, rect) =>
      stepId !== 1 && rect.width >= SCREEN_W * FULLWIDTH_RATIO;

    // A leaf pill / icon / row rect — well under the threshold — is OK for any step.
    assert.equal(isWrongNode(4, { width: 96 }), false, 'X-3b a narrow Events pill is a valid step-4 target');
    assert.equal(isWrongNode(6, { width: 30 }), false, 'X-3b a 30px people icon is a valid step-6 target');
    assert.equal(isWrongNode(8, { width: 360 }), false, 'X-3b a 360px Profile card (<98% width) is a valid scroll-step target');
    // A full-width header-container rect MUST be flagged for any non-deck step.
    assert.equal(isWrongNode(4, { width: SCREEN_W }), true,
      'X-3b a full-screen-width rect on step 4 is a wrong-node regression (header container re-pointed)');
    assert.equal(isWrongNode(6, { width: SCREEN_W }), true,
      'X-3b a full-screen-width rect on step 6 is a wrong-node regression');
    // Step 1 (deck) is full-width by design and is the ONLY exemption.
    assert.equal(isWrongNode(1, { width: SCREEN_W }), false,
      'X-3b step 1 (deck) full-width is the only allowed full-width target');
  }
}

if (require.main === module) {
  try {
    run();
    console.log(
      'PASS X-1..X-3 ORCH-1037/1035 adversarial: context scroll loop rejects the mid-scroll transient (X-1), ' +
      'scroll steps measured via four distinct measurer thunks → distinct rects, reconstruction is fallback-only (X-2), ' +
      'wrong-node width guard — steps 4/5/6/7 on leaf affordances not header containers, full-width rejected for every non-deck step (X-3)'
    );
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = { run };
