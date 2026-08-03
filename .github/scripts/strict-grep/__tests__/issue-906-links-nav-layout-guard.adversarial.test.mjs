/**
 * TESTER adversarial suite for issue #906 [links-nav-layout-guard].
 *
 * Distinct angle from the implementor's self-test happy path. A structural
 * strict-grep gate's failure mode is DECORATIVENESS: passing on a token that is
 * only cosmetically present (surviving inside a comment) or a single-token check
 * that a stray, unrelated occurrence satisfies. This suite imports the gate's
 * PURE exported core (`stripComments`, `assertFile`, `TARGETS`) and proves TWO
 * evasions a naive gate would miss:
 *
 *   (a) COMMENT-HIDDEN LITERAL — a guarded token (`overflow-hidden`, A1b) that
 *       exists ONLY inside a `{/* ... *\/}` JSX comment and is ABSENT from the
 *       live className MUST still be treated as MISSING. Proves comment-stripping
 *       is load-bearing, not ornamental: a raw byte-grep would see the commented
 *       copy and pass.
 *
 *   (b) REORDERED / REFORMATTED BUT GENUINELY UN-GATED — a `glass-nav.tsx`-shaped
 *       source whose useWeb pill was reflowed with `sm:inline-flex` DROPPED, while
 *       an unrelated bare `hidden` (`hidden md:block`, the :188 surface toggle)
 *       is still present, MUST flag A3. Proves A3's bounded regex catches the real
 *       un-gating and is NOT satisfied by the stray `hidden` — a naive single-token
 *       `hidden` check would pass on the wrong element.
 *
 * Both evasions are asserted to be caught (the gate BEHAVES CORRECTLY on these
 * inputs), plus discriminating positive controls prove the suite is not a
 * trivially-always-flag test: the real (clean) mechanism strings must produce
 * ZERO violations.
 *
 * Registered in MANIFEST as its own class-A entry
 * (enforcement:"batch:A", invocation:"node --test", modes:["plain"], selfTest:"none")
 * so it actually runs in CI — not a dark on-disk fixture.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stripComments,
  assertFile,
  TARGETS,
} from '../issue-906-links-nav-layout-guard.mjs';

// Pull the REAL check sets out of the gate's exported TARGETS so the suite
// drives the exact regexes the gate ships — no re-declaration, no drift.
const A1_CHECKS = TARGETS.find((t) => t.rel.endsWith('links-experience.tsx')).checks;
const A3_CHECKS = TARGETS.find((t) => t.family === 'A3').checks;

const idsOf = (violations) =>
  violations.map((v) => (v.match(/MISSING (\S+):/) || [, '?'])[1]);

// ---------------------------------------------------------------------------
// EVASION (a) — comment-hidden literal must STILL be treated as MISSING.
// ---------------------------------------------------------------------------

test('evasion (a): `overflow-hidden` surviving only in a JSX comment is still MISSING (comment-strip is load-bearing)', () => {
  // A1a (h-[100svh]), A1c (100dvh), A1d (min-h-0/flex-1) are all present in the
  // LIVE className/style. ONLY A1b (overflow-hidden) has been reverted out of the
  // live className and left behind inside a `{/* ... *\/}` JSX comment.
  const evaded =
    '<main\n' +
    '  className="relative flex h-[100svh] flex-col bg-[#08090b] px-5"\n' +
    "  style={{ height: '100dvh' }}\n" +
    '>\n' +
    '  {/* overflow-hidden used to live in the className above — reverted out */}\n' +
    '  <div className="relative z-10 flex w-full min-h-0 flex-1 flex-col">x</div>\n' +
    '</main>';

  // A naive byte-grep WOULD pass: the token is literally present in the bytes.
  assert.ok(
    evaded.includes('overflow-hidden'),
    'precondition: the commented token is present in the raw bytes (a naive grep would be fooled)',
  );
  // After comment-stripping the token is gone — proving the strip is real.
  assert.ok(
    !stripComments(evaded).includes('overflow-hidden'),
    'stripComments must remove the JSX-commented `overflow-hidden`',
  );

  // The gate must FLAG exactly A1b and nothing else (the other A1 literals are live).
  const violations = assertFile('links-experience.tsx', evaded, A1_CHECKS);
  assert.equal(violations.length, 1, 'exactly one A1 violation expected (only A1b reverted)');
  assert.deepEqual(idsOf(violations), ['A1b'], 'the flagged check must be A1b (overflow-hidden)');
});

test('positive control (a): a live `overflow-hidden` in the className produces ZERO A1 violations', () => {
  const clean =
    '<main\n' +
    '  className="relative flex h-[100svh] flex-col overflow-hidden bg-[#08090b] px-5"\n' +
    "  style={{ height: '100dvh' }}\n" +
    '>\n' +
    '  <div className="relative z-10 flex w-full min-h-0 flex-1 flex-col">x</div>\n' +
    '</main>';
  const violations = assertFile('links-experience.tsx', clean, A1_CHECKS);
  assert.equal(violations.length, 0, `clean A1 source must not flag; got: ${violations.join(' | ')}`);
});

// ---------------------------------------------------------------------------
// EVASION (b) — reordered/reflowed pill drops `sm:inline-flex` while an unrelated
// bare `hidden` remains; A3's bounded regex must still FLAG the un-gating.
// ---------------------------------------------------------------------------

test('evasion (b): reflowed useWeb pill with `sm:inline-flex` dropped is FLAGGED even though a stray `hidden md:block` remains', () => {
  // The :188-style surface toggle keeps a bare `hidden`. The pill has been
  // reordered (`whitespace-nowrap inline-flex`) and its `sm:inline-flex` removed,
  // so the second action now shows at <=412px — a real layout regression.
  const evaded =
    '<div className="hidden md:block"><SurfaceToggle /></div>\n' +
    "<a className={buttonClasses({ size: 'sm', className: 'whitespace-nowrap inline-flex' })}>Use on web</a>";

  // A naive single-token `hidden` check WOULD pass: `hidden` is present in bytes.
  assert.ok(
    stripComments(evaded).includes('hidden'),
    'precondition: a bare `hidden` is present (a naive single-token check would be fooled)',
  );

  const violations = assertFile('glass-nav.tsx', evaded, A3_CHECKS);
  assert.equal(violations.length, 1, 'the dropped sm:inline-flex must be flagged despite the stray hidden');
  assert.deepEqual(idsOf(violations), ['A3'], 'the flagged check must be A3');
});

test('positive control (b): the real `hidden whitespace-nowrap sm:inline-flex` pill produces ZERO A3 violations', () => {
  const clean =
    '<div className="hidden md:block"><SurfaceToggle /></div>\n' +
    "<a className={buttonClasses({ size: 'sm', className: 'hidden whitespace-nowrap sm:inline-flex' })}>Use on web</a>";
  const violations = assertFile('glass-nav.tsx', clean, A3_CHECKS);
  assert.equal(violations.length, 0, `clean A3 source must not flag; got: ${violations.join(' | ')}`);
});

test('bound proof (b): a source with ONLY the stray `hidden md:block` and NO pill at all still flags A3', () => {
  // The strongest form of the bound: the :188 stray in isolation must not
  // satisfy A3 — the bounded regex requires `hidden … sm:inline-flex` co-occurring
  // inside ONE quoted class string, which `"hidden md:block"` never provides.
  const strayOnly = '<div className="hidden md:block"><SurfaceToggle /></div>';
  const violations = assertFile('glass-nav.tsx', strayOnly, A3_CHECKS);
  assert.deepEqual(idsOf(violations), ['A3'], 'a lone `hidden md:block` must NOT satisfy A3');
});
