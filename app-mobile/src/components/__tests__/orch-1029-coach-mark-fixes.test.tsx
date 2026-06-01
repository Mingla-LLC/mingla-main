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
//   T-09  BEHAVIORAL (REWORK): the recalibrated isPlausibleCutout predicate ACCEPTS a
//         full-width-but-not-full-height deck rect ({0,2,375,589} on 375×667) AND still
//         REJECTS a true whole-screen rect ({0,2,448,879} on 448×896). This is the exact
//         gap the static-grep suite missed (a grep cannot tell a mis-calibrated threshold
//         from a correct one). The predicate body is extracted from source and executed.
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

// Derive an executable `(rect, screenWidth, screenHeight) => boolean` model of the source
// predicate, WITHOUT eval/new Function (no code-injection surface; source is parsed, never
// executed). The model is reconstructed from the structural facts present in the source so
// it tracks the source's actual decision:
//   • REWORK form  → whole-screen rejection: reject ONLY when width ≥ W·ratio AND
//                    height ≥ H·ratio AND y ≤ topInset (constants read from source).
//   • PRE-REWORK   → upper-bound clamp: accept ONLY when width ≤ W·0.96 AND height ≤ H·0.85.
// A revert to the pre-rework clamp therefore drives the model to REJECT the full-width deck
// rect, failing T-09 (fails-on-revert).
function buildIsPlausibleCutoutFromSource(overlaySrc) {
  const start = overlaySrc.indexOf('const isPlausibleCutout');
  assert.notEqual(start, -1, 'T-09 isPlausibleCutout must exist in SpotlightOverlay source');

  const num = (re, fallback) => {
    const m = overlaySrc.match(re);
    return m ? Number(m[1]) : fallback;
  };

  // REWORK shape: a whole-screen rejection gated on BOTH width and height ratios.
  const hasWidthRatio = /screenWidth\s*\*\s*FULLSCREEN_WIDTH_RATIO/.test(overlaySrc);
  const hasHeightRatio = /screenHeight\s*\*\s*FULLSCREEN_HEIGHT_RATIO/.test(overlaySrc);
  const reworkShape = hasWidthRatio && hasHeightRatio;

  // PRE-REWORK shape: an upper-bound clamp `width <= screenWidth*0.9x && height <= screenHeight*0.8x`.
  const preReworkShape =
    /t\.width\s*<=\s*screenWidth\s*\*\s*0\.9/.test(overlaySrc) &&
    /t\.height\s*<=\s*screenHeight\s*\*\s*0\.8/.test(overlaySrc);

  if (reworkShape) {
    const wRatio = num(/FULLSCREEN_WIDTH_RATIO\s*=\s*([\d.]+)/, 0.98);
    const hRatio = num(/FULLSCREEN_HEIGHT_RATIO\s*=\s*([\d.]+)/, 0.95);
    const topInset = num(/FULLSCREEN_TOP_INSET\s*=\s*([\d.]+)/, 64);
    return (rect, screenWidth, screenHeight) => {
      if (rect.width <= 0 || rect.height <= 0) return false;
      const coversFullWidth = rect.width >= screenWidth * wRatio;
      const coversFullHeight = rect.height >= screenHeight * hRatio;
      const startsAtTop = rect.y <= topInset;
      return !(coversFullWidth && coversFullHeight && startsAtTop);
    };
  }

  if (preReworkShape) {
    const wRatio = num(/t\.width\s*<=\s*screenWidth\s*\*\s*(0\.9\d*)/, 0.96);
    const hRatio = num(/t\.height\s*<=\s*screenHeight\s*\*\s*(0\.8\d*)/, 0.85);
    return (rect, screenWidth, screenHeight) =>
      rect.width > 0 &&
      rect.height > 0 &&
      rect.width <= screenWidth * wRatio &&
      rect.height <= screenHeight * hRatio;
  }

  assert.fail('T-09 could not recognize the isPlausibleCutout predicate shape in source');
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

  // ── T-01 [FAILS-ON-REVERT]: 11 steps (ORCH-1037/1035 expansion), ids [1..11],
  //    deleted ORCH-1029 step titles still gone ──
  // [TEST-MOD-APPROVED ORCH-1037] the tour grew 7→11 (4 new steps added). The deleted-
  // title and contiguity invariants are retained against the new count.
  const ids = parseCoachStepIds(stepsSrc);
  assert.deepEqual(
    ids,
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    `T-01 COACH_STEPS must be exactly 11 steps with ids [1..11]; got [${ids.join(',')}]`
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

  // ── T-03 [FAILS-ON-REVERT]: each call site repointed (ORCH-1037/1035 11-step) ──
  // [TEST-MOD-APPROVED ORCH-1037] DiscoverScreen now has steps 4 (Events) + 5 (Trips);
  // ConnectionsPage steps 6 (people) + 7 (+ button); ProfilePage scroll steps 8/9/10/11.
  assert.ok(
    /useCoachMark\(4\b/.test(discoverSrc),
    'T-03 DiscoverScreen must use useCoachMark(4 (Events tab)'
  );
  assert.ok(
    /useCoachMark\(5\b/.test(discoverSrc),
    'T-03 DiscoverScreen must use useCoachMark(5 (Trips tab)'
  );
  assert.ok(
    /useCoachMark\(6\b/.test(connectionsSrc),
    'T-03 ConnectionsPage must use useCoachMark(6 (people icon)'
  );
  assert.ok(
    /useCoachMark\(7\b/.test(connectionsSrc),
    'T-03 ConnectionsPage must use useCoachMark(7 (+ button)'
  );
  assert.ok(
    /registerTargetScrollOffset\(8\b/.test(profileSrc) &&
      /registerTargetScrollOffset\(9\b/.test(profileSrc) &&
      /registerTargetScrollOffset\(10\b/.test(profileSrc) &&
      /registerTargetScrollOffset\(11\b/.test(profileSrc),
    'T-03 ProfilePage must register step 8/9/10/11 offsets'
  );
  assert.ok(
    !/registerTargetScrollOffset\(6\b/.test(profileSrc) &&
      !/registerTargetScrollOffset\(7\b/.test(profileSrc),
    'T-03 ProfilePage must NOT still register the stale step 6/7 offsets'
  );
  // ids 1,2,3 unchanged at their call sites
  assert.ok(/useCoachMark\(1\b/.test(homeSrc), 'T-03 HomePage step 1 unchanged');
  assert.ok(/useCoachMark\(2\b/.test(homeSrc), 'T-03 HomePage step 2 unchanged');
  assert.ok(/useCoachMark\(3\b/.test(indexSrc), 'T-03 app/index step 3 unchanged');

  // ── T-04 [FAILS-ON-REVERT]: SCROLL_STEPS literal is new Set([8, 9, 10, 11]) ──
  // [TEST-MOD-APPROVED ORCH-1037] renumbered from [6, 7] when the 4 new steps were added.
  assert.ok(
    /SCROLL_STEPS\s*=\s*new Set\(\[\s*8\s*,\s*9\s*,\s*10\s*,\s*11\s*\]\)/.test(contextSrc),
    'T-04 SCROLL_STEPS must be new Set([8, 9, 10, 11]) (renumbered from [6, 7])'
  );
  assert.ok(
    !/SCROLL_STEPS\s*=\s*new Set\(\[\s*6\s*,\s*7\s*\]\)/.test(contextSrc),
    'T-04 SCROLL_STEPS must NOT be the stale new Set([6, 7])'
  );

  // ── T-09 [FAILS-ON-REVERT, BEHAVIORAL]: predicate accepts deck rect, rejects fullscreen ──
  // Runs FIRST among the F-1 checks because it is the load-bearing proof the static grep
  // missed: a grep cannot tell a mis-calibrated threshold from a correct one. The predicate
  // model is reconstructed from source (no eval), so a revert to the pre-rework full-width-
  // rejecting clamp drives this to REJECT the deck rect and fail here.
  const predicate = buildIsPlausibleCutoutFromSource(overlaySrc);
  // Real iOS SE3 deck card: full WIDTH (375 === screenWidth, x=0) but NOT full height
  // (589 of 667 ≈ 88%), top at y=2. This is the LEGITIMATE target → must be ACCEPTED.
  const deckRect = { x: 0, y: 2, width: 375, height: 589, radius: 36 };
  assert.equal(
    predicate(deckRect, 375, 667),
    true,
    'T-09 the recalibrated clamp MUST ACCEPT the full-width-but-not-full-height deck card {0,2,375,589} on 375×667'
  );
  // Android warm-deck fallthrough rect: near-100% width (448/448) AND near-100% height
  // (879 of 896 ≈ 98%) AND top at y=2 → a TRUE whole-screen rect → must be REJECTED
  // (this is the case F-1's clamp exists to kill).
  const fullscreenRect = { x: 0, y: 2, width: 448, height: 879, radius: 36 };
  assert.equal(
    predicate(fullscreenRect, 448, 896),
    false,
    'T-09 the clamp MUST still REJECT a true whole-screen rect {0,2,448,879} on 448×896'
  );
  // A zero/degenerate rect is never plausible.
  assert.equal(predicate({ x: 0, y: 0, width: 0, height: 0, radius: 0 }, 375, 667), false, 'T-09 degenerate rect rejected');
  // A small inset card (e.g. a header chip) is plausible.
  assert.equal(predicate({ x: 24, y: 120, width: 200, height: 60, radius: 8 }, 375, 667), true, 'T-09 small inset target accepted');

  // ── T-05 [FAILS-ON-REVERT]: fullscreen-rejection / plausibility clamp (F-1) ──
  // The overlay must reject a TRUE whole-screen rect (Android warm-deck fallthrough case)
  // via a width AND height AND top-origin guard. The bare `width>0 && height>0` test on
  // its own is NOT sufficient as the cutout gate.
  assert.ok(
    /screenWidth\s*\*\s*FULLSCREEN_WIDTH_RATIO/.test(overlaySrc) &&
      /screenHeight\s*\*\s*FULLSCREEN_HEIGHT_RATIO/.test(overlaySrc),
    'T-05 SpotlightOverlay must gate the whole-screen rejection on BOTH a width ratio AND a height ratio of the screen'
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
      'PASS T-01..T-08 ORCH-1029 coach-mark fixes (ORCH-1037/1035 11-step update): 11 contiguous steps, call sites repointed, SCROLL_STEPS=[8,9,10,11], F-1 plausibility clamp, F-4 insets.top correction, F-3 onLayout offset registration, no orphan steps'
    );
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = { runOrch1029CoachMarkFixesTest };
