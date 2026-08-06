#!/usr/bin/env node
// #1637 — WHY THIS GATE EXISTS.
//
// `app-mobile/app/index.tsx` carried the sentence "The keep-warm cron handles
// edge function warming instead." for months. It was FALSE. The cron warms
// exactly the functions hardcoded in `FUNCTIONS_TO_WARM`, and Discover's two
// endpoints (`discover-merged-events`, `ticketmaster-events`) were not among
// them — both logged ZERO invocations in a 24h window, so both were guaranteed
// cold on every real user's Discover open (1.5-4s isolate boot on this project
// vs ~90-120ms warm).
//
// The bug was not the missing list entries. The bug was that a comment ASSERTED
// coverage that did not exist, so nobody looked. A comment cannot be trusted to
// stay true; a gate can. This is that gate.
//
// TWO LESSONS FROM THE REPO'S OWN RISK REGISTER ARE BUILT IN:
//   #1550 R2 — a gate that SKIPS a missing/unreadable file is not a gate. Every
//        such case here is exit 2, never a pass.
//   #1518/#1529 — assert the scan OBSERVED something before evaluating any
//        violation. A clean tree and a broken scan look identical otherwise;
//        that is the "unfalsifiable test" class this repo keeps producing.
/**
 * #1637 [discover-keepwarm] — I-PROPOSED-1637-DISCOVER-KEEP-WARM-COVERAGE
 * (DRAFT; flips ACTIVE at CLOSE).
 *
 * WHAT IT ENFORCES
 *   1. COVERAGE. `FUNCTIONS_TO_WARM` in supabase/functions/keep-warm/index.ts
 *      contains BOTH `discover-merged-events` and `ticketmaster-events`. The
 *      list is read out of the ACTUAL array literal in comment-stripped source,
 *      so a mention in prose does not satisfy it.
 *   2. NO REGRESSION of the pre-existing warm set. The three functions that were
 *      already warmed (discover-cards, generate-curated-experiences,
 *      get-person-hero-cards) must stay. The list is append-only in effect —
 *      "fixing" #1637 by swapping entries would be a silent trade.
 *   3. NO 4xx NOISE. Every function named in rule 1 implements the repo's
 *      `warmPing` short-circuit, and that short-circuit sits STRICTLY BEFORE
 *      the function's own required-parameter validation. Both functions answer
 *      a bare `{warmPing:true}` with a 400 otherwise, and ~8.6k/month of
 *      fabricated 4xx per function would mask a real regression. This is an
 *      ORDERING assertion (byte offsets), not a presence assertion — a
 *      short-circuit placed after the validation is still a fail.
 *   4. THE FALSE COMMENT STAYS DEAD. app-mobile/app/index.tsx must not carry
 *      the retired claim, and must name the keep-warm source file so the next
 *      reader is pointed at the thing that actually has to change.
 *
 * MATCHING for rules 1-3 is whitespace-insensitive over comment-stripped
 * source, so reformatting cannot disarm it and a needle cannot be split across
 * a line break to slip past. Rule 4 deliberately reads RAW source, because the
 * artifact it governs IS a comment.
 *
 * WHAT THIS GATE DOES NOT CATCH — read before citing it as proof. It is a
 * STATIC COVERAGE gate. It proves the warm list names the two endpoints and
 * that they can absorb a ping without erroring. It does NOT prove the pg_cron
 * job exists, is `active`, or is on any particular schedule (that lives in the
 * database, not the repo); it does NOT prove the functions are DEPLOYED with
 * these changes; and it does NOT prove Discover is fast — the client-side
 * two-phase fetch is untouched and still open on #1637.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const PATHS = {
  keepWarm: "supabase/functions/keep-warm/index.ts",
  merged: "supabase/functions/discover-merged-events/index.ts",
  ticketmaster: "supabase/functions/ticketmaster-events/index.ts",
  appIndex: "app-mobile/app/index.tsx",
};
const EXPECTED_FILES = Object.keys(PATHS).length;

/** The two endpoints #1637 is about. Rule 1. */
const REQUIRED_DISCOVER_WARM = ["discover-merged-events", "ticketmaster-events"];

/** Already warm before #1637. Rule 2 — must not be traded away. */
const PREEXISTING_WARM = [
  "discover-cards",
  "generate-curated-experiences",
  "get-person-hero-cards",
];

/**
 * Rule 3 — per newly-warmed function: the validation needle its short-circuit
 * must precede. Keys are PATHS keys.
 */
const VALIDATION_AFTER_WARMPING = {
  merged: ['"city_required"', "the city_required rejection"],
  ticketmaster: [
    '"cityorlocationisrequired"',
    "the city-or-location rejection",
  ],
};

/**
 * Rule 4 — the retired false claim, dense and lowercased. Matching is
 * case-INSENSITIVE and comment-marker-insensitive on purpose: the sentence was
 * a comment, so a revival would arrive as a comment, possibly reflowed across
 * lines and possibly recapitalised. A case-sensitive single-line match would be
 * disarmed by pressing Enter, which is not a gate.
 */
const RETIRED_CLAIM = "keep-warmcronhandlesedgefunctionwarminginstead";

/** Comments stripped (the `[^:]` guard keeps `https://` intact), then all
 *  whitespace removed — needles cannot be defeated by reformatting. */
const dense = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, "");

/**
 * Comment TEXT preserved but comment MARKERS and whitespace removed, then
 * lowercased — for rule 4, whose subject IS a comment. Stripping `//`, `/*`,
 * `*​/` and leading `*` is what makes a claim reflowed across two comment lines
 * match the same needle as the single-line original. The `[^:]` guard keeps
 * `https://` intact.
 */
const denseKeepComments = (src) =>
  src
    .replace(/(^|[^:])\/\//g, "$1")
    .replace(/\/\*|\*\//g, "")
    .replace(/^[ \t]*\*/gm, "")
    .replace(/\s+/g, "")
    .toLowerCase();

/**
 * Extract the string entries of the `FUNCTIONS_TO_WARM` array literal from
 * comment-stripped source. Returns null when the literal is absent/unparseable,
 * which callers MUST treat as vacuous (exit 2), never as "no violations".
 * @param {string} denseSrc
 * @returns {string[]|null}
 */
export function parseWarmList(denseSrc) {
  const marker = "FUNCTIONS_TO_WARM=[";
  const start = denseSrc.indexOf(marker);
  if (start === -1) return null;
  const open = start + marker.length;
  const close = denseSrc.indexOf("]", open);
  if (close === -1) return null;
  const inner = denseSrc.slice(open, close);
  const entries = [];
  for (const m of inner.matchAll(/['"]([^'"]+)['"]/g)) entries.push(m[1]);
  return entries;
}

/**
 * Pure so the self-test can plant fixtures.
 * @param {Record<string,string|null>} raw  key -> file contents, or null = missing
 * @returns {{code:number, messages:string[]}}
 */
export function runGate(raw) {
  const keys = Object.keys(PATHS);

  // ---- P-VACUOUS: the scan must have observed every target, non-empty. ----
  if (Object.keys(raw).length !== EXPECTED_FILES) {
    return {
      code: 2,
      messages: [
        `#1637 gate VACUOUS — expected ${EXPECTED_FILES} target files, received ${Object.keys(raw).length}.`,
      ],
    };
  }
  const codes = {};
  const rawKept = {};
  for (const key of keys) {
    const src = raw[key];
    if (src === null || src === undefined) {
      return {
        code: 2,
        messages: [
          `#1637 gate FAIL — ${PATHS[key]} is missing or unreadable. A gate that SKIPS a missing file is not a gate (#1550 R2).`,
        ],
      };
    }
    const d = dense(src);
    if (d.length < 200) {
      return {
        code: 2,
        messages: [
          `#1637 gate VACUOUS — ${PATHS[key]} has only ${d.length} chars of real code after comment-stripping; every assertion below would pass for the wrong reason.`,
        ],
      };
    }
    codes[key] = d;
    rawKept[key] = denseKeepComments(src);
  }

  const failures = [];

  // ---- Rules 1 + 2: the warm list, read out of the real array literal. ----
  const warmList = parseWarmList(codes.keepWarm);
  if (warmList === null) {
    return {
      code: 2,
      messages: [
        `#1637 gate VACUOUS — could not locate a parseable \`FUNCTIONS_TO_WARM = [ ... ]\` literal in ${PATHS.keepWarm}. ` +
          "The coverage rule cannot be evaluated, so this is exit 2, not a pass.",
      ],
    };
  }
  if (warmList.length === 0) {
    return {
      code: 2,
      messages: [
        `#1637 gate VACUOUS — \`FUNCTIONS_TO_WARM\` in ${PATHS.keepWarm} parsed to ZERO entries; ` +
          "a membership test over an empty list proves nothing.",
      ],
    };
  }

  for (const fn of REQUIRED_DISCOVER_WARM) {
    if (!warmList.includes(fn)) {
      failures.push(
        `${PATHS.keepWarm}: \`${fn}\` is NOT in FUNCTIONS_TO_WARM. It is on the consumer Discover ` +
          "cold-open path, so dropping it makes every real Discover open pay a 1.5-4s cold start again (#1637).",
      );
    }
  }
  for (const fn of PREEXISTING_WARM) {
    if (!warmList.includes(fn)) {
      failures.push(
        `${PATHS.keepWarm}: \`${fn}\` was warmed BEFORE #1637 and has been dropped from FUNCTIONS_TO_WARM. ` +
          "The warm list is append-only in effect — trading one hot path for another is a silent regression.",
      );
    }
  }

  // ---- Rule 3: warmPing short-circuit, STRICTLY BEFORE the validation. ----
  for (const [key, [validationNeedle, why]] of Object.entries(
    VALIDATION_AFTER_WARMPING,
  )) {
    const d = codes[key];
    const warmIdx = d.indexOf("if(body.warmPing)");
    const validationIdx = d.indexOf(validationNeedle);

    // Vacuity: if the validation needle is gone the ordering rule is
    // unevaluable. Fail loudly rather than pass by absence.
    if (validationIdx === -1) {
      return {
        code: 2,
        messages: [
          `#1637 gate VACUOUS — ${PATHS[key]} no longer contains ${why} (\`${validationNeedle}\`), ` +
            "so 'the warm short-circuit precedes validation' cannot be evaluated. Re-point the needle.",
        ],
      };
    }
    if (warmIdx === -1) {
      failures.push(
        `${PATHS[key]}: no \`if (body.warmPing)\` short-circuit. keep-warm pings this function with a ` +
          "bare body every 5 minutes, so without it CI is green while production logs ~8.6k fabricated 4xx/month (#1637).",
      );
      continue;
    }
    if (warmIdx > validationIdx) {
      failures.push(
        `${PATHS[key]}: the \`warmPing\` short-circuit sits AFTER ${why} (offset ${warmIdx} > ${validationIdx}). ` +
          "The ping is rejected before it reaches the short-circuit — present but useless (#1637).",
      );
    }
    if (!d.includes('status:"warm"') && !d.includes("status:'warm'")) {
      failures.push(
        `${PATHS[key]}: the warm short-circuit does not return the conventional \`{ status: "warm" }\` body ` +
          "(discover-cards / generate-curated-experiences / record-visit et al. all do).",
      );
    }
  }

  // ---- Rule 4: the false comment stays dead, and points somewhere real. ----
  if (rawKept.appIndex.includes(RETIRED_CLAIM)) {
    failures.push(
      `${PATHS.appIndex}: revived the RETIRED false claim "The keep-warm cron handles edge function warming instead." ` +
        "It was never true — the cron warms only what FUNCTIONS_TO_WARM names — and it read as coverage, which is why #1637 stayed invisible for months.",
    );
  }
  if (!rawKept.appIndex.includes("supabase/functions/keep-warm/index.ts")) {
    failures.push(
      `${PATHS.appIndex}: the Discover-prefetch note no longer names \`supabase/functions/keep-warm/index.ts\`. ` +
        "That pointer is the whole remedy — without it the next reader repeats #1637.",
    );
  }

  if (failures.length > 0) {
    return {
      code: 1,
      messages: [
        "FAIL [I-PROPOSED-1637-DISCOVER-KEEP-WARM-COVERAGE]:",
        ...failures.map((f) => `  x ${f}`),
      ],
    };
  }
  return {
    code: 0,
    messages: [
      `OK [I-PROPOSED-1637-DISCOVER-KEEP-WARM-COVERAGE]: ${EXPECTED_FILES} files scanned; ` +
        `FUNCTIONS_TO_WARM holds ${warmList.length} entries incl. all ${REQUIRED_DISCOVER_WARM.length} Discover ` +
        `endpoints and all ${PREEXISTING_WARM.length} pre-#1637 ones; ` +
        `${Object.keys(VALIDATION_AFTER_WARMPING).length} warmPing short-circuits verified ahead of their validation; ` +
        "the retired false comment is absent and the keep-warm pointer is present.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------
if (process.argv.includes("--self-test")) {
  const pad = (s) => s + "\n" + "const filler = 1; ".repeat(40);
  const clean = () => ({
    keepWarm: pad(`
      const FUNCTIONS_TO_WARM = [
        'discover-cards',
        'generate-curated-experiences',
        'get-person-hero-cards',
        'discover-merged-events',
        'ticketmaster-events',
      ];
      body: JSON.stringify({ warmPing: true }),
    `),
    merged: pad(`
      let body: DiscoverMergedRequest;
      if (body.warmPing) {
        return jsonError({ status: "warm" }, 200);
      }
      const cityName = body.city?.name?.trim();
      if (!cityName) {
        return jsonError({ error: "city_required" }, 400);
      }
    `),
    ticketmaster: pad(`
      const body: RequestBody = await req.json();
      if (body.warmPing) {
        return new Response(JSON.stringify({ status: "warm" }), { headers: corsHeaders });
      }
      if (!city && (!location?.lat || !location?.lng)) {
        return new Response(JSON.stringify({ error: "city or location is required" }), { status: 400 });
      }
    `),
    appIndex: pad(`
      // #1637 — warming is not automatic; the ONLY functions warmed are the ones
      // hardcoded in FUNCTIONS_TO_WARM in supabase/functions/keep-warm/index.ts.
      const prefetchTimer = setTimeout(() => {}, 3000);
    `),
  });

  const problems = [];
  const expect = (label, got, want) => {
    if (got !== want) problems.push(`${label}: expected exit ${want}, got ${got}`);
  };

  // 1 — clean fixture passes.
  expect("clean", runGate(clean()).code, 0);

  // 2 — THE FAILS-ON-REVERT CASE: discover-merged-events drops out of the list.
  {
    const f = clean();
    f.keepWarm = f.keepWarm.replace("'discover-merged-events',\n", "");
    expect("merged dropped from warm list", runGate(f).code, 1);
  }
  // 3 — ticketmaster-events drops out of the list.
  {
    const f = clean();
    f.keepWarm = f.keepWarm.replace("'ticketmaster-events',\n", "");
    expect("ticketmaster dropped from warm list", runGate(f).code, 1);
  }
  // 4 — BOTH drop out (the exact pre-#1637 state).
  {
    const f = clean();
    f.keepWarm = f.keepWarm
      .replace("'discover-merged-events',\n", "")
      .replace("'ticketmaster-events',\n", "");
    expect("pre-#1637 warm list", runGate(f).code, 1);
  }
  // 5 — a pre-existing hot path is TRADED AWAY rather than appended to.
  {
    const f = clean();
    f.keepWarm = f.keepWarm.replace("'discover-cards',\n", "");
    expect("pre-existing warm entry dropped", runGate(f).code, 1);
  }
  // 6 — the name appears only in PROSE, not in the array (the shape a
  //     substring-matching gate would wave through).
  {
    const f = clean();
    f.keepWarm = f.keepWarm
      .replace("'discover-merged-events',\n", "")
      .replace(
        "const FUNCTIONS_TO_WARM",
        "// TODO: warm discover-merged-events one day\n      const FUNCTIONS_TO_WARM",
      );
    expect("name only in a comment", runGate(f).code, 1);
  }
  // 7 — merged loses its warmPing short-circuit entirely (the ping 400s).
  {
    const f = clean();
    f.merged = f.merged.replace(
      /if \(body\.warmPing\) \{[\s\S]*?\n      \}\n/,
      "",
    );
    expect("merged lost warmPing", runGate(f).code, 1);
  }
  // 8 — ticketmaster keeps warmPing but AFTER its validation: present, useless.
  {
    const f = clean();
    f.ticketmaster = pad(`
      const body: RequestBody = await req.json();
      if (!city && (!location?.lat || !location?.lng)) {
        return new Response(JSON.stringify({ error: "city or location is required" }), { status: 400 });
      }
      if (body.warmPing) {
        return new Response(JSON.stringify({ status: "warm" }), { headers: corsHeaders });
      }
    `);
    expect("warmPing after validation", runGate(f).code, 1);
  }
  // 9 — the warm branch returns a non-conventional body.
  {
    const f = clean();
    f.merged = f.merged.replace('status: "warm"', "ok: true");
    expect("non-conventional warm body", runGate(f).code, 1);
  }
  // 10 — the RETIRED false comment is revived verbatim.
  {
    const f = clean();
    f.appIndex += "\n// The keep-warm cron handles edge function warming instead.";
    expect("retired claim revived", runGate(f).code, 1);
  }
  // 10b — revived but REFLOWED across lines. Whitespace-insensitive: still caught.
  {
    const f = clean();
    f.appIndex +=
      "\n// The keep-warm cron handles edge\n// function warming instead.";
    expect("retired claim reflowed", runGate(f).code, 1);
  }
  // 10c — revived with different capitalisation. Case-insensitive: still caught.
  {
    const f = clean();
    f.appIndex +=
      "\n// THE KEEP-WARM CRON HANDLES EDGE FUNCTION WARMING INSTEAD.";
    expect("retired claim recased", runGate(f).code, 1);
  }
  // 10d — revived inside a /* */ block comment. Marker-insensitive: still caught.
  {
    const f = clean();
    f.appIndex +=
      "\n/* The keep-warm cron handles edge\n * function warming instead. */";
    expect("retired claim in block comment", runGate(f).code, 1);
  }
  // 11 — the pointer to the file that actually has to change is lost.
  {
    const f = clean();
    f.appIndex = f.appIndex.replace(
      "supabase/functions/keep-warm/index.ts",
      "somewhere",
    );
    expect("keep-warm pointer lost", runGate(f).code, 1);
  }
  // 12 — VACUITY: a target file is missing. MUST be exit 2, never a pass.
  {
    const f = clean();
    f.merged = null;
    expect("missing file", runGate(f).code, 2);
  }
  // 13 — VACUITY: a target file is comment-only (the #1518 shape).
  {
    const f = clean();
    f.ticketmaster = "// everything real was deleted\n/* and this too */";
    expect("comment-only file", runGate(f).code, 2);
  }
  // 14 — VACUITY: the array literal is gone (renamed/refactored away).
  {
    const f = clean();
    f.keepWarm = f.keepWarm.replace("FUNCTIONS_TO_WARM", "WARM_TARGETS");
    expect("warm literal unparseable", runGate(f).code, 2);
  }
  // 15 — VACUITY: the array literal parses to zero entries.
  {
    const f = clean();
    f.keepWarm = f.keepWarm.replace(
      /const FUNCTIONS_TO_WARM = \[[\s\S]*?\];/,
      "const FUNCTIONS_TO_WARM = [];",
    );
    expect("empty warm list", runGate(f).code, 2);
  }
  // 16 — VACUITY: the validation needle the ordering rule anchors on is gone.
  {
    const f = clean();
    f.merged = f.merged.replace('"city_required"', '"needs_a_city"');
    expect("ordering anchor lost", runGate(f).code, 2);
  }
  // 17 — a violation hidden in a CODE COMMENT must NOT fail rules 1-3
  //      (comments are stripped for those files).
  {
    const f = clean();
    f.merged += '\n// we used to `if (body.warmPing)` after "city_required"';
    expect("comment-only violation", runGate(f).code, 0);
  }
  // 18 — reformatting must NOT disarm the gate (whitespace-insensitive).
  {
    const f = clean();
    f.merged = f.merged.replace(
      "if (body.warmPing) {",
      "if (\n        body.warmPing\n      ) {",
    );
    expect("reformatted short-circuit still detected", runGate(f).code, 0);
  }
  // 19 — double-quoted warm-list entries parse identically to single-quoted.
  {
    const f = clean();
    f.keepWarm = f.keepWarm.replace(/'/g, '"');
    expect("double-quoted list entries", runGate(f).code, 0);
  }

  if (problems.length) {
    console.error("#1637 DISCOVER-KEEP-WARM-COVERAGE self-test FAIL:");
    problems.forEach((p) => console.error("  - " + p));
    process.exit(1);
  }
  console.log(
    "#1637 DISCOVER-KEEP-WARM-COVERAGE self-test PASS " +
      "(22/22: 1 clean, 2-6 warm-list coverage incl. fails-on-revert + prose-only, " +
      "7-9 warmPing short-circuit presence/ordering/shape, " +
      "10/10b/10c/10d retired-comment revival verbatim/reflowed/recased/block, 11 pointer, " +
      "12-16 vacuity, 17 comment-strip, 18 reformat, 19 quote-style).",
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Live mode
// ---------------------------------------------------------------------------
const raw = {};
for (const [key, rel] of Object.entries(PATHS)) {
  const abs = path.join(repoRoot, rel);
  raw[key] = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}
const result = runGate(raw);
if (result.code === 0) {
  result.messages.forEach((m) => console.log(m));
} else {
  result.messages.forEach((m) => console.error(m));
}
process.exit(result.code);
