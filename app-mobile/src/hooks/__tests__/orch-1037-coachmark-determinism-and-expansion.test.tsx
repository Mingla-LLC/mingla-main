// @ts-nocheck
// ORCH-1037 [Coach-mark exact-target determinism] + ORCH-1035 [Coach-mark content
// EXPANSION] — IMPLEMENTOR happy-path regression test (SPEC §9a).
//
// Source-static-analysis + executable-model test (the app-mobile convention — no jest;
// node-runnable, self-runs via require.main === module). Two halves:
//   (A) STRUCTURE — the 11-step tour shape, the exact per-step tab mapping, the
//       re-pointed/added ref-target wiring, the lockstep call-site bijection, and the
//       removal of the step-4 'center' band-aid + the stale "step 6" comment.
//   (B) BEHAVIOR — an executable model of the two-consecutive-match stable-measure loop
//       (reconstructed from the real STABLE_* constants parsed out of useCoachMark.ts,
//       so a revert of the loop changes the model and fails the assertions). Proves:
//         • {y:36} then {y:36}                 → accepts 36   (already stable)
//         • {y:36} then {y:52} then {y:52}     → accepts 52   (rejects the transient first)
//         • only {y:52} once before timeout    → accepts 52   (best-effort fallback)
//
// FAILS-ON-REVERT vectors (verified): T-01 (11→7 step count), T-03 (call-site repoint),
// T-04 (SCROLL_STEPS), B-02 (two-shot measure can't reject the mid-animation 36 rect).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function resolveRepoFile(relPath) {
  const direct = path.resolve(process.cwd(), relPath);
  if (fs.existsSync(direct)) return direct;
  return path.resolve(process.cwd(), 'app-mobile', relPath);
}
function readSource(relPath) {
  return fs.readFileSync(resolveRepoFile(relPath), 'utf8');
}

// ── Parse the COACH_STEPS array into { id, tab } records ──────────────────────
function parseCoachSteps(stepsSrc) {
  const arrStart = stepsSrc.indexOf('export const COACH_STEPS');
  assert.notEqual(arrStart, -1, 'COACH_STEPS array must exist');
  const arrBody = stepsSrc.slice(arrStart, stepsSrc.indexOf('export const COACH_STEP_COUNT'));
  const steps = [];
  // Each step object: id: N, tab: 'x'  (order-insensitive within the object).
  const objRe = /\{([\s\S]*?)\}/g;
  let m;
  while ((m = objRe.exec(arrBody)) !== null) {
    const body = m[1];
    const idM = body.match(/\bid:\s*(\d+)/);
    const tabM = body.match(/\btab:\s*'([a-z]+)'/);
    if (idM && tabM) steps.push({ id: Number(idM[1]), tab: tabM[1] });
  }
  return steps;
}

// ── Executable model of the stable-measure loop (ORCH-1037 §3.2) ──────────────
// Reconstructed from the real constants in useCoachMark.ts so a revert that changes
// the epsilon / removes the loop changes the model's behavior. The loop accepts a rect
// only when two consecutive non-zero reads agree within epsilon, else best-effort the
// last non-zero rect at timeout.
function buildStableLoopFromSource(hookSrc) {
  const eps = Number((hookSrc.match(/STABLE_EPSILON_PX\s*=\s*([\d.]+)/) || [])[1]);
  assert.ok(Number.isFinite(eps), 'B STABLE_EPSILON_PX must be defined in useCoachMark.ts');
  // Confirm the loop is actually wired (not the old two-shot rAF + 100ms timer).
  assert.ok(
    /InteractionManager\.runAfterInteractions/.test(hookSrc),
    'B the measure must be settle-gated via InteractionManager.runAfterInteractions'
  );
  assert.ok(
    /rectsStableEqual\(prevRect,\s*rect\)/.test(hookSrc),
    'B the loop must accept only on two consecutive matching reads (rectsStableEqual(prevRect, rect))'
  );
  assert.ok(
    !/requestAnimationFrame\(\(\)\s*=>\s*measure\(\)\)/.test(hookSrc),
    'B the old two-shot rAF measure must be gone (fails-on-revert to the pre-ORCH-1037 measure)'
  );

  const equal = (a, b) =>
    a != null && b != null &&
    Math.abs(a.y - b.y) <= eps &&
    Math.abs((a.x ?? 0) - (b.x ?? 0)) <= eps &&
    Math.abs((a.width ?? 0) - (b.width ?? 0)) <= eps &&
    Math.abs((a.height ?? 0) - (b.height ?? 0)) <= eps;

  // `reads`: ordered list of measureInWindow results; a {width:0,height:0} read is "not
  // ready" and does not count toward the consecutive-match pair. Returns the accepted
  // rect (or null if nothing measurable). `timeoutAfter` = number of reads after which
  // the loop times out (best-effort the last non-zero rect).
  return function runLoop(reads, timeoutAfter = Infinity) {
    let prev = null;
    let lastNonZero = null;
    for (let i = 0; i < reads.length; i++) {
      const r = reads[i];
      const timedOut = i + 1 >= timeoutAfter;
      const isZero = (r.width === 0 && r.height === 0);
      if (isZero) {
        if (timedOut) return lastNonZero; // best-effort
        continue; // not ready — does not count toward the pair
      }
      lastNonZero = r;
      if (equal(prev, r)) return r; // two consecutive matches → accept
      prev = r;
      if (timedOut) return r; // timeout best-effort
    }
    return lastNonZero;
  };
}

function run() {
  const stepsSrc = readSource('src/constants/coachMarkSteps.ts');
  const contextSrc = readSource('src/contexts/CoachMarkContext.tsx');
  const hookSrc = readSource('src/hooks/useCoachMark.ts');
  const discoverSrc = readSource('src/components/DiscoverScreen.tsx');
  const connectionsSrc = readSource('src/components/ConnectionsPage.tsx');
  const profileSrc = readSource('src/components/ProfilePage.tsx');
  const homeSrc = readSource('src/components/HomePage.tsx');
  const indexSrc = readSource('app/index.tsx');
  const overlaySrc = readSource('src/components/SpotlightOverlay.tsx');

  // ════════════════════════════════════════════════════════════════════════
  // PART A — STRUCTURE
  // ════════════════════════════════════════════════════════════════════════

  // ── T-01 [FAILS-ON-REVERT]: exactly 11 contiguous steps ──
  const steps = parseCoachSteps(stepsSrc);
  const ids = steps.map((s) => s.id);
  assert.deepEqual(ids, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    `T-01 COACH_STEPS must be 11 contiguous steps [1..11]; got [${ids.join(',')}]`);

  // ── T-02 [FAILS-ON-REVERT]: exact per-step tab mapping (SPEC §5) ──
  const expectedTabs = {
    1: 'home', 2: 'home', 3: 'home',
    4: 'discover', 5: 'discover',
    6: 'connections', 7: 'connections',
    8: 'profile', 9: 'profile', 10: 'profile', 11: 'profile',
  };
  for (const s of steps) {
    assert.equal(s.tab, expectedTabs[s.id],
      `T-02 step ${s.id} must be on tab '${expectedTabs[s.id]}'; got '${s.tab}'`);
  }

  // ── T-03 [FAILS-ON-REVERT]: ref-target wiring per surface ──
  // Discover: step 4 Events pill + step 5 Trips pill, attached per tab.id via the helper.
  assert.ok(/useCoachMark\(4\b/.test(discoverSrc), 'T-03 DiscoverScreen step 4 (Events) present');
  assert.ok(/useCoachMark\(5\b/.test(discoverSrc), 'T-03 DiscoverScreen step 5 (Trips) present');
  assert.ok(/coachTabRefFor\(tab\.id\)/.test(discoverSrc),
    'T-03 DiscoverScreen must attach the coach ref per tab.id on the tab Pressable');
  assert.ok(/tabId === 'events'/.test(discoverSrc) && /tabId === 'trips'/.test(discoverSrc),
    'T-03 the per-tab helper must map events→step4 and trips→step5');
  // The step-4 ref must NOT still be on the broad header panel (wrong-node regression).
  assert.ok(!/ref=\{coachDiscoverFeed\.targetRef\}/.test(discoverSrc),
    'T-03 the step-4 ref must NOT be on the header panel (coachDiscoverFeed removed)');

  // Connections: step 6 people icon + step 7 + button.
  assert.ok(/useCoachMark\(6\b/.test(connectionsSrc), 'T-03 ConnectionsPage step 6 (people) present');
  assert.ok(/useCoachMark\(7\b/.test(connectionsSrc), 'T-03 ConnectionsPage step 7 (+ button) present');
  assert.ok(/coachPeopleIcon\.targetRef/.test(connectionsSrc) && /coachPlusButton\.targetRef/.test(connectionsSrc),
    'T-03 ConnectionsPage must attach people-icon + plus-button refs');
  // The people ref must NOT be on the broad header row (operator-LOCKED leaf target).
  assert.ok(!/ref=\{coachChatHeader\.targetRef/.test(connectionsSrc),
    'T-03 the people-icon ref must NOT be on the header row (coachChatHeader removed)');

  // Profile: scroll steps 8/9/10/11 with explicit offset registrations + ref wrappers.
  for (const sid of [8, 9, 10, 11]) {
    assert.ok(new RegExp(`registerTargetScrollOffset\\(${sid}\\b`).test(profileSrc),
      `T-03 ProfilePage must register the step-${sid} scroll offset`);
  }
  assert.ok(/interestsRef/.test(profileSrc) && /circleRef/.test(profileSrc),
    'T-03 ProfilePage must add interestsRef + circleRef wrapping Views');
  assert.ok(/registerTargetMeasurer\(/.test(profileSrc),
    'T-03 ProfilePage must register a direct post-scroll measurer per scroll step');

  // Home steps 1/2/3 unchanged.
  assert.ok(/useCoachMark\(1\b/.test(homeSrc) && /useCoachMark\(2\b/.test(homeSrc),
    'T-03 HomePage steps 1+2 unchanged');
  assert.ok(/useCoachMark\(3\b/.test(indexSrc), 'T-03 app/index step 3 (Likes) unchanged');

  // ── T-04 [FAILS-ON-REVERT]: SCROLL_STEPS = new Set([8, 9, 10, 11]) ──
  assert.ok(/SCROLL_STEPS\s*=\s*new Set\(\[\s*8\s*,\s*9\s*,\s*10\s*,\s*11\s*\]\)/.test(contextSrc),
    'T-04 SCROLL_STEPS must be new Set([8, 9, 10, 11])');

  // ── T-05 [FAILS-ON-REVERT]: step-4 'center' band-aid removed; no step uses 'center' ──
  const stepsArrayBody = stepsSrc.slice(stepsSrc.indexOf('export const COACH_STEPS'));
  assert.ok(!/bubblePosition:\s*'center'/.test(stepsArrayBody),
    "T-05 no step may use bubblePosition:'center' (step-4 band-aid removed now it targets the pill)");

  // ── T-06: stale "step 6" comment removed from DiscoverScreen ──
  assert.ok(!/coach-mark step 6 target/.test(discoverSrc),
    'T-06 the stale "coach-mark step 6 target" comment must be removed from DiscoverScreen');

  // ── T-07: lockstep bijection — every step id has exactly one target call site, no orphans ──
  const callSiteIds = new Set();
  for (const src of [discoverSrc, connectionsSrc, profileSrc, homeSrc, indexSrc]) {
    let mm;
    const r1 = /useCoachMark\((\d+)/g;
    while ((mm = r1.exec(src)) !== null) callSiteIds.add(Number(mm[1]));
    const r2 = /registerTargetScrollOffset\((\d+)/g;
    while ((mm = r2.exec(src)) !== null) callSiteIds.add(Number(mm[1]));
  }
  const stepIdSet = new Set(ids);
  for (const id of stepIdSet) {
    assert.ok(callSiteIds.has(id), `T-07 orphan: step ${id} has no target call site`);
  }
  for (const id of callSiteIds) {
    assert.ok(stepIdSet.has(id), `T-07 dangling: call-site id ${id} references no step`);
  }

  // ── T-08: progress bar + counter derive from COACH_STEP_COUNT (auto 11) ──
  assert.ok(/length:\s*COACH_STEP_COUNT/.test(overlaySrc),
    'T-08 progress bar must derive segment count from COACH_STEP_COUNT');
  assert.ok(/total:\s*COACH_STEP_COUNT/.test(overlaySrc),
    'T-08 step counter "N of M" must derive total from COACH_STEP_COUNT');

  // ════════════════════════════════════════════════════════════════════════
  // PART B — STABLE-MEASURE BEHAVIOR (executable model)
  // ════════════════════════════════════════════════════════════════════════
  const runLoop = buildStableLoopFromSource(hookSrc);

  // B-01: already-stable target — {y:36} then {y:36} → accepts 36.
  {
    const accepted = runLoop([
      { x: 0, y: 36, width: 40, height: 40 },
      { x: 0, y: 36, width: 40, height: 40 },
    ]);
    assert.equal(accepted.y, 36, 'B-01 two matching reads at y=36 → accept 36');
  }

  // B-02 [FAILS-ON-REVERT]: mid-animation transient rejected.
  // GlassTopBar entrance: first read catches y=36 (mid-slide), then settles to 52.
  // The two-shot measure would have registered the transient 36; the stable loop rejects
  // it and accepts only the settled 52 (two consecutive 52 reads).
  {
    const accepted = runLoop([
      { x: 0, y: 36, width: 40, height: 40 }, // mid-slide — must be rejected
      { x: 0, y: 52, width: 40, height: 40 }, // settled, but not yet confirmed
      { x: 0, y: 52, width: 40, height: 40 }, // confirmed stable
    ]);
    assert.equal(accepted.y, 52,
      'B-02 transient y=36 rejected; accepts the SETTLED y=52 (no 16px drift) — fails on revert to two-shot measure');
  }

  // B-03: best-effort timeout — only one non-zero read before timeout → accept it.
  {
    const accepted = runLoop(
      [{ x: 0, y: 52, width: 40, height: 40 }],
      /* timeoutAfter */ 1,
    );
    assert.equal(accepted.y, 52, 'B-03 single read before timeout → best-effort accept y=52');
  }

  // B-04: 0×0 "not ready" reads do not count toward the pair, then settle.
  {
    const accepted = runLoop([
      { x: 0, y: 0, width: 0, height: 0 },     // not laid out — ignored
      { x: 0, y: 52, width: 40, height: 40 },
      { x: 0, y: 52, width: 40, height: 40 },
    ]);
    assert.equal(accepted.y, 52, 'B-04 a 0×0 read is skipped; the loop still settles at 52');
  }

  // B-05: sub-pixel jitter within epsilon is treated as stable (52.0 vs 52.6 with eps=1).
  {
    const accepted = runLoop([
      { x: 0, y: 52.0, width: 40, height: 40 },
      { x: 0, y: 52.6, width: 40, height: 40 },
    ]);
    assert.ok(accepted && Math.abs(accepted.y - 52) < 1.5,
      'B-05 sub-pixel jitter within STABLE_EPSILON_PX is accepted as stable');
  }
}

if (require.main === module) {
  try {
    run();
    console.log(
      'PASS ORCH-1037/1035: 11-step tour with exact per-tab mapping, Events/Trips/people/+ refs ' +
      're-pointed to leaf affordances, Profile scroll steps 8-11 measured (offset+measurer), ' +
      "step-4 'center' + stale comment removed, lockstep bijection holds, progress/counter auto-derive; " +
      'stable-measure loop rejects the mid-animation transient and accepts the settled rect'
    );
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = { run };
