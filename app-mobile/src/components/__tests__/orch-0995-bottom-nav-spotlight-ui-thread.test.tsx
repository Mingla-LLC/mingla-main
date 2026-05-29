// @ts-nocheck
// ORCH-0995 [Android-wide UI jank + tab-navigation animation lag — iOS-fluidity parity]
//
// Regression test: the GlassBottomNav tab "spotlight" pill MUST animate entirely off the
// JS thread (on the UI thread) so tab switching is buttery on mid-tier Android.
//
// Root cause being guarded against: the spotlight previously animated `left`/`width` with
// RN `Animated.spring(..., { useNativeDriver: false })`, which runs every frame on the JS
// thread → dropped frames + visible tab-switch lag on Android. The fix moves the spotlight
// to react-native-reanimated shared values (UI thread), preserving pixel-identical resting
// geometry, the reduceMotion instant-set branch, and the layoutTick re-run.
//
// This is a source-static-analysis test (the repo convention for component tests — see
// orch-0945-dead-end-render.test.tsx). It reads GlassBottomNav.tsx as a string and asserts
// the corrected animation mechanism + the preserved geometry math.
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

function runOrch0995SpotlightUiThreadTest() {
  const source = readSource('src/components/GlassBottomNav.tsx');

  // ---- T-01 [FAILS-ON-REVERT KEY]: no JS-thread-driven layout spring on the spotlight ----
  // The old code shipped `useNativeDriver: false` springs on `left`/`width`. That string
  // existing anywhere in this file means the spotlight is (or could be) animated on the
  // JS thread — forbidden by the ORCH-0995 contract.
  assert.ok(
    !/useNativeDriver:\s*false/.test(source),
    'T-01 spotlight must NOT use any `useNativeDriver: false` animation (JS-thread layout animation forbidden)'
  );

  // ---- T-02 [FAILS-ON-REVERT KEY]: the old RN Animated.spring path is gone ----
  assert.ok(
    !/Animated\.spring\(/.test(source),
    'T-02 spotlight must NOT use RN `Animated.spring(` (JS-thread spring). Use reanimated withSpring on the UI thread.'
  );
  assert.ok(
    !/Animated\.parallel\(/.test(source),
    'T-02b old RN `Animated.parallel(` orchestration of the JS-thread spring must be removed'
  );

  // ---- T-03: spotlight uses the reanimated UI-thread shared-value path ----
  assert.match(
    source,
    /from ['"]react-native-reanimated['"]/,
    'T-03 GlassBottomNav must import from react-native-reanimated (UI-thread animation engine)'
  );
  assert.match(
    source,
    /useSharedValue/,
    'T-03 spotlight must use useSharedValue (UI-thread state)'
  );
  assert.match(
    source,
    /useAnimatedStyle/,
    'T-03 spotlight must use useAnimatedStyle (UI-thread style worklet)'
  );
  assert.match(
    source,
    /withSpring\(/,
    'T-03 spotlight must animate via reanimated withSpring (UI-thread spring)'
  );

  // ---- T-04: resting geometry math is pixel-identical to before ----
  // targetX = layout.x + inset ; targetWidth = layout.width - inset*2
  assert.match(
    source,
    /const\s+targetX\s*=\s*layout\.x\s*\+\s*c\.nav\.spotlightInset\s*;/,
    'T-04 resting X landing must remain `layout.x + c.nav.spotlightInset`'
  );
  assert.match(
    source,
    /const\s+targetWidth\s*=\s*layout\.width\s*-\s*c\.nav\.spotlightInset\s*\*\s*2\s*;/,
    'T-04 resting width must remain `layout.width - c.nav.spotlightInset * 2`'
  );
  // The animated style must drive `left` + `width` (true geometry, not scaleX which
  // would distort the corner radius).
  assert.match(
    source,
    /left:\s*spotlightX\.value/,
    'T-04 animated style must set `left` from the shared value (translateX-equivalent, no radius distortion)'
  );
  assert.match(
    source,
    /width:\s*spotlightWidth\.value/,
    'T-04 animated style must set `width` from the shared value (true width, no scaleX distortion)'
  );

  // ---- T-05: spring feel preserved — designSystem motion tokens drive withSpring ----
  assert.match(
    source,
    /damping:\s*c\.motion\.springDamping/,
    'T-05 withSpring damping must come from c.motion.springDamping'
  );
  assert.match(
    source,
    /stiffness:\s*c\.motion\.springStiffness/,
    'T-05 withSpring stiffness must come from c.motion.springStiffness'
  );
  assert.match(
    source,
    /mass:\s*c\.motion\.springMass/,
    'T-05 withSpring mass must come from c.motion.springMass'
  );

  // ---- T-06: reduceMotion instant-set branch preserved (no animation) ----
  // In the reduceMotion branch the shared values must be set directly (not via withSpring).
  const rmStart = source.indexOf('if (reduceMotion) {');
  assert.notEqual(rmStart, -1, 'T-06 reduceMotion branch must still exist');
  const rmEnd = source.indexOf('}', rmStart);
  const rmBlock = source.slice(rmStart, rmEnd + 1);
  assert.match(
    rmBlock,
    /spotlightX\.value\s*=\s*targetX\s*;/,
    'T-06 reduceMotion must instant-set spotlightX (no spring)'
  );
  assert.match(
    rmBlock,
    /spotlightWidth\.value\s*=\s*targetWidth\s*;/,
    'T-06 reduceMotion must instant-set spotlightWidth (no spring)'
  );
  assert.ok(
    !/withSpring/.test(rmBlock),
    'T-06 reduceMotion branch must NOT call withSpring (instant set only)'
  );

  // ---- T-07: layoutTick re-run preserved (first-mount positioning) ----
  assert.match(
    source,
    /\}, \[currentPage, layoutTick, reduceMotion, spotlightX, spotlightWidth\]\);/,
    'T-07 spotlight effect dep array must still include layoutTick (re-runs when onLayout fires on first mount)'
  );
}

if (require.main === module) {
  try {
    runOrch0995SpotlightUiThreadTest();
    console.log(
      'PASS T-01..T-07 ORCH-0995 bottom-nav spotlight animates on UI thread with pixel-identical resting geometry + preserved reduceMotion/layoutTick paths'
    );
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = { runOrch0995SpotlightUiThreadTest };
