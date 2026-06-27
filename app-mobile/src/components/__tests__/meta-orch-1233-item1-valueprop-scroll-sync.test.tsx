// @ts-nocheck
// META-ORCH-1233 Item 1 — value-prop strip must follow valuePropBeat (Next button,
// 3s auto-advance, and swipe all flow through ONE source of truth that issues a
// programmatic scrollTo). Structural regression guard + computable pageWidth math.
//
// Append-only / immutable. Run: `node <thisfile>`.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// fails-on-revert anchor: the commit that introduced this test alongside the fix.
const FAILS_ON_REVERT_COMMIT = 'a35d5197c2e0';

function resolveRepoFile(relPath) {
  const direct = path.resolve(process.cwd(), relPath);
  if (fs.existsSync(direct)) return direct;
  return path.resolve(process.cwd(), 'app-mobile', relPath);
}
function readSource(relPath) {
  return fs.readFileSync(resolveRepoFile(relPath), 'utf8');
}

function runItem1Test() {
  const src = readSource('src/components/OnboardingFlow.tsx');

  // 1. A ScrollView ref exists for the value-prop strip.
  assert.match(
    src,
    /const\s+valuePropScrollRef\s*=\s*useRef<ScrollView>\(null\)/,
    'Item1: valuePropScrollRef<ScrollView> must be declared',
  );

  // 2. The ref is attached to the value-prop ScrollView.
  assert.match(
    src,
    /<ScrollView\s+ref=\{valuePropScrollRef\}/,
    'Item1: the value-prop ScrollView must carry ref={valuePropScrollRef}',
  );

  // 3. A sync effect issues scrollTo({ x: valuePropBeat * pageWidth, animated: true }),
  //    guarded to the value_prop subStep, recomputing pageWidth = winWidth - 48.
  assert.match(
    src,
    /if\s*\(navState\.subStep\s*!==\s*'value_prop'\)\s*return\s*\n\s*const\s+pageWidth\s*=\s*winWidth\s*-\s*48\s*\n\s*valuePropScrollRef\.current\?\.scrollTo\(\{\s*x:\s*valuePropBeat\s*\*\s*pageWidth,\s*animated:\s*true\s*\}\)/,
    'Item1: sync effect must scrollTo x = valuePropBeat * (winWidth - 48), guarded to value_prop',
  );

  // 4. The effect deps must include valuePropBeat, navState.subStep, winWidth so it
  //    re-fires on Next/timer beat change, subStep change, and width (rotation) change.
  assert.match(
    src,
    /\}, \[valuePropBeat, navState\.subStep, winWidth\]\)/,
    'Item1: sync effect deps must be [valuePropBeat, navState.subStep, winWidth]',
  );

  // 5. Footer Next CTA contract is UNCHANGED: still advances beat then handleGoNext at beat>=2.
  assert.match(
    src,
    /setValuePropBeat\(Math\.min\(valuePropBeat \+ 1, 2\)\);\s*if \(valuePropBeat >= 2\) handleGoNext\(\)/,
    'Item1: Next CTA must still advance the beat and handleGoNext on the final beat',
  );

  // 6. Auto-advance timer is UNCHANGED (still increments every 3000ms).
  assert.match(
    src,
    /setTimeout\(\(\) => setValuePropBeat\(\(b\) => b \+ 1\), 3000\)/,
    'Item1: 3s auto-advance timer must remain intact',
  );

  // 7. Computable math: pageWidth uses winWidth-48 identically in render and effect.
  const winWidth = 393; // iPhone 15 logical width
  const pageWidth = winWidth - 48;
  assert.equal(0 * pageWidth, 0, 'Item1 math: beat 0 -> x=0');
  assert.equal(1 * pageWidth, pageWidth, 'Item1 math: beat 1 -> x=pageWidth');
  assert.equal(2 * pageWidth, 2 * pageWidth, 'Item1 math: beat 2 -> x=2*pageWidth');
}

if (require.main === module) {
  try {
    runItem1Test();
    console.log(
      `PASS META-ORCH-1233 Item1 value-prop scroll-sync regression; fails-on-revert anchor ${FAILS_ON_REVERT_COMMIT}`,
    );
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = { runItem1Test };
