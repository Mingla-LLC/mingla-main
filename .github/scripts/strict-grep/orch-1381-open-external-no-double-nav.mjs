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
 */
const TARGETS = [
  "mingla-marketing/lib/open-external.ts",
  "mingla-business/src/services/guestFunnelLink.ts",
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

  if (selfFailures.length) {
    console.error("ORCH-1381 open-external-no-double-nav self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-1381/1382 open-external-no-double-nav self-test PASS (12/12 cases,\n  incl. the noreferrer-only trap, the UPPERCASE case-insensitivity case, an\n  unconditional-sibling case only R3 catches, and BOTH the live mingla-business\n  broken shape and its fixed shape).");
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

if (failures.length > 0) {
  console.error(
    "ORCH-1381/1382 (I-PROPOSED-1381-OPEN-EXTERNAL-SINGLE-OWNER, extended to mingla-business)\n" +
      "FAIL — each package's openExternal is the ONE owner of opening an external\n" +
      "destination for that package (mingla-business has NO import path to mingla-marketing,\n" +
      "so there are legitimately TWO owners and BOTH are guarded). It must open with a BARE\n" +
      "window.open(dest,'_blank') (NEVER noopener/noreferrer — either token makes open()\n" +
      "return null even on success, firing the fallback on every tap and double-navigating\n" +
      "the page), sever win.opener = null to keep the noopener security property, and fall\n" +
      "back to location.assign( ONLY in the else-branch of a successful open.\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  `ORCH-1381/1382 PASS — both openExternal owners (${TARGETS.join(", ")})\n` +
    "open with a bare window.open(dest,'_blank'),\n" +
    "carries no noopener/noreferrer feature string (which would null the return even on\n" +
    "success and double-navigate), severs win.opener = null for tabnabbing safety, and\n" +
    "keeps the location.assign( popup-block fallback strictly in the else-branch.",
);
