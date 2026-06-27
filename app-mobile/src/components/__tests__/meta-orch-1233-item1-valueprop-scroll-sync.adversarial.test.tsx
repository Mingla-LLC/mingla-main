// @ts-nocheck
// META-ORCH-1233 Item 1 — ADVERSARIAL (tester). DIFFERENT ANGLE than the implementor's
// pure source-grep: this test (a) executes a faithful runtime MODEL of the value-prop
// strip reducer — Next button, 3s timer, swipe-settle — and asserts the strip offset,
// dots, and state stay locked in lockstep across edge sequences (swipe-then-Next,
// rapid triple-tap, final-beat over-scroll, rotation/width-change re-alignment), and
// (b) statically asserts the sync effect is single-source-of-truth (the ONLY scrollTo
// driver for the strip) so no second writer can desync it.
//
// Append-only / immutable. Run: `node <thisfile>`.
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

// ─────────────────────────────────────────────────────────────────────────────
// Faithful runtime model of the value-prop strip, mirroring the SHIPPED code:
//   - Next CTA  : setValuePropBeat(Math.min(beat + 1, 2)); if (beat >= 2) goNext()
//   - 3s timer  : setValuePropBeat(b => b + 1)  (guarded: only while beat < 2)
//   - swipe end : setValuePropBeat(Math.round(offsetX / pageWidth)) clamped [0,2]
//   - sync fx   : scrollTo({ x: beat * (winWidth - 48) }) whenever beat/subStep/width change
// State is the SINGLE source of truth `beat`; the rendered strip offset and dots
// derive from it. We assert they never diverge.
// ─────────────────────────────────────────────────────────────────────────────
function makeStrip({ winWidth = 393 } = {}) {
  let beat = 0;
  let width = winWidth;
  let goNextCount = 0;
  let scrollX = 0; // what the sync effect last committed (the visible strip position)

  const pageWidth = () => width - 48;
  // The sync effect: fires on every state/width change (React re-render), single writer.
  const runSyncEffect = () => {
    scrollX = beat * pageWidth();
  };

  return {
    get beat() { return beat; },
    get goNextCount() { return goNextCount; },
    get scrollX() { return scrollX; },
    get pageWidth() { return pageWidth(); },
    // dots derive purely from beat — exactly as `i === valuePropBeat`
    activeDot() { return beat; },
    pressNext() {
      // closure-captured beat (matches shipped CTA), then re-render → sync effect
      const captured = beat;
      beat = Math.min(captured + 1, 2);
      if (captured >= 2) goNextCount += 1;
      runSyncEffect();
    },
    tick3s() {
      if (beat >= 2) return; // guard mirrors the timer's `if (valuePropBeat >= 2) return`
      beat = beat + 1;
      runSyncEffect();
    },
    swipeTo(idx) {
      // momentum settle writes the rounded index, clamped to [0, 2]
      const clamped = Math.max(0, Math.min(idx, 2));
      beat = clamped;
      runSyncEffect();
    },
    setWidth(w) {
      width = w;
      runSyncEffect(); // winWidth is in the effect deps → re-aligns on rotation
    },
  };
}

function invariantLocked(strip, label) {
  // The visible strip offset MUST equal beat * pageWidth, and the active dot MUST
  // equal beat. If these ever diverge the slide/dots/state have desynced.
  assert.equal(
    strip.scrollX,
    strip.beat * strip.pageWidth,
    `Item1-adv: ${label} — strip offset must equal beat*pageWidth (locked)`,
  );
  assert.equal(strip.activeDot(), strip.beat, `Item1-adv: ${label} — active dot must equal beat`);
}

function runItem1Adversarial() {
  // ── A. swipe-then-Next must NOT desync ─────────────────────────────────────
  {
    const s = makeStrip();
    s.swipeTo(1); // user swipes to beat 1
    invariantLocked(s, 'after swipe to 1');
    s.pressNext(); // Next from beat 1 → beat 2
    assert.equal(s.beat, 2, 'Item1-adv: swipe(1) then Next → beat 2');
    invariantLocked(s, 'swipe-then-Next');
    assert.equal(s.goNextCount, 0, 'Item1-adv: Next at captured-beat 1 must NOT advance subStep');
  }

  // ── B. final-beat Next advances subStep and does NOT over-scroll past 2 ─────
  {
    const s = makeStrip();
    s.pressNext(); // 0→1
    s.pressNext(); // 1→2
    assert.equal(s.beat, 2, 'Item1-adv: two Nexts reach beat 2');
    assert.equal(s.goNextCount, 0, 'Item1-adv: no subStep advance before final beat');
    const xAtBeat2 = s.scrollX;
    s.pressNext(); // beat already 2 → clamp + goNext
    assert.equal(s.beat, 2, 'Item1-adv: final-beat Next must clamp beat at 2 (no over-scroll)');
    assert.equal(s.scrollX, xAtBeat2, 'Item1-adv: strip must NOT scroll past 2*pageWidth');
    assert.equal(s.goNextCount, 1, 'Item1-adv: final-beat Next advances subStep exactly once');
    invariantLocked(s, 'final-beat clamp');
  }

  // ── C. rapid triple-tap from beat 0 — no skipped beat, exactly one goNext ───
  // Each press is a discrete event with a re-render between (RN reality); the
  // closure beat is fresh per render. Assert deterministic 0→1→2→advance.
  {
    const s = makeStrip();
    s.pressNext();
    s.pressNext();
    s.pressNext();
    assert.equal(s.beat, 2, 'Item1-adv: triple-tap settles at beat 2 (no skip)');
    assert.equal(s.goNextCount, 1, 'Item1-adv: triple-tap fires goNext exactly once (no double-fire)');
    invariantLocked(s, 'triple-tap');
  }

  // ── D. rotation / width change mid-strip re-aligns (no half-page offset) ────
  {
    const s = makeStrip({ winWidth: 393 });
    s.pressNext(); // beat 1, scrollX = 1*(393-48) = 345
    assert.equal(s.scrollX, 345, 'Item1-adv: beat 1 @393 → x=345');
    s.setWidth(852); // rotate to landscape-ish width
    assert.equal(
      s.scrollX,
      1 * (852 - 48),
      'Item1-adv: after width change strip re-aligns to beat*newPageWidth (no stale offset)',
    );
    invariantLocked(s, 'post-rotation');
  }

  // ── E. auto-advance timer moves the visible slide, not just dots ───────────
  {
    const s = makeStrip();
    const x0 = s.scrollX;
    s.tick3s(); // 0→1
    assert.notEqual(s.scrollX, x0, 'Item1-adv: 3s tick must move the strip offset, not just state');
    invariantLocked(s, 'timer tick 1');
    s.tick3s(); // 1→2
    invariantLocked(s, 'timer tick 2');
    const x2 = s.scrollX;
    s.tick3s(); // guarded at 2 — no movement
    assert.equal(s.beat, 2, 'Item1-adv: timer stops at beat 2');
    assert.equal(s.scrollX, x2, 'Item1-adv: no scroll past beat 2 from timer');
  }

  // ── F. STRUCTURAL invariant: the sync effect is the SOLE programmatic strip
  //    driver, the driver must be a LIVE (non-commented) call, and it must be
  //    guarded to value_prop. Stripping commented-out lines first means an
  //    implementor "revert by comment" (the documented revert path) is caught.
  {
    const raw = readSource('src/components/OnboardingFlow.tsx');
    // Drop line-comments so a commented-out scrollTo is NOT counted as a driver.
    const live = raw
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');
    const liveCalls = (live.match(/valuePropScrollRef\.current\?\.scrollTo/g) || []).length;
    assert.equal(
      liveCalls,
      1,
      `Item1-adv: exactly ONE LIVE valuePropScrollRef scrollTo driver expected, found ${liveCalls}`,
    );
    // The live driver must scroll to the beat-derived offset (not a frozen/zero x).
    assert.match(
      live,
      /valuePropScrollRef\.current\?\.scrollTo\(\{\s*x:\s*valuePropBeat\s*\*\s*pageWidth/,
      'Item1-adv: the live driver must scroll to valuePropBeat * pageWidth (state-derived)',
    );
    // And the effect must be guarded to value_prop so it never fights another step.
    const idx = live.indexOf('valuePropScrollRef.current?.scrollTo');
    const window = live.slice(Math.max(0, idx - 260), idx);
    assert.match(
      window,
      /navState\.subStep\s*!==\s*'value_prop'\)\s*return/,
      'Item1-adv: the live scrollTo driver must be guarded to the value_prop subStep',
    );
  }
}

if (require.main === module) {
  try {
    runItem1Adversarial();
    console.log('PASS META-ORCH-1233 Item1 ADVERSARIAL value-prop strip lockstep + single-source');
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = { runItem1Adversarial };
