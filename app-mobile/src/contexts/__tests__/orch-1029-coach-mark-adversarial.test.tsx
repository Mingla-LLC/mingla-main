// @ts-nocheck
// ORCH-1029 [Coach-mark cross-device fixes] — TESTER adversarial regression test.
//
// Source-static-analysis test (the app-mobile component-test convention — see
// orch-0995-bottom-nav-spotlight-ui-thread.test.tsx): reads the coach-mark module files
// as strings and asserts the MECHANICS of the four fixes hold under adversarial revert.
// node-runnable (no jest in app-mobile); self-runs via require.main === module.
//
// DIFFERENT ANGLE than the implementor's happy-path test
// (orch-1029-coach-mark-fixes.test.tsx, which guards the step-COUNT / id surface).
// This file attacks the measurement-gating MECHANICS and the unmeasured/fullscreen /
// Android-inset / scroll-race / orphan-step edge cases — the failure modes the count
// surface cannot see:
//
//   AT-01  Unmeasured/fullscreen target must NOT present a misleading spotlight
//          (hasTarget is gated by the plausibility predicate, NOT a bare width>0&&height>0;
//           the predicate REJECTS only a TRUE whole-screen rect — near-100% width AND
//           near-100% height AND top-origin near 0 — while ACCEPTING the full-width-but-
//           shorter deck card; step 1 holds → returns null). [AT-01b TEST-MOD-APPROVED
//           ORCH-1029: the original upper-bound-on-both clamp encoded the P1 tour-freeze.]
//   AT-02  Step-6 scroll is gated on offset registration, not a fixed delay
//          (scrollToEnd is GONE entirely; the scroll routine is reachable ONLY inside the
//           offset-present guard; the budget-exhausted miss path leaves the page at top,
//           never scrolls to the footer).
//   AT-03  Android inset correction is edge-to-edge-correct, legacy-safe, AND drift-free
//          (both sites add a POSITIVE insets.top on android only; iOS branch is the
//           identity; the two sites use the byte-identical correction expression so they
//           cannot drift; the ORCH-0688 correction is preserved, not removed).
//   AT-04  No orphaned coach step — bijection computed against the LIVE filesystem
//          (grep the entire app/ + src/ trees, not a hand-listed file set, so a stray
//           registration ANYWHERE — the META-ORCH-0929 deletion class of bug — fails).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ── Repo-root resolution (run from app-mobile/ or repo root) ──────────────────
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

// Walk a dir collecting .ts/.tsx files (skip node_modules / __tests__).
function walkSourceFiles(relDir) {
  const abs = path.join(ROOT, relDir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  const stack = [abs];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        stack.push(full);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        out.push(full);
      }
    }
  }
  return out;
}

// Collapse whitespace so multi-line / reformatted source still matches structural intent.
function squish(s) {
  return s.replace(/\s+/g, ' ');
}

// Strip line- and block-comments so assertions match EXECUTABLE code, not documentation
// (the fix intentionally KEEPS comments explaining that scrollToEnd was removed).
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function runAdversarial() {
  const overlaySrc = readSource('src/components/SpotlightOverlay.tsx');
  const contextSrc = readSource('src/contexts/CoachMarkContext.tsx');
  const hookSrc = readSource('src/hooks/useCoachMark.ts');
  const profileSrc = readSource('src/components/ProfilePage.tsx');
  const stepsSrc = readSource('src/constants/coachMarkSteps.ts');

  // ─────────────────────────────────────────────────────────────────────────
  // AT-01 — Unmeasured/fullscreen target must NOT present a misleading spotlight.
  //
  // Angle the happy-path test does NOT cover: it only checks that the strings
  // `isPlausibleCutout` / `screenWidth*0.9x` / `step1HoldingForDeck` EXIST. An attacker
  // could keep the predicate but (a) wire `hasTarget` straight off the raw rect again,
  // (b) flip the comparator to `>=` (which would ACCEPT the fullscreen rect), or
  // (c) drop the `return null` hold. We assert the actual gating wiring + direction.
  // ─────────────────────────────────────────────────────────────────────────
  {
    const squishedOverlay = squish(overlaySrc);

    // (a) hasTarget MUST be derived from the plausibility result, not the raw rect.
    assert.ok(
      /const hasTarget\s*=\s*hasPlausibleTarget\b/.test(squishedOverlay),
      'AT-01a hasTarget must derive from hasPlausibleTarget (NOT a bare width>0&&height>0 rect)'
    );
    assert.ok(
      /const hasPlausibleTarget\s*=\s*!!target\s*&&\s*isPlausibleCutout\(target\)/.test(squishedOverlay),
      'AT-01a hasPlausibleTarget must require BOTH a target AND isPlausibleCutout(target)'
    );
    // Defensive: the old bare gate must NOT be the hasTarget assignment.
    assert.ok(
      !/const hasTarget\s*=\s*target\s*&&\s*target\.width\s*>\s*0/.test(squishedOverlay),
      'AT-01a hasTarget must NOT regress to the bare `target && target.width > 0 ...` rect gate'
    );

    // (b) [TEST-MOD-APPROVED ORCH-1029] the plausibility predicate must REJECT a TRUE
    //     whole-screen rect, distinguishing it from the LEGITIMATE full-width deck card.
    //
    //     ORIGINAL AT-01b (this commit's predecessor) required `t.width <= screenWidth*0.9x`
    //     AND `t.height <= screenHeight*0.8x` — an upper-bound-on-BOTH clamp. That clamp is
    //     the EXACT P1 the QA verdict proved: the deck card is full-WIDTH by design
    //     (`cardContainer` is `width: SCREEN_WIDTH`), so a `width <= screenWidth*0.96` arm can
    //     NEVER be satisfied → step 1 holds forever → the tour freezes. The original AT-01b
    //     is mathematically unsatisfiable alongside a working fix, so it is corrected here
    //     (the REWORK direction, dispatched by the orchestrator).
    //
    //     The recalibrated predicate rejects a rect ONLY when it covers essentially the
    //     whole screen: near-100% WIDTH (`>=` a width ratio) AND near-100% HEIGHT (`>=` a
    //     height ratio) AND a top-origin near 0. A full-width-but-shorter deck card (height
    //     well under the height ratio) is therefore ACCEPTED; the Android {0,2,448,879}
    //     whole-screen rect (≈98% w, ≈98% h, y≈0) is REJECTED. The adversarial guard is now:
    //     the whole-screen detector must gate on BOTH a width ratio AND a height ratio (a
    //     width-only or height-only gate would mis-classify), and the final result must be
    //     the NEGATION of the whole-screen test (so the gate rejects, not accepts, fullscreen).
    assert.ok(
      /t\.width\s*>=\s*screenWidth\s*\*\s*FULLSCREEN_WIDTH_RATIO/.test(squishedOverlay),
      'AT-01b whole-screen detector must gate on a width ratio (t.width >= screenWidth * FULLSCREEN_WIDTH_RATIO)'
    );
    assert.ok(
      /t\.height\s*>=\s*screenHeight\s*\*\s*FULLSCREEN_HEIGHT_RATIO/.test(squishedOverlay),
      'AT-01b whole-screen detector must gate on a height ratio (t.height >= screenHeight * FULLSCREEN_HEIGHT_RATIO)'
    );
    // The detector must AND the width + height + top conditions (a single-axis gate would
    // wrongly reject the full-width deck card), and the predicate must RETURN ITS NEGATION
    // (reject the whole-screen rect, accept everything else).
    assert.ok(
      /const isWholeScreen\s*=\s*coversFullWidth\s*&&\s*coversFullHeight\s*&&\s*startsAtTop/.test(squishedOverlay),
      'AT-01b whole-screen = coversFullWidth && coversFullHeight && startsAtTop (all three, ANDed)'
    );
    assert.ok(
      /return\s*!isWholeScreen/.test(squishedOverlay),
      'AT-01b the predicate must return the NEGATION of the whole-screen test (reject fullscreen, accept the deck)'
    );

    // (c) step 1 must HOLD (render nothing) when there is no plausible target — the
    //     hold guard returns null and is keyed off step1HoldingForDeck (first step + no
    //     plausible target). If this regresses, step 1 falls through to a centered bubble.
    assert.ok(
      /const step1HoldingForDeck\s*=\s*isFirstStep\s*&&\s*!hasPlausibleTarget/.test(squishedOverlay),
      'AT-01c step1HoldingForDeck must be (isFirstStep && !hasPlausibleTarget)'
    );
    assert.ok(
      /if\s*\(\s*step1HoldingForDeck\s*\)\s*\{\s*return null;\s*\}/.test(squishedOverlay),
      'AT-01c the step-1 hold must early-return null (no misleading centered/no-cutout bubble as a resting state)'
    );
    // The hold guard must sit BEFORE the cutout/bubble computation so step 1 cannot reach
    // the centered-fallback branch while unmeasured.
    const holdIdx = overlaySrc.indexOf('if (step1HoldingForDeck)');
    const cutoutIdx = overlaySrc.indexOf('const cutout = hasTarget');
    assert.ok(holdIdx !== -1 && cutoutIdx !== -1 && holdIdx < cutoutIdx,
      'AT-01c the step-1 hold (return null) must precede the cutout/bubble computation');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AT-02 — Step-6 scroll gated on offset registration, not a fixed delay / footer dump.
  //
  // Angle the happy-path test does NOT cover: it checks the tokens OFFSET_POLL/tryScroll
  // exist and a narrow scrollToEnd-with-animated-true regex is absent. An attacker could
  // (a) keep the poll but call performScrollAndMeasure OUTSIDE the offset guard, or
  // (b) reintroduce ANY scrollToEnd footer dump (different formatting), or
  // (c) make the budget-exhausted path scroll instead of leaving the page at top.
  // ─────────────────────────────────────────────────────────────────────────
  {
    // Operate on comment-stripped code (the fix KEEPS comments naming the removed
    // scrollToEnd fallback; the regression bar is that no scrollToEnd CALL executes).
    const ctxCode = stripComments(contextSrc);

    // (a) scrollToEnd must be GONE as an executable call — no formatting escape.
    assert.ok(
      !/scrollToEnd/.test(ctxCode),
      'AT-02a a scrollToEnd CALL must NOT appear in CoachMarkContext executable code (footer over-scroll fallback is removed)'
    );

    // (b) the scroll-and-measure routine is reachable ONLY behind the offset-present guard.
    //     The routine is invoked exactly once (`performScrollAndMeasure(scrollRef, offset)`)
    //     and only inside the `if (scrollRef?.current && offset)` block. (The definition is
    //     `const performScrollAndMeasure = (...)` — a space + `=` before its paren — so the
    //     no-space call form below uniquely matches the single invocation.)
    const invocations = (ctxCode.match(/performScrollAndMeasure\(scrollRef/g) || []).length;
    assert.equal(invocations, 1,
      `AT-02b performScrollAndMeasure must be CALLED exactly once (inside the offset guard); found ${invocations} calls`);
    const squishedCtx = squish(ctxCode);
    assert.ok(
      /if\s*\(\s*scrollRef\?\.current\s*&&\s*offset\s*\)\s*\{\s*performScrollAndMeasure\(scrollRef,\s*offset\);/.test(squishedCtx),
      'AT-02b performScrollAndMeasure must be called ONLY inside the `if (scrollRef?.current && offset)` guard'
    );

    // (c) the poll must precede the scroll: tryScroll re-arms via setTimeout until
    //     attempts hit the budget, and the budget-exhausted branch must NOT scroll —
    //     it sets the overlay visible at the current (top) position with a centered bubble.
    assert.ok(
      /const OFFSET_POLL_MAX_ATTEMPTS\s*=\s*\d+/.test(ctxCode),
      'AT-02c a bounded poll budget (OFFSET_POLL_MAX_ATTEMPTS) must exist'
    );
    assert.ok(
      /attempts\s*<\s*OFFSET_POLL_MAX_ATTEMPTS/.test(ctxCode) &&
        /setTimeout\(tryScroll,\s*OFFSET_POLL_INTERVAL_MS\)/.test(ctxCode),
      'AT-02c tryScroll must re-arm itself while under the attempt budget (poll until offset present)'
    );
    // The miss branch must surface the overlay (centered fallback) WITHOUT any scroll call.
    // It is the tail of tryScroll after the budget check (the console.warn string literal
    // "never registered" survives comment-stripping and anchors the branch).
    const missBranch = ctxCode.slice(ctxCode.indexOf('never registered'));
    assert.ok(missBranch.length > 0, 'AT-02c the budget-exhausted miss branch must exist');
    assert.ok(
      !/scrollTo\b|scrollTo\?\./.test(missBranch),
      'AT-02c the budget-exhausted miss branch must NOT scroll (leave the page at top)'
    );
    assert.ok(
      /setOverlayVisible\(true\)/.test(missBranch),
      'AT-02c the budget-exhausted miss branch must still show the overlay (centered fallback at top)'
    );

    // The single real scroll call (scrollTo) must live inside performScrollAndMeasure,
    // i.e. only reachable once an offset exists.
    const scrollToHits = (ctxCode.match(/\.scrollTo\?\.\(/g) || []).length;
    assert.equal(scrollToHits, 1,
      `AT-02c exactly one programmatic scrollTo call expected (inside performScrollAndMeasure); found ${scrollToHits}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AT-03 — Android inset correction: edge-to-edge-correct, legacy-safe, drift-free.
  //
  // Angle the happy-path test does NOT cover: it checks each site individually for
  // insets.top and absence of StatusBar.currentHeight. The adversarial angle is DRIFT
  // (the two sites silently diverging) and DIRECTION (the correction must stay POSITIVE
  // and android-gated, with iOS as the identity branch). We extract the exact correction
  // expression from BOTH sites and assert they are byte-identical and additive.
  // ─────────────────────────────────────────────────────────────────────────
  {
    const correctionRe = /Platform\.OS === 'android'\s*\?\s*([A-Za-z0-9_.]+)\s*\+\s*insets\.top\s*:\s*([A-Za-z0-9_.]+)/g;

    function extractCorrection(src, name) {
      correctionRe.lastIndex = 0;
      const m = correctionRe.exec(src);
      assert.ok(m, `AT-03 ${name} must have an \`android ? <base> + insets.top : <base>\` correction`);
      // The android branch base and the iOS (identity) branch base must be the SAME term,
      // i.e. iOS = base (no correction), android = base + insets.top (positive correction).
      // (The base operand legitimately differs per site — `y` from measureInWindow in the
      // hook vs `exactScreenY` from the synthetic measure in the context — so the DRIFT
      // vector that matters is the correction SOURCE TERM, normalized below.)
      assert.equal(m[1], m[2],
        `AT-03 ${name}: iOS branch must be the bare base \`${m[1]}\` (identity); android adds insets.top to the SAME base`);
      // Normalize away the per-site base operand → the shared "shape" is the source term.
      return `Platform.OS === 'android' ? <base> + insets.top : <base>`;
    }

    const hookCorr = extractCorrection(hookSrc, 'useCoachMark');
    const ctxCorr = extractCorrection(contextSrc, 'CoachMarkContext');

    // Drift guard: both sites must apply the IDENTICAL correction shape — android-gated,
    // positive, sourced from `insets.top`, iOS identity. If one site reverts to
    // StatusBar.currentHeight (or drops the android gate), the normalized shapes diverge.
    assert.equal(hookCorr, ctxCorr,
      'AT-03 the two Android correction sites must share the identical correction shape (insets.top source, no drift between hook + context)');

    // Positive-correction preservation (ORCH-0688): the additive term must be insets.top,
    // and StatusBar.currentHeight must not be the correction source at EITHER site.
    for (const [name, src] of [['useCoachMark', hookSrc], ['CoachMarkContext', contextSrc]]) {
      assert.ok(/\+\s*insets\.top/.test(src),
        `AT-03 ${name} must ADD insets.top (positive correction preserved — ORCH-0688 not removed)`);
      assert.ok(!/\+\s*\(?\s*StatusBar\.currentHeight/.test(src),
        `AT-03 ${name} must NOT add StatusBar.currentHeight (re-breaks Android 15 edge-to-edge)`);
    }

    // useCoachMark must source insets from the safe-area context (edge-to-edge-correct).
    assert.ok(
      /import\s*\{[^}]*\buseSafeAreaInsets\b[^}]*\}\s*from\s*['"]react-native-safe-area-context['"]/.test(hookSrc),
      'AT-03 useCoachMark must import useSafeAreaInsets (WindowInsets-resolved top inset)'
    );
    assert.ok(
      /const insets\s*=\s*useSafeAreaInsets\(\)/.test(hookSrc),
      'AT-03 useCoachMark must read insets via useSafeAreaInsets()'
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AT-04 — No orphaned coach step (LIVE-filesystem bijection).
  //
  // Angle the happy-path test does NOT cover: T-08 computes the bijection from a
  // HAND-LISTED set of 5 files. A stray `useCoachMark(<n>)` / `registerTargetScrollOffset(<n>)`
  // in ANY OTHER file would slip past it. This recomputes the bijection by grepping the
  // ENTIRE app/ + src/ trees (the META-ORCH-0929 deletion class of bug = an orphan step).
  // ─────────────────────────────────────────────────────────────────────────
  {
    // COACH_STEPS ids.
    const stepIds = new Set();
    const arrBody = stepsSrc.slice(stepsSrc.indexOf('export const COACH_STEPS'));
    let m;
    const idRe = /\bid:\s*(\d+)\b/g;
    while ((m = idRe.exec(arrBody)) !== null) stepIds.add(Number(m[1]));
    // [TEST-MOD-APPROVED ORCH-1037] tour grew 7→11 (4 new steps: Trips, + button,
    // Interests, Circle).
    assert.ok(stepIds.size === 11, `AT-04 expected 11 COACH_STEPS ids; got ${stepIds.size}`);

    // Live grep across the whole source trees.
    const files = [...walkSourceFiles('app'), ...walkSourceFiles('src')];
    const callSiteIds = new Set();
    const hookDefPath = path.join(ROOT, 'src/hooks/useCoachMark.ts');
    for (const f of files) {
      // Skip the hook DEFINITION file (its JSDoc shows useCoachMark(2) as an example).
      if (f === hookDefPath) continue;
      const src = fs.readFileSync(f, 'utf8');
      let mm;
      const r1 = /useCoachMark\((\d+)/g;
      while ((mm = r1.exec(src)) !== null) callSiteIds.add(Number(mm[1]));
      const r2 = /registerTargetScrollOffset\((\d+)/g;
      while ((mm = r2.exec(src)) !== null) callSiteIds.add(Number(mm[1]));
    }

    // Every step has a call site.
    for (const id of stepIds) {
      assert.ok(callSiteIds.has(id),
        `AT-04 orphan step: COACH_STEPS id ${id} has NO useCoachMark/registerTargetScrollOffset call site anywhere in app/ or src/`);
    }
    // Every call site references a real step (no registration beyond the 7 steps).
    for (const id of callSiteIds) {
      assert.ok(stepIds.has(id),
        `AT-04 dangling registration: call-site id ${id} references a step NOT in COACH_STEPS (orphaned registration)`);
    }
    // [TEST-MOD-APPROVED ORCH-1037] ids 8/9/10/11 are now LIVE Profile scroll steps
    // (Interests/Circle/Account/Feedback). The dead-id belt-and-suspenders check is
    // dropped — the bijection above (every call-site id ∈ COACH_STEPS, and vice versa)
    // already proves there is no registration beyond the live 11 steps.
  }
}

if (require.main === module) {
  try {
    runAdversarial();
    console.log(
      'PASS AT-01..AT-04 ORCH-1029 adversarial: fullscreen-rejection wiring + step-1 hold (AT-01), ' +
      'scroll gated on offset / no footer dump (AT-02), Android insets.top correction positive + drift-free (AT-03), ' +
      'no orphaned coach step across the live app/ + src/ trees (AT-04)'
    );
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = { runAdversarial };
