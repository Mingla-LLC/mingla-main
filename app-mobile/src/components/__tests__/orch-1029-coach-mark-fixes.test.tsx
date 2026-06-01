// @ts-nocheck
// ORCH-1029 [Coach-mark cross-device fixes] — IMPLEMENTOR happy-path regression test.
//
// Source-static-analysis test (the app-mobile component-test convention — see
// orch-0995-bottom-nav-spotlight-ui-thread.test.tsx): reads the coach-mark module files
// as strings and asserts the structural shape of the four fixes. node-runnable
// (no jest in app-mobile); self-runs via require.main === module.
//
// Covers (spec §6 Test 1):
//   T-01  tour is 7 steps, ids [1..7], no "Better together"/"Back to solo" (F-2)
//   T-02  id === arrayIndex + 1 (contiguous/ordered) (F-2)
//   T-03  the four call-site ids ∪ scroll-offset ids == {1..7} (F-2 lockstep repoint)
//   T-04  SCROLL_STEPS literal is new Set([6, 7]) (F-2 highest-risk literal)
//   T-05  SpotlightOverlay has a fullscreen-rejection / plausibility clamp (F-1)
//   T-06  both Android correction sites use insets.top, neither uses
//         StatusBar.currentHeight; useCoachMark imports useSafeAreaInsets (F-4)
//   T-07  ProfilePage registers Profile offsets via onLayout, not a bare 800ms timer (F-3)
//   T-08  orphan-step CI assertion (spec §10): COACH_STEPS ids ⇔ call-site ids bijection
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

// Parse the numeric `id:` values from the COACH_STEPS array in coachMarkSteps.ts.
function parseCoachStepIds(stepsSrc) {
  const arrStart = stepsSrc.indexOf('export const COACH_STEPS');
  assert.notEqual(arrStart, -1, 'COACH_STEPS array must exist');
  const arrBody = stepsSrc.slice(arrStart);
  const ids = [];
  const re = /\bid:\s*(\d+)\b/g;
  let m;
  while ((m = re.exec(arrBody)) !== null) {
    ids.push(Number(m[1]));
  }
  return ids;
}

// Collect every useCoachMark(<n>) / registerTargetScrollOffset(<n>) id from the call-site
// files (excludes the hook definition file useCoachMark.ts whose JSDoc uses useCoachMark(2)).
function parseCallSiteIds(sources) {
  const ids = new Set();
  for (const src of sources) {
    let m;
    const re1 = /useCoachMark\((\d+)/g;
    while ((m = re1.exec(src)) !== null) ids.add(Number(m[1]));
    const re2 = /registerTargetScrollOffset\((\d+)/g;
    while ((m = re2.exec(src)) !== null) ids.add(Number(m[1]));
  }
  return ids;
}

function runOrch1029CoachMarkFixesTest() {
  const stepsSrc = readSource('src/constants/coachMarkSteps.ts');
  const contextSrc = readSource('src/contexts/CoachMarkContext.tsx');
  const overlaySrc = readSource('src/components/SpotlightOverlay.tsx');
  const hookSrc = readSource('src/hooks/useCoachMark.ts');
  const discoverSrc = readSource('src/components/DiscoverScreen.tsx');
  const connectionsSrc = readSource('src/components/ConnectionsPage.tsx');
  const profileSrc = readSource('src/components/ProfilePage.tsx');
  const homeSrc = readSource('src/components/HomePage.tsx');
  const indexSrc = readSource('app/index.tsx');

  // ── T-01 [FAILS-ON-REVERT]: 7 steps, ids [1..7], deleted-step titles gone ──
  const ids = parseCoachStepIds(stepsSrc);
  assert.deepEqual(
    ids,
    [1, 2, 3, 4, 5, 6, 7],
    `T-01 COACH_STEPS must be exactly 7 steps with ids [1..7]; got [${ids.join(',')}]`
  );
  // Scope the deleted-title check to the COACH_STEPS array body, not the header comment
  // (the header documents the deletion and legitimately names the old titles).
  const stepsArrayBody = stepsSrc.slice(stepsSrc.indexOf('export const COACH_STEPS'));
  assert.ok(
    !/title:\s*['"]Better together['"]/.test(stepsArrayBody),
    'T-01 deleted step "Better together" must NOT appear as a COACH_STEPS title'
  );
  assert.ok(
    !/title:\s*['"]Back to solo['"]/.test(stepsArrayBody),
    'T-01 deleted step "Back to solo" must NOT appear as a COACH_STEPS title'
  );

  // ── T-02 [FAILS-ON-REVERT]: contiguous/ordered (id === index + 1) ──
  ids.forEach((id, i) => {
    assert.equal(
      id,
      i + 1,
      `T-02 step at array index ${i} must have id ${i + 1} (contiguous/ordered); got ${id}`
    );
  });

  // ── T-03 [FAILS-ON-REVERT]: each call site repointed ──
  assert.ok(
    /useCoachMark\(4\b/.test(discoverSrc),
    'T-03 DiscoverScreen must use useCoachMark(4 (renumbered from 6)'
  );
  assert.ok(
    !/useCoachMark\(6\b/.test(discoverSrc),
    'T-03 DiscoverScreen must NOT still use useCoachMark(6'
  );
  assert.ok(
    /useCoachMark\(5\b/.test(connectionsSrc),
    'T-03 ConnectionsPage must use useCoachMark(5 (renumbered from 7)'
  );
  assert.ok(
    !/useCoachMark\(7\b/.test(connectionsSrc),
    'T-03 ConnectionsPage must NOT still use useCoachMark(7'
  );
  assert.ok(
    /registerTargetScrollOffset\(6\b/.test(profileSrc),
    'T-03 ProfilePage must register step 6 offset (renumbered from 8)'
  );
  assert.ok(
    /registerTargetScrollOffset\(7\b/.test(profileSrc),
    'T-03 ProfilePage must register step 7 offset (renumbered from 9)'
  );
  assert.ok(
    !/registerTargetScrollOffset\(8\b/.test(profileSrc) &&
      !/registerTargetScrollOffset\(9\b/.test(profileSrc),
    'T-03 ProfilePage must NOT still register step 8/9 offsets'
  );
  // ids 1,2,3 unchanged at their call sites
  assert.ok(/useCoachMark\(1\b/.test(homeSrc), 'T-03 HomePage step 1 unchanged');
  assert.ok(/useCoachMark\(2\b/.test(homeSrc), 'T-03 HomePage step 2 unchanged');
  assert.ok(/useCoachMark\(3\b/.test(indexSrc), 'T-03 app/index step 3 unchanged');

  // ── T-04 [FAILS-ON-REVERT]: SCROLL_STEPS literal is new Set([6, 7]) ──
  assert.ok(
    /SCROLL_STEPS\s*=\s*new Set\(\[\s*6\s*,\s*7\s*\]\)/.test(contextSrc),
    'T-04 SCROLL_STEPS must be new Set([6, 7]) (renumbered from [8, 9])'
  );
  assert.ok(
    !/SCROLL_STEPS\s*=\s*new Set\(\[\s*8\s*,\s*9\s*\]\)/.test(contextSrc),
    'T-04 SCROLL_STEPS must NOT be the stale new Set([8, 9])'
  );

  // ── T-05 [FAILS-ON-REVERT]: fullscreen-rejection / plausibility clamp (F-1) ──
  // The overlay must reject a near-fullscreen rect (Android whole-screen-cutout case)
  // via a width/height-vs-screen ratio guard. The bare `width>0 && height>0` test on
  // its own is NOT sufficient as the cutout gate.
  assert.ok(
    /screenWidth\s*\*\s*0\.9\d*/.test(overlaySrc) &&
      /screenHeight\s*\*\s*0\.8\d*/.test(overlaySrc),
    'T-05 SpotlightOverlay must have a fullscreen-rejection clamp (width vs screenWidth*0.9x AND height vs screenHeight*0.8x)'
  );
  assert.ok(
    /isPlausibleCutout/.test(overlaySrc),
    'T-05 SpotlightOverlay must define a plausibility predicate (isPlausibleCutout)'
  );
  assert.ok(
    /step1HoldingForDeck|HoldingForDeck/.test(overlaySrc),
    'T-05 SpotlightOverlay must hold step 1 until a plausible deck rect arrives'
  );

  // ── T-06 [FAILS-ON-REVERT]: Android correction uses insets.top, not StatusBar (F-4) ──
  for (const [name, src] of [['CoachMarkContext', contextSrc], ['useCoachMark', hookSrc]]) {
    assert.ok(
      /Platform\.OS === 'android'[\s\S]{0,80}\+\s*insets\.top/.test(src),
      `T-06 ${name} Android branch must add insets.top as the correction term`
    );
    assert.ok(
      !/\+\s*\(?\s*StatusBar\.currentHeight/.test(src),
      `T-06 ${name} must NOT use StatusBar.currentHeight as the additive correction (re-breaks Android 15)`
    );
  }
  assert.ok(
    /import\s*\{\s*useSafeAreaInsets\s*\}\s*from\s*['"]react-native-safe-area-context['"]/.test(hookSrc),
    'T-06 useCoachMark.ts must import useSafeAreaInsets'
  );

  // ── T-07 [FAILS-ON-REVERT]: ProfilePage offset registration is onLayout-driven, not 800ms (F-3) ──
  assert.ok(
    !/setTimeout\([\s\S]{0,400}registerTargetScrollOffset[\s\S]{0,400}\}\s*,\s*800\s*\)/.test(profileSrc),
    'T-07 ProfilePage must NOT register the scroll offsets inside a setTimeout(…, 800) (the race)'
  );
  assert.ok(
    /onLayout/.test(profileSrc) && /measureLayout/.test(profileSrc),
    'T-07 ProfilePage must register offsets via an onLayout-driven measureLayout'
  );
  // CoachMarkContext scrollToKnownPosition must gate on offset presence (poll/retry),
  // not scrollToEnd-to-footer on first miss.
  assert.ok(
    /OFFSET_POLL_MAX_ATTEMPTS|tryScroll/.test(contextSrc),
    'T-07 CoachMarkContext scrollToKnownPosition must poll for the registered offset (gated, not read-once)'
  );
  assert.ok(
    !/scrollToEnd\?\.\(\{\s*animated:\s*true\s*\}\);/.test(contextSrc),
    'T-07 CoachMarkContext must NOT scrollToEnd-to-footer as the missing-offset fallback'
  );

  // ── T-08: orphan-step bijection (spec §10 CI assertion) ──
  const callSiteIds = parseCallSiteIds([discoverSrc, connectionsSrc, profileSrc, homeSrc, indexSrc]);
  const stepIdSet = new Set(ids);
  for (const id of stepIdSet) {
    assert.ok(
      callSiteIds.has(id),
      `T-08 every COACH_STEPS id must have a target call site; id ${id} is orphaned`
    );
  }
  for (const id of callSiteIds) {
    assert.ok(
      stepIdSet.has(id),
      `T-08 every call-site id must exist in COACH_STEPS; id ${id} references a missing step`
    );
  }
}

if (require.main === module) {
  try {
    runOrch1029CoachMarkFixesTest();
    console.log(
      'PASS T-01..T-08 ORCH-1029 coach-mark fixes: 7 contiguous steps, four call sites repointed, SCROLL_STEPS=[6,7], F-1 plausibility clamp, F-4 insets.top correction, F-3 onLayout offset registration, no orphan steps'
    );
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = { runOrch1029CoachMarkFixesTest };
