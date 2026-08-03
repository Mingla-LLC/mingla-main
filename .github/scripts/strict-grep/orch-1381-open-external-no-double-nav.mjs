#!/usr/bin/env node
/**
 * ORCH-1381 ADDENDUM D-B [business-getapp-android-choice].
 * Invariant: I-PROPOSED-1381-OPEN-EXTERNAL-SINGLE-OWNER (DRAFT until CLOSE).
 *
 * THE BUG THIS GATE EXISTS TO FORBID. Four marketing call sites shipped:
 *
 *     const win = window.open(dest, '_blank', 'noopener,noreferrer')
 *     if (!win) window.location.assign(dest)   // "popup-blocked fallback"
 *
 * Per the HTML spec, `noopener` — and `noreferrer`, which IMPLIES `noopener` — force
 * window.open to return `null` EVEN ON SUCCESS. So `!win` was ALWAYS true and the
 * "fallback" fired on every tap: a new tab opened AND the page navigated away. Every
 * marketing CTA double-navigated in production, and ORCH-1328's "/links stays
 * mounted" invariant was violated by the very code its own gate was passing.
 *
 * WHY THE OLD GUARDS DID NOT CATCH IT (ADDENDUM D-A3 — read before weakening this).
 * orch-1324 (e) and orch-1328 (4) required the TOKEN `window.location.assign(` as a
 * "no silent failure" guard, and were satisfied by code whose fallback fired 100% of
 * the time. A presence check for an error path cannot distinguish "handles the
 * error" from "is permanently IN the error path". That is why R3 below is
 * STRUCTURAL: it asserts assign( is the NEGATIVE branch of a successful open, not an
 * unconditional sibling. A gate that passes both the bug and the fix is decorative.
 *
 * THE HALF-FIX TRAP (ADDENDUM C-4, browser-verified). `noreferrer` ALONE also
 * returns null. An author who "drops noopener" but keeps noreferrer ships the
 * IDENTICAL bug with no visible difference. R1 therefore bans BOTH tokens, and the
 * self-test carries an explicit noreferrer-only case.
 *
 * Over mingla-marketing/lib/open-external.ts (comment-stripped) REQUIRE:
 *   R4 — a .location.assign( popup-block fallback exists (no dead tap).
 *   R1 — NO noopener/noreferrer in the .open( feature string (the bug itself).
 *   R2 — .opener = null is set (preserves the security property noopener gave us).
 *   R3 — STRUCTURAL: .location.assign( sits in the ELSE branch of a successful open.
 *
 * Comment-stripping matters here: this module's docblock deliberately QUOTES the
 * buggy pattern (including 'noopener,noreferrer') to explain it. Without stripping,
 * the gate would fire on its own documentation.
 *
 * --self-test injects fixtures: the prescribed module → pass; each revert shape
 * (shipped bug, noreferrer-only half-fix, fallback deleted, opener not severed,
 * unconditional-sibling assign) → fire.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-marketing")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

/**
 * ORCH-1382 (#917) — TWO owners, not one.
 *
 * ORCH-1381 scoped this gate to the marketing module alone. That was the gap:
 * `mingla-business` has NO import path to `mingla-marketing` (its tsconfig
 * `paths` map only `@/*` and `@mingla/*` -> packages/*), so it carries its OWN
 * `openExternal` — which still shipped the IDENTICAL null-return bug, LIVE,
 * behind `SeeWhosGoingGate.tsx:273`. That violated the ACTIVE contract
 * I-PROPOSED-1342-GATE-NEVER-NAMES-NEVER-REDIRECTS ("the page STAYS MOUNTED,
 * never a redirect") while this very gate reported GREEN.
 *
 * A single-owner invariant that only guards ONE of the two owners is not a
 * single-owner invariant. Both are listed here; adding a third copy of this
 * idiom anywhere means adding it here too.
 *
 * ISSUE-903 — THREE owners now. mingla-admin is a standalone Vite JS app with NO
 * import path to mingla-marketing/lib/open-external.ts or mingla-business's helper
 * (see mingla-admin/eslint.config.js — flat browser config, no TS, no path map),
 * so per the same owner-per-package precedent it carries its OWN
 * mingla-admin/src/lib/openExternal.js, shape-validated here under R1–R4 exactly
 * like the other two.
 */
const TARGETS = [
  "mingla-marketing/lib/open-external.ts",
  "mingla-business/src/services/guestFunnelLink.ts",
  "mingla-admin/src/lib/openExternal.js",
];

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

function checkModule(rawSrc, failures, TARGET = "mingla-marketing/lib/open-external.ts") {
  const src = stripComments(rawSrc);

  // R4 — no silent failure: a genuinely blocked popup must still navigate.
  if (!/\.location\.assign\(/i.test(src)) {
    failures.push(
      `${TARGET}: missing the .location.assign( popup-block fallback — a blocked popup ` +
        `would be a dead tap.`,
    );
  }

  // R1 — BAN the null-returning feature string (the D-B bug itself, incl. the
  // noreferrer-only half-fix trap).
  if (/\.open\([^)\n]*\bno(?:opener|referrer)\b[^)\n]*\)/i.test(src)) {
    failures.push(
      `${TARGET}: window.open( carries noopener/noreferrer — per the HTML spec it then ` +
        `returns null EVEN ON SUCCESS, so the fallback fires unconditionally and every ` +
        `CTA double-navigates. Use a bare window.open(dest,'_blank') + win.opener = null. ` +
        `NOTE: 'noreferrer' ALONE has the same effect — dropping only 'noopener' does ` +
        `NOT fix this.`,
    );
  }

  // R2 — the noopener SECURITY property must be preserved another way.
  if (!/\.opener\s*=\s*null/i.test(src)) {
    failures.push(
      `${TARGET}: win.opener is not severed — dropping noopener without setting ` +
        `opener = null exposes the origin to reverse tabnabbing.`,
    );
  }

  // R3 — STRUCTURAL: assign must be the NEGATIVE branch of a successful open, not an
  // unconditional sibling. This is what makes the guard non-decorative.
  if (!/else\s*\{[^}]*\.location\.assign\(/i.test(src)) {
    failures.push(
      `${TARGET}: .location.assign( is not in the else-branch of a successful open — the ` +
        `fallback must fire ONLY when open() returned null. An unconditional assign( is ` +
        `exactly the ORCH-1381 ADDENDUM D-B double-navigation bug.`,
    );
  }
}

// ---------------------------------------------------------------------------
// ISSUE-903 — repo-wide inline-re-roll BAN.
//
// The old gate only shape-validated the owner files (checkModule R1–R4). That
// left the real hole: nothing stopped a NEW inline `window.open(…, noopener|
// noreferrer)` re-roll from appearing anywhere else — which is exactly how
// mingla-admin's two call sites came to exist un-guarded. This ban closes it:
// a call site opens an external tab ONLY by calling its package's openExternal
// owner; any inline re-roll outside a registered owner fails CI, repo-wide.
//
// The predicate REUSES R1's EXACT regex (byte-identical to the test at the R1
// check above) — so it already catches `noopener,noreferrer`, `noreferrer`-only,
// `noopener`-only, and EVERY case variant. It never fires on a bare
// `window.open(dest, "_blank")` (the legitimate calendar.ts shape) and never on
// the pattern inside a comment (comment-stripped first).
// ---------------------------------------------------------------------------
const containsInlineReRoll = (rawSrc) =>
  /\.open\([^)\n]*\bno(?:opener|referrer)\b[^)\n]*\)/i.test(stripComments(rawSrc));

// Product dirs the ban polices. `.github/` is deliberately OUT of this list: the
// gate scripts quote the banned pattern in string-literal self-test fixtures that
// comment-stripping does NOT remove, and they are protected by their own
// self-tests, never by this scan.
const SCAN_ROOTS = [
  "mingla-admin/src",
  "mingla-business/src",
  "mingla-marketing",
  "app-mobile/src",
  "packages",
];
const SCAN_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
// A hit inside any of these path segments is NOT a failure (build output / vendored).
const SCAN_EXCLUDED_SEGMENTS = ["node_modules", "dist", "build", ".next", ".expo", "coverage"];

function isExcludedFromScan(relPath) {
  // The registered owners legitimately QUOTE the pattern in their docblocks and
  // are already shape-validated by R1–R4.
  if (TARGETS.includes(relPath)) return true;
  const segments = relPath.split(path.sep);
  if (segments.some((s) => SCAN_EXCLUDED_SEGMENTS.includes(s))) return true;
  // Test files intentionally embed the bug pattern as string-literal fixtures
  // (e.g. mingla-business/src/services/__tests__/orch_1382_*.test.ts) — the marketing
  // + business owner tests do this on purpose.
  if (segments.includes("__tests__")) return true;
  const base = segments[segments.length - 1];
  if (base.includes(".test.") || base.includes(".tester.")) return true;
  return false;
}

function scanForInlineReRolls(failures) {
  const lineRe = /\.open\([^)\n]*\bno(?:opener|referrer)\b[^)\n]*\)/i;
  for (const scanRoot of SCAN_ROOTS) {
    const absRoot = path.join(root, scanRoot);
    if (!fs.existsSync(absRoot)) continue;
    const stack = [absRoot];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const abs = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (!SCAN_EXCLUDED_SEGMENTS.includes(entry.name)) stack.push(abs);
          continue;
        }
        if (!entry.isFile()) continue;
        if (!SCAN_EXTENSIONS.has(path.extname(entry.name))) continue;
        const rel = path.relative(root, abs);
        if (isExcludedFromScan(rel)) continue;
        const raw = fs.readFileSync(abs, "utf8");
        if (!containsInlineReRoll(raw)) continue;
        // Name the offending line(s) after a whole-file comment-strip. If a
        // multi-line block comment shifts the numbering, fall back to file-level —
        // the failure is pushed either way (the fire decision is authoritative
        // above via containsInlineReRoll).
        const strippedLines = stripComments(raw).split("\n");
        let located = false;
        strippedLines.forEach((line, i) => {
          if (lineRe.test(line)) {
            located = true;
            failures.push(
              `${rel}:${i + 1}: inline window.open(…, noopener|noreferrer) re-roll OUTSIDE a ` +
                `registered openExternal owner — this reships the ORCH-1381 null-return-on-` +
                `success double-navigation trap. Open external tabs ONLY by calling this ` +
                `package's openExternal owner.`,
            );
          }
        });
        if (!located) {
          failures.push(
            `${rel}: inline window.open(…, noopener|noreferrer) re-roll OUTSIDE a registered ` +
              `openExternal owner — route it through this package's openExternal owner.`,
          );
        }
      }
    }
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const run = (s) => {
    const f = [];
    checkModule(s, f);
    return f;
  };

  // The PRESCRIBED module — must pass.
  const good = `
export function openExternal(dest: string, w: Window = window): void {
  const win = w.open(dest, '_blank')
  if (win) {
    win.opener = null
  } else {
    w.location.assign(dest)
  }
}
`;
  if (run(good).length !== 0) {
    selfFailures.push("prescribed openExternal wrongly flagged: " + JSON.stringify(run(good)));
  }

  // REVERT 1 — the SHIPPED bug → fire (R1 + R2 + R3).
  const shipped = `
export function openExternal(dest: string, w: Window = window): void {
  const win = w.open(dest, '_blank', 'noopener,noreferrer')
  if (!win) w.location.assign(dest)
}
`;
  if (run(shipped).length === 0) selfFailures.push("SHIPPED double-nav bug not flagged");

  // REVERT 2 — THE HALF-FIX TRAP: 'noreferrer' alone still returns null → fire (R1).
  const halfFix = `
export function openExternal(dest: string, w: Window = window): void {
  const win = w.open(dest, '_blank', 'noreferrer')
  if (win) { win.opener = null } else { w.location.assign(dest) }
}
`;
  if (run(halfFix).length === 0) selfFailures.push("HALF-FIX TRAP ('noreferrer' only) not flagged");

  // REVERT 2b — 'noopener' alone also returns null → fire (R1).
  const noopenerOnly = `
export function openExternal(dest: string, w: Window = window): void {
  const win = w.open(dest, '_blank', 'noopener')
  if (win) { win.opener = null } else { w.location.assign(dest) }
}
`;
  if (run(noopenerOnly).length === 0) selfFailures.push("'noopener'-only (also returns null) not flagged");

  // REVERT 2c — ORCH-1382 / SPEC §9.0: BROWSERS ARE CASE-INSENSITIVE. A
  // case-sensitive regex let 'NOOPENER' slip through GREEN while shipping the
  // identical null-return bug. This case pins the /i flags.
  const upperCase = `
export function openExternal(dest: string, w: Window = window): void {
  const win = w.open(dest, '_blank', 'NOOPENER,NOREFERRER')
  if (win) { win.opener = null } else { w.location.assign(dest) }
}
`;
  if (run(upperCase).length === 0) selfFailures.push("UPPERCASE 'NOOPENER,NOREFERRER' not flagged (gate is case-SENSITIVE — browsers are not)");

  // REVERT 2d — MixedCase noreferrer alone → fire.
  const mixedCase = `
export function openExternal(dest: string, w: Window = window): void {
  const win = w.open(dest, '_blank', 'NoReferrer')
  if (win) { win.opener = null } else { w.location.assign(dest) }
}
`;
  if (run(mixedCase).length === 0) selfFailures.push("MixedCase 'NoReferrer' alone not flagged");

  // ORCH-1382 — the EXACT shape mingla-business shipped, live, behind
  // SeeWhosGoingGate. It must fire (it is the marketing bug, second copy).
  const businessShipped = `
export function openExternal(dest: string): void {
  if (typeof window === "undefined") return;
  const win = window.open(dest, "_blank", "noopener,noreferrer");
  if (!win) window.location.assign(dest);
}
`;
  if (run(businessShipped).length === 0) selfFailures.push("the LIVE mingla-business openExternal shape (ORCH-1382) not flagged");

  // ORCH-1382 — the business module's FIXED shape (with its SSR guard + injectable w) must PASS.
  const businessFixed = `
export function openExternal(dest: string, w: Window | undefined = typeof window === "undefined" ? undefined : window): void {
  if (w === undefined) return;
  const win = w.open(dest, "_blank");
  if (win) {
    win.opener = null;
  } else {
    w.location.assign(dest);
  }
}
`;
  if (run(businessFixed).length !== 0) selfFailures.push("the FIXED mingla-business openExternal wrongly flagged: " + JSON.stringify(run(businessFixed)));

  // REVERT 3 — popup-block fallback deleted → fire (R4 + R3).
  const noFallback = `
export function openExternal(dest: string, w: Window = window): void {
  const win = w.open(dest, '_blank')
  if (win) { win.opener = null }
}
`;
  if (run(noFallback).length === 0) selfFailures.push("deleted popup-block fallback (dead tap) not flagged");

  // REVERT 4 — opener not severed → fire (R2).
  const noSever = `
export function openExternal(dest: string, w: Window = window): void {
  const win = w.open(dest, '_blank')
  if (!win) { w.location.assign(dest) }
}
`;
  if (run(noSever).length === 0) selfFailures.push("opener not severed (tabnabbing) not flagged");

  // REVERT 5 — the structural angle: assign( present + opener severed + no banned
  // feature string, but assign( is an UNCONDITIONAL SIBLING → double-navigates.
  // This is the shape R1/R2/R4 alone would ALL pass; only R3 catches it.
  const unconditional = `
export function openExternal(dest: string, w: Window = window): void {
  const win = w.open(dest, '_blank')
  if (win) { win.opener = null }
  w.location.assign(dest)
}
`;
  if (run(unconditional).length === 0) {
    selfFailures.push("UNCONDITIONAL assign( sibling (double-nav, R3-only catch) not flagged");
  }

  // The module's own docblock QUOTES the buggy pattern to explain it — comment
  // stripping must keep the real file passing.
  const commented =
    good +
    "\n// the old bug: const win = window.open(dest, '_blank', 'noopener,noreferrer')\n" +
    "/* and its false fallback: if (!win) window.location.assign(dest) */\n";
  if (run(commented).length !== 0) {
    selfFailures.push("banned pattern inside a COMMENT wrongly flagged (comment-strip broken): " + JSON.stringify(run(commented)));
  }

  // ISSUE-903 — the mingla-admin owner's FIXED shape (JS, SSR guard, injectable w,
  // else-branch fallback) must PASS R1–R4.
  const adminFixed = `
export function openExternal(dest, w = typeof window === "undefined" ? undefined : window) {
  if (w === undefined) return;
  const win = w.open(dest, "_blank");
  if (win) {
    win.opener = null;
  } else {
    w.location.assign(dest);
  }
}
`;
  if (run(adminFixed).length !== 0) {
    selfFailures.push("the FIXED mingla-admin openExternal wrongly flagged: " + JSON.stringify(run(adminFixed)));
  }

  // ISSUE-903 — the EXACT shape the two admin call sites shipped inline before this
  // pass (noopener,noreferrer + unconditional fallback). It must fire (R1).
  const adminShipped = `
export function openExternal(dest, w = typeof window === "undefined" ? undefined : window) {
  const win = w.open(dest, "_blank", "noopener,noreferrer");
  if (!win) w.location.assign(dest);
}
`;
  if (run(adminShipped).length === 0) selfFailures.push("the pre-fix mingla-admin openExternal shape (ISSUE-903) not flagged");

  // ISSUE-903 — the repo-wide inline-re-roll BAN predicate. Hermetic: string inputs,
  // no FS. Reuses R1's regex, so it must fire on every re-roll (incl. UPPERCASE) and
  // pass on the routed call, a bare open, and the pattern inside comments.
  if (!containsInlineReRoll("const win = window.open(dest, '_blank', 'NOOPENER')")) {
    selfFailures.push("ban predicate MISSED an UPPERCASE 'NOOPENER' re-roll (tester's §7 plant)");
  }
  if (!containsInlineReRoll('window.open(url, "_blank", "noopener,noreferrer")')) {
    selfFailures.push("ban predicate MISSED the exact admin 'noopener,noreferrer' shape being removed");
  }
  if (!containsInlineReRoll('window.open(url, "_blank", "noreferrer")')) {
    selfFailures.push("ban predicate MISSED a 'noreferrer'-only re-roll (half-fix trap)");
  }
  if (containsInlineReRoll("openExternal(dest)")) {
    selfFailures.push("ban predicate WRONGLY fired on the routed openExternal( call");
  }
  if (containsInlineReRoll("window.open(dest, '_blank')")) {
    selfFailures.push("ban predicate WRONGLY fired on a BARE window.open (the legitimate calendar.ts shape)");
  }
  if (containsInlineReRoll("// window.open(url, '_blank', 'noopener,noreferrer')")) {
    selfFailures.push("ban predicate WRONGLY fired on the pattern inside a // comment (comment-strip broken)");
  }
  if (containsInlineReRoll("/* window.open(url, '_blank', 'noopener,noreferrer') */")) {
    selfFailures.push("ban predicate WRONGLY fired on the pattern inside a /* */ block (comment-strip broken)");
  }

  if (selfFailures.length) {
    console.error("ORCH-1381 open-external-no-double-nav self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-1381/1382/ISSUE-903 open-external-no-double-nav self-test PASS (21/21 cases,\n  incl. the noreferrer-only trap, the UPPERCASE case-insensitivity case, an\n  unconditional-sibling case only R3 catches, BOTH the live mingla-business broken\n  shape and its fixed shape, the mingla-admin fixed + pre-fix shapes, and the 7-case\n  repo-wide inline-re-roll ban predicate suite — fires on every re-roll incl.\n  UPPERCASE, passes on the routed call / a bare open / the pattern inside comments).");
  process.exit(0);
}

// ---- Live mode (ORCH-1382 — BOTH owners)
const failures = [];
for (const TARGET of TARGETS) {
  const abs = path.join(root, TARGET);
  if (!fs.existsSync(abs)) {
    console.error(`ORCH-1381/1382 FAIL — target not found at ${TARGET} (gate path out of sync).`);
    process.exit(1);
  }
  checkModule(fs.readFileSync(abs, "utf8"), failures, TARGET);
}

// ISSUE-903 — repo-wide inline-re-roll ban: FAIL on any inline window.open(…,
// noopener|noreferrer) outside a registered owner. Joins the same aggregated
// report + non-zero exit as the per-owner shape checks above.
scanForInlineReRolls(failures);

if (failures.length > 0) {
  console.error(
    "ORCH-1381/1382/ISSUE-903 (I-PROPOSED-1381-OPEN-EXTERNAL-SINGLE-OWNER, extended to\n" +
      "mingla-business and mingla-admin) FAIL — each package's openExternal is the ONE owner\n" +
      "of opening an external destination for that package (neither mingla-business nor\n" +
      "mingla-admin has an import path to mingla-marketing, so there are legitimately THREE\n" +
      "owners and ALL THREE are guarded). An owner must open with a BARE\n" +
      "window.open(dest,'_blank') (NEVER noopener/noreferrer — either token makes open()\n" +
      "return null even on success, firing the fallback on every tap and double-navigating\n" +
      "the page), sever win.opener = null to keep the noopener security property, and fall\n" +
      "back to location.assign( ONLY in the else-branch of a successful open. NO product\n" +
      "file outside a registered owner may re-roll window.open(…, noopener|noreferrer)\n" +
      "inline — open external tabs by calling that package's openExternal.\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  `ORCH-1381/1382/ISSUE-903 PASS — all three openExternal owners (${TARGETS.join(", ")})\n` +
    "open with a bare window.open(dest,'_blank'),\n" +
    "carry no noopener/noreferrer feature string (which would null the return even on\n" +
    "success and double-navigate), sever win.opener = null for tabnabbing safety, and\n" +
    "keep the location.assign( popup-block fallback strictly in the else-branch — AND no\n" +
    "product file outside a registered owner re-rolls window.open(…, noopener|noreferrer)\n" +
    "inline (scanned: " + SCAN_ROOTS.join(", ") + ").",
);
