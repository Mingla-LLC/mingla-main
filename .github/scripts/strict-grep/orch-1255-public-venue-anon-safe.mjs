#!/usr/bin/env node
/**
 * META-ORCH-1255 — I-PROPOSED-1255-PUBLIC-VENUE-PAGE-ANON-SAFE (DRAFT),
 * strict-grep arm (enforcement (b)). Anon venue reads flow ONLY through
 * venue_public_view (security-definer, verified-only); venue_listings has no
 * anon grant. On the anon buyer web such a read would 401 at runtime AND
 * signal a policy-widening attempt. SQL runtime complement:
 * supabase/migrations/__tests__/orch_1255_public_view_anon.test.sql.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * #1559 — WHAT CHANGED HERE, AND WHY IT MATTERED MORE THAN THE MOVE ITSELF
 *
 * This gate used to read:
 *
 *     if (f.code === null) continue;   // Leg C file not shipped yet — skipped.
 *
 * and it pinned `mingla-business/src/components/venue/PublicVenuePage.tsx` by
 * literal path. #1559 moved that file into `packages/brand-rendering/`. Without
 * this rewrite the gate would have read `null` for its target, `continue`d past
 * it, found zero failures and **reported green** — while the invariant it
 * exists to protect quietly stopped being enforced on the buyer surface. Green
 * CI and an unguarded anon read at the same time is the worst failure mode
 * available, because nothing looks wrong.
 *
 * The skip is now a HARD FAILURE. A target that is missing, unreadable, empty,
 * or comment-only is exit 2 — never a pass. Three properties make that real:
 *
 *   P-COUNT     the scan must observe exactly as many files as it declares;
 *   P-PRESENT   every declared target must resolve to real content;
 *   P-SUBSTANCE every target must carry enough code after comment-stripping
 *               that `DIRECT_TABLE.test()` could plausibly have matched — a
 *               file stubbed down to a comment can no longer pass vacuously.
 *
 * #1554 is the general fix for this class across the repo. This gate does not
 * wait for it, and #1554 must not assume this one is still broken.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const SELF_TEST = process.argv.includes("--self-test");

/**
 * Every file on the anon public-venue read path.
 *
 * `sharedScreen` is where the buyer-web venue body lives after #1559; the two
 * ROUTE entries are the mounts that reach it, and they are listed because a
 * route file is the one path in this chain that cannot move without the
 * router noticing. `consumerScreen` is the native fork that #1560 deletes —
 * until then it is a second anon reader of the same data and belongs here.
 */
const FILES = [
  "mingla-business/src/services/publicEventsService.ts",
  "packages/brand-rendering/PublicVenueScreen.tsx",
  "mingla-business/app/b/[brandSlug]/v/[venueSlug].tsx",
  "app-mobile/src/services/publicVenueService.ts",
  "app-mobile/src/screens/ConsumerPublicVenueScreen.tsx",
];

const DIRECT_TABLE = /\.from\(\s*["'`]venue_listings["'`]\s*\)/;

/** Comments stripped, so a commented-out example read is not a false positive
 *  and a comment-only stub cannot masquerade as substance. */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** Below this much real code, every assertion would pass for the wrong reason. */
const MIN_REAL_CHARS = 200;

/**
 * @param {{name:string, code:string|null}[]} files
 * @returns {{code:number, failures:string[]}} code 0 pass, 1 violation, 2 vacuous
 */
export const run = (files, expectedCount = FILES.length) => {
  // ---- P-COUNT ----------------------------------------------------------
  if (files.length !== expectedCount) {
    return {
      code: 2,
      failures: [
        `VACUOUS: expected ${expectedCount} target files, received ${files.length}. ` +
          "The scan did not observe what it claims to enforce.",
      ],
    };
  }

  const failures = [];
  for (const f of files) {
    // ---- P-PRESENT — the change that closes #1550 R2. -------------------
    if (f.code === null || f.code === undefined) {
      return {
        code: 2,
        failures: [
          `${f.name}: MISSING or unreadable. A gate that SKIPS a missing file is not a gate — ` +
            "it reports green while the invariant stops being enforced (#1550 R2). " +
            "If this file legitimately moved, REPOINT this gate in the same PR that moves it.",
        ],
      };
    }
    // ---- P-SUBSTANCE ----------------------------------------------------
    const real = stripComments(f.code).replace(/\s+/g, "");
    if (real.length < MIN_REAL_CHARS) {
      return {
        code: 2,
        failures: [
          `${f.name}: only ${real.length} chars of real code after comment-stripping ` +
            `(minimum ${MIN_REAL_CHARS}). The venue_listings check below could not have ` +
            "matched anything, so a pass here would prove nothing.",
        ],
      };
    }
    if (DIRECT_TABLE.test(f.code)) {
      failures.push(
        `${f.name}: queries from("venue_listings") directly — anon/public venue reads must go through venue_public_view (definer, verified-only).`,
      );
    }
  }
  return { code: failures.length > 0 ? 1 : 0, failures };
};

if (SELF_TEST) {
  const body = (extra) =>
    `const x = 1;\n${"const filler = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';\n".repeat(8)}${extra}`;
  const clean = FILES.map((name) => ({
    name,
    code: body('const { data } = await supabase.from("venue_public_view").select("*");'),
  }));

  const problems = [];
  const expect = (label, got, want) => {
    if (got !== want) problems.push(`${label}: expected exit ${want}, got ${got}`);
  };

  // 1 — a clean tree passes.
  expect("clean fixture", run(clean).code, 0);

  // 2 — a direct venue_listings read still fails (the original rule).
  {
    const bad = clean.map((f, i) =>
      i === 0
        ? { ...f, code: body('await supabase.from("venue_listings").select("*");') }
        : f,
    );
    expect("direct venue_listings read", run(bad).code, 1);
  }

  // 3 — THE #1559 REGRESSION GUARD. A missing target is a HARD FAILURE.
  //     Before #1559 this fixture returned 0 (the `continue`), which is exactly
  //     how a file move disarmed the gate while CI stayed green.
  {
    const missing = clean.map((f, i) => (i === 1 ? { ...f, code: null } : f));
    const result = run(missing);
    expect("missing target file", result.code, 2);
    if (!result.failures.some((m) => m.includes("MISSING"))) {
      problems.push("missing-target failure did not name the missing file");
    }
  }

  // 4 — a target stubbed down to comments cannot pass vacuously.
  {
    const stub = clean.map((f, i) =>
      i === 1 ? { ...f, code: "// everything moved somewhere else\n" } : f,
    );
    expect("comment-only target", run(stub).code, 2);
  }

  // 5 — a short scan (a target silently dropped from FILES) is vacuous.
  expect("truncated scan", run(clean.slice(0, 2)).code, 2);

  // 6 — the table check reads RAW source, deliberately: even a commented-out
  //     `from("venue_listings")` fails. Unchanged from the original gate, and
  //     kept on purpose — a commented-out anon read of a table with no anon
  //     grant is a draft of the thing this invariant forbids, and the cost of
  //     the false positive is one comment reworded. Comment-stripping is used
  //     ONLY to measure substance (P-SUBSTANCE), never to soften the rule.
  {
    const commented = clean.map((f, i) =>
      i === 0
        ? { ...f, code: body('// await supabase.from("venue_listings").select("*");') }
        : f,
    );
    expect("commented-out read still fails", run(commented).code, 1);
  }

  if (problems.length > 0) {
    console.error("SELF-TEST FAIL:");
    for (const p of problems) console.error(`- ${p}`);
    process.exit(1);
  }
  console.log(
    `ORCH-1255 public-venue-anon-safe gate self-test passed (${FILES.length} targets; missing/stubbed/short-scan all HARD FAIL).`,
  );
  process.exit(0);
}

const files = FILES.map((rel) => {
  const p = join(root, rel);
  return { name: rel, code: existsSync(p) ? readFileSync(p, "utf8") : null };
});
const { code, failures } = run(files);
if (code !== 0) {
  console.error(
    code === 2
      ? "ORCH-1255 public-venue-anon-safe gate VACUOUS — it could not evaluate its own invariant:"
      : "ORCH-1255 public-venue-anon-safe gate failed:",
  );
  for (const f of failures) console.error(`- ${f}`);
  process.exit(code);
}
console.log(
  `ORCH-1255 public-venue-anon-safe gate passed (${FILES.length} targets, all present and substantive).`,
);
