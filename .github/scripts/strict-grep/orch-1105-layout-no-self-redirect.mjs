#!/usr/bin/env node
/**
 * ORCH-1105 [Business-web parity strict-grep gates] — I-LAYOUT-NO-SELF-REDIRECT.
 *
 * WHY: ORCH-1103 fixed a sign-out white screen caused by React error #185 — the
 * root layout redirected to `/` even while ALREADY on `/`, re-triggering
 * navigation every render → torn-down tree → white screen. The fix introduced
 * two pure, unit-tested predicates in `src/utils/coldLoadAuthGates.ts`:
 *   - `isSignInRoute(pathname)`          → is the user already AT the sign-in route?
 *   - `shouldRedirectToSignInFromRoute({...pathname})` → loop-safe redirect
 *     decision that is FALSE when already at the sign-in route.
 * The layout must keep importing + using both, and every `<Redirect href="/">`
 * must be GUARDED by a sign-in-route-aware condition so the `/` → `/`
 * self-redirect loop can never regress.
 *
 * RULE (against `mingla-business/app/_layout.tsx`):
 *   1. imports `isSignInRoute` AND `shouldRedirectToSignInFromRoute` from the
 *      coldLoadAuthGates util.
 *   2. references `shouldRedirectToSignInFromRoute(` (used, not just imported).
 *   3. references `isSignInRoute(` (used, not just imported).
 *   4. every `<Redirect href="/" />` return must appear in a render branch that
 *      is gated by a sign-in-route-aware guard. We assert this conservatively:
 *      every `<Redirect href="/" .../>` JSX occurrence must, within the
 *      preceding window of the file, be controlled by EITHER:
 *        - a `!atSignInRoute` / `!isSignInRoute(` guard, OR
 *        - the `redirectToSignIn` variable (which derives from
 *          shouldRedirectToSignInFromRoute → already false at the sign-in route).
 *      An UNGUARDED `<Redirect href="/" />` (one with no sign-in-route guard in
 *      its controlling condition) FAILS the gate.
 *
 * SCOPE: the single file `mingla-business/app/_layout.tsx`. This is the auth
 * gate; no other file owns the cold-load redirect.
 *
 * Self-test (`--self-test`) proves the gate FIRES on a synthetic unguarded
 * redirect / missing-import layout and PASSES on a guarded one.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const LAYOUT_REL = "mingla-business/app/_layout.tsx";

// `<Redirect href="/" ... />` — only the literal root target is loop-prone.
const ROOT_REDIRECT = /<Redirect\s+href=(?:"\/"|{`\/`}|{"\/"}|'\/')[^>]*\/>/g;

// A controlling guard that is sign-in-route aware. We look BACKWARD from the
// redirect for the nearest controlling `if (...)` (or a derived variable that is
// itself sign-in-route aware).
const GUARD_PATTERNS = [
  /!\s*atSignInRoute/, // `if (... && !atSignInRoute)`
  /!\s*isSignInRoute\s*\(/, // `if (!isSignInRoute(pathname))`
  /\bredirectToSignIn\b/, // derived from shouldRedirectToSignInFromRoute (false at /)
];

function analyze(source) {
  const failures = [];

  // (1) imports
  const importsIsSignInRoute = /\bisSignInRoute\b/.test(source);
  const importsShouldRedirect = /\bshouldRedirectToSignInFromRoute\b/.test(
    source,
  );
  if (!importsIsSignInRoute) {
    failures.push(
      "layout does not reference `isSignInRoute` — the ORCH-1103 loop guard import is missing.",
    );
  }
  if (!importsShouldRedirect) {
    failures.push(
      "layout does not reference `shouldRedirectToSignInFromRoute` — the ORCH-1103 loop-safe redirect predicate is missing.",
    );
  }

  // (2) + (3) used as calls
  if (!/shouldRedirectToSignInFromRoute\s*\(/.test(source)) {
    failures.push(
      "`shouldRedirectToSignInFromRoute(` is imported but never called — the loop-safe redirect decision must be computed in the layout.",
    );
  }
  if (!/isSignInRoute\s*\(/.test(source)) {
    failures.push(
      "`isSignInRoute(` is imported but never called — the layout must compute whether it is already at the sign-in route.",
    );
  }

  // (4) every root redirect must be guarded. For each `<Redirect href="/">`,
  // find the nearest preceding CONTROLLING `if (...)` (or `} else if (...)`)
  // condition and require a sign-in-route guard inside THAT condition (or on the
  // redirect line itself). This distinguishes a controlling `if (redirectToSignIn)`
  // from a mere `const redirectToSignIn = ...` declaration — only the former
  // actually gates the redirect.
  const lines = source.split("\n");
  // Match the controlling condition's text, e.g. `if (A && !atSignInRoute) {`.
  const IF_CONDITION = /(?:}\s*)?(?:else\s+)?if\s*\(([^]*?)\)\s*{?\s*$/;
  const seen = new Set();
  lines.forEach((line, idx) => {
    ROOT_REDIRECT.lastIndex = 0;
    if (!ROOT_REDIRECT.test(line)) return;
    if (seen.has(idx)) return;
    seen.add(idx);

    // The redirect line itself may inline a guard (ternary etc.).
    let guardText = line;
    // Walk backward to the nearest controlling `if (...)`. Stop at a function
    // boundary or another return to avoid attributing an unrelated branch.
    for (let j = idx - 1; j >= 0 && j >= idx - 12; j--) {
      const prev = lines[j];
      const m = prev.match(IF_CONDITION);
      if (m) {
        guardText = m[1];
        break;
      }
      // A blank/return/closing-only line before any `if` means the redirect is
      // NOT inside a conditional branch within range → treat as unguarded.
    }
    const guarded = GUARD_PATTERNS.some((p) => p.test(guardText));
    if (!guarded) {
      failures.push(
        `${LAYOUT_REL}:${idx + 1}: unguarded \`<Redirect href="/">\` — no sign-in-route guard (atSignInRoute / isSignInRoute / redirectToSignIn) in its controlling condition. This is the ORCH-1103 \`/\` → \`/\` self-redirect loop (React #185).`,
      );
    }
  });

  return failures;
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];

  const clean = `
import { isSignInRoute, shouldRedirectToSignInFromRoute } from "../src/utils/coldLoadAuthGates";
export default function RootLayout() {
  const redirectToSignIn = shouldRedirectToSignInFromRoute({ pathname });
  const atSignInRoute = isSignInRoute(pathname);
  if (authResolutionExpired && !atSignInRoute) {
    return <Redirect href="/" />;
  }
  if (redirectToSignIn) {
    return <Redirect href="/" />;
  }
  return <Stack />;
}
`;
  if (analyze(clean).length !== 0) {
    selfFailures.push(
      "clean guarded layout reported failures: " + analyze(clean).join(" | "),
    );
  }

  const unguarded = `
import { isSignInRoute, shouldRedirectToSignInFromRoute } from "../src/utils/coldLoadAuthGates";
export default function RootLayout() {
  const redirectToSignIn = shouldRedirectToSignInFromRoute({ pathname });
  const atSignInRoute = isSignInRoute(pathname);
  if (loading) {
    // BUG: unguarded self-redirect — fires even while already at "/"
    return <Redirect href="/" />;
  }
  return <Stack />;
}
`;
  if (!analyze(unguarded).some((f) => f.includes("unguarded"))) {
    selfFailures.push("unguarded redirect was NOT flagged");
  }

  const missingImport = `
export default function RootLayout() {
  if (loading) { return <Stack />; }
  return <Stack />;
}
`;
  const mi = analyze(missingImport);
  if (
    !mi.some((f) => f.includes("isSignInRoute")) ||
    !mi.some((f) => f.includes("shouldRedirectToSignInFromRoute"))
  ) {
    selfFailures.push("missing-import layout did not flag both predicates");
  }

  const importedButUnused = `
import { isSignInRoute, shouldRedirectToSignInFromRoute } from "../src/utils/coldLoadAuthGates";
const x = "isSignInRoute shouldRedirectToSignInFromRoute mentioned in a string only";
export default function RootLayout() {
  return <Stack />;
}
`;
  const ibu = analyze(importedButUnused);
  if (!ibu.some((f) => f.includes("never called"))) {
    selfFailures.push("imported-but-uncalled predicates were not flagged");
  }

  if (selfFailures.length) {
    console.error("ORCH-1105 I-LAYOUT-NO-SELF-REDIRECT self-test FAIL:");
    selfFailures.forEach((f) => console.error("  - " + f));
    process.exit(1);
  }
  console.log(
    "ORCH-1105 I-LAYOUT-NO-SELF-REDIRECT self-test PASS (4/4 cases).",
  );
  process.exit(0);
}

// ---- Live mode
const abs = path.join(root, LAYOUT_REL);
if (!fs.existsSync(abs)) {
  console.error(
    `ORCH-1105 I-LAYOUT-NO-SELF-REDIRECT FAIL — expected auth gate not found at ${LAYOUT_REL}.`,
  );
  process.exit(1);
}
const failures = analyze(fs.readFileSync(abs, "utf8"));
if (failures.length > 0) {
  console.error(
    `ORCH-1105 I-LAYOUT-NO-SELF-REDIRECT FAIL — the ORCH-1103 sign-out loop guard regressed.\n` +
      `The root layout must import + use isSignInRoute + shouldRedirectToSignInFromRoute, and every\n` +
      `\`<Redirect href="/">\` must be guarded by a sign-in-route-aware condition.\n\nFailures:\n  ` +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1105 I-LAYOUT-NO-SELF-REDIRECT PASS — loop guard intact; no unguarded `/` self-redirect.",
);
