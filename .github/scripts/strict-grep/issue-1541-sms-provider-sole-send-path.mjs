#!/usr/bin/env node
// #1541 — WHY THIS GATE EXISTS.
// I-PROPOSED-1161-UNIFIED-DISPATCHER-SOLE-SEND-PATH was ACTIVE from 2026-06-20
// while four edge functions sent SMS straight to Twilio. Its stated enforcement
// named a strict-grep that was never written; the gate that did exist opened
// exactly one file — smsAdapter.ts — the one file guaranteed to comply. A gate
// that reads only the compliant file can only ever confirm compliance.
// This gate sweeps every edge function, and it FAILS when it matches nothing:
// a scan that observed zero files, or zero sanctioned provider endpoints, is a
// broken scan, not a clean tree. See #1518 (vacuous pass when the target string
// survives elsewhere) and #1529 (assert the match count before anything else).
/**
 * #1541 [SMS sole send path] — I-PROPOSED-1541-SMS-PROVIDER-EGRESS-ALLOWLIST.
 *
 * WHAT IT ENFORCES: no file under `supabase/functions/` may reach an SMS
 * provider MESSAGE-SEND endpoint except `_shared/adapters/smsAdapter.ts` and the
 * two documented Twilio Verify exemptions.
 *
 * SCOPED TO SEND ENDPOINTS, NOT TO THE TWILIO HOSTNAME — a deliberate decision
 * (#1541 SPEC §4.6, orchestrator review 2026-08-04):
 *   - `send-otp` / `verify-otp` use Twilio VERIFY (`verify.twilio.com`), a
 *     provider-owned OTP product on a different host. Mingla sends `{To,Channel}`
 *     and never authors a message body, so there is nothing for smsAdapter —
 *     which requires a `message` to sanitize, footer and segment — to carry. It
 *     also carries voice and WhatsApp (`ALLOWED_CHANNELS=['sms','whatsapp','call']`),
 *     and routing a voice call through an SMS adapter is incoherent. They are
 *     ALLOWLISTED for `verify.twilio.com` and nothing else.
 *   - `api-health-probe` reads `Accounts/{sid}.json` and `/Balance.json` — account
 *     metadata and balance only, never `Messages.json`. It is NOT a send path and
 *     needs no exemption: a hostname-scoped gate would have to carve it out, which
 *     would weaken the gate for no reason.
 *
 * DETECTED SEND ENDPOINTS (each anchored to an opening quote of ANY of the three
 * classes `"` `'` and BACKTICK — the #1518 lesson: a no-substitution template
 * literal type-checks identically and slips past a `["']`-only class):
 *   - twilio_messages : `api.twilio.com` … `/Messages.json`
 *   - termii_send     : `/api/sms/send`
 *   - twilio_verify   : `verify.twilio.com`
 *
 * FALSIFIABILITY — three independent guards. A run that observed NOTHING exits
 * non-zero:
 *   P-VACUOUS(files)   : zero source files discovered            → exit 2
 *   P-VACUOUS(matches) : zero sanctioned provider occurrences    → exit 2
 *   ANCHOR             : smsAdapter.ts lost its Twilio or Termii → exit 2
 * The match-count assertion runs BEFORE any violation is evaluated (#1529).
 *
 * TWO DETECTORS, both CASE-INSENSITIVE (DNS is; `API.Twilio.Com` resolves and
 * bills identically — #1541 tester T-10):
 *   1. per-line — the historical shapes, reported with a line number;
 *   2. literal-space correlation over a CORRELATION UNIT — the contents of
 *      every string/template literal in every file of one edge-function
 *      directory, concatenated and lowercased. A hoisted host constant, a URL
 *      split across lines, a path assembled from fragments, and a host and path
 *      living in SEPARATE FILES of the same function all reassemble here
 *      (#1541 tester T-3/T-4/T-5, T-10, T-11). Allowlisted files and test
 *      fixtures contribute NOTHING to the space, so the sanctioned adapter
 *      cannot lend its host and path to a rogue sibling.
 *
 * ===========================================================================
 * WHAT THIS GATE DOES NOT CATCH. READ THIS BEFORE CITING IT AS PROOF.
 * ===========================================================================
 * PREVIOUS VERSIONS OF THIS BLOCK NAMED THE WRONG CATEGORY. They said the blind
 * spot was a URL that "never exists as text" — but the evasions found in review
 * existed ENTIRELY as static text and escaped for other reasons. A guard that
 * documents the wrong limitation is worse than one documenting none, because
 * the next reader trusts a boundary that is not where they think it is. That is
 * the failure class catalogued in #1553, committed by this file's own header.
 *
 * The gate correlates LITERAL TEXT, WITHIN ONE CORRELATION UNIT. So the three
 * real gaps are:
 *
 *   1. FRAGMENTS SPLIT ACROSS UNITS. Correlation is scoped to a single
 *      edge-function directory. A host literal in `_shared/hosts.ts` with the
 *      path in `some-fn/index.ts` is fully static, ordinary-looking text and is
 *      NOT caught. Closing it needs module-graph resolution, or treating a bare
 *      provider-host literal anywhere as a violation in its own right — which
 *      would also flag `api-health-probe`, whose host mention is legitimate.
 *      VERIFIED EVADING.
 *   2. TEXT TRANSFORMED BEFORE USE. base64/hex decoding, reversal,
 *      `String.fromCharCode(...)`, or a loop — the target string never appears
 *      in the source in the form matched here. VERIFIED EVADING.
 *   3. VALUES THAT ARE NEVER LITERALS. A host or path read from an environment
 *      variable, runtime config, a database row or a remote response and
 *      assembled at request time; or a request issued by a transitive
 *      dependency rather than by this source. VERIFIED EVADING.
 *
 * All three were confirmed by running them against this gate, not reasoned
 * about. (1) is the one to know: it is plain text and an ordinary refactor.
 *
 * The detectors close the ACCIDENTAL routes — the ones ordinary refactoring
 * produces, which is how all four historical bypasses arose — and raise the
 * cost of deliberate ones. They do NOT make direct egress impossible, and the
 * invariant must not claim they do.
 *
 * The real-time control is not this gate: it is the adapter's kill switch,
 * which refuses to transmit with zero provider HTTP while a market is dark.
 * This gate protects the DURABILITY of that arrangement, not the arrangement.
 * ===========================================================================
 *
 * `--self-test` runs its cases against the SAME runGate() the live mode uses,
 * so the vacuity guards are exercised for real rather than described.
 *
 * Exit 0 clean / 1 violation / 2 script or vacuity error.
 *
 * Model: i-proposed-966-cover-video-provider-bunny-only.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const SCAN_ROOT = "supabase/functions";
// #1541 tester T-6 — Deno resolves .mts/.cts, and .jsx/.cjs are equally
// deployable. A sender written in any of them used to be NEVER EVEN READ. That
// is not an adversarial hole; it is what happens when someone adds a handler in
// a new extension next quarter and the guard silently stops guarding — the exact
// way the artifacts catalogued in #1553 came to exist.
const SCAN_EXT = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
  ".js",
  ".jsx",
]);
const SKIP_DIR = new Set([
  "node_modules",
  "__tests__",
  "_test",
  "dist",
  "build",
]);
// Intentional-exception escape hatch (standard registry convention).
const ALLOW_MARKER = "orch-strict-grep-allow sms-provider-sole-send-path";

// The quote class. BACKTICK IS LOAD-BEARING (#1518): every real call site in
// this repo builds its URL as a template literal.
const Q = "[\"'`]";

const ENDPOINTS = [
  {
    id: "twilio_messages",
    label: "Twilio Programmable Messaging (Messages.json)",
    re: new RegExp(`${Q}[^\\n]*api\\.twilio\\.com[^\\n]*Messages\\.json`, "i"),
  },
  {
    id: "termii_send",
    label: "Termii message send (/api/sms/send)",
    re: new RegExp(`${Q}[^\\n]*\\/api\\/sms\\/send`, "i"),
  },
  {
    id: "twilio_verify",
    label: "Twilio Verify (verify.twilio.com)",
    re: new RegExp(`${Q}[^\\n]*verify\\.twilio\\.com`, "i"),
  },
];

// path (repo-relative) → the endpoint ids that path is permitted to reach.
// Adding a new sender means editing THIS list — a visible, reviewed act. That
// is the whole structural point of the gate (#1541 SPEC §9).
const ALLOWLIST = new Map([
  [
    "supabase/functions/_shared/adapters/smsAdapter.ts",
    new Set(["twilio_messages", "termii_send"]),
  ],
  ["supabase/functions/send-otp/index.ts", new Set(["twilio_verify"])],
  ["supabase/functions/verify-otp/index.ts", new Set(["twilio_verify"])],
]);

// #1541 tester T-7 — TEST FIXTURES THAT LEGITIMATELY NAME A PROVIDER ENDPOINT.
// These suites live BESIDE the adapter rather than under a `__tests__/`
// directory, and they reference provider hosts to stub `fetch` and assert on
// captured traffic. Now that test detection is directory-based, they must be
// named explicitly — which is the point: a fixture is an exception to the rule,
// and exceptions belong somewhere a reviewer sees them.
//
// These occurrences are deliberately NOT counted toward `matchCount`. A test
// fixture must never be able to satisfy the non-vacuity assertion on behalf of
// the real send path — that would let the adapter lose its provider calls while
// the sweep still "observed something".
const TEST_FIXTURE_ALLOWLIST = new Map([
  [
    "supabase/functions/_shared/adapters/smsAdapter.issue1518.test.ts",
    new Set(["twilio_messages", "termii_send"]),
  ],
  [
    "supabase/functions/_shared/adapters/smsAdapter.issue1518.adversarial.test.ts",
    new Set(["twilio_messages", "termii_send"]),
  ],
  [
    "supabase/functions/_shared/adapters/smsAdapter.issue1529.test.ts",
    new Set(["twilio_messages", "termii_send"]),
  ],
  [
    "supabase/functions/_shared/adapters/smsAdapter.issue1529.tester.adversarial.test.ts",
    new Set(["twilio_messages", "termii_send"]),
  ],
  [
    "supabase/functions/_shared/adapters/smsAdapter.termii.test.ts",
    new Set(["twilio_messages", "termii_send"]),
  ],
]);

// The anchor: the sanctioned path must still BE the sanctioned path. If
// smsAdapter.ts stops containing both provider calls, the sole send path has
// been dismantled and "0 violations" would be a lie.
const ANCHOR_PATH = "supabase/functions/_shared/adapters/smsAdapter.ts";
const ANCHOR_REQUIRED = ["twilio_messages", "termii_send"];

// #1541 tester T-7 — TEST DETECTION IS BY DIRECTORY, NEVER BY FILENAME.
// This used to skip any file whose NAME matched `*.test.*` / `*.spec.*`, so a
// deployed module called `sender.spec.ts` sitting inside a live function
// directory was never scanned — while shipping inside the function bundle just
// like every other file. A naming convention is not an access control.
//
// Test files that genuinely live beside production code (the adapter suites)
// are handled by the ALLOWLIST below instead: an explicit, reviewed entry per
// path. That is fail-CLOSED — a new endpoint-referencing test in that directory
// turns the gate RED until someone adds it deliberately, which is the correct
// direction to fail.
const isTestFile = (rel) => rel.includes("/__tests__/") || rel.includes("/_test/");

// Neutralize `//` and `/* */` comments to spaces (preserving newlines and line
// numbers) so the gate asserts absence of CODE usage, not narrative mentions.
// A REGEX STRIP IS NOT ACCEPTABLE HERE: the targets live inside template
// literals containing `//` (`https://api.twilio.com/...`), and a naive
// `//`-stripper mangles every one of them into a false negative. String
// literals are preserved because the endpoints ARE string literals.
// Model: i-proposed-966-cover-video-provider-bunny-only.mjs:65-92.
function stripComments(src) {
  let out = "";
  let state = "code"; // code | line | block | s | d | t
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const c2 = src[i + 1];
    if (state === "code") {
      if (c === "/" && c2 === "/") { state = "line"; out += "  "; i++; continue; }
      if (c === "/" && c2 === "*") { state = "block"; out += "  "; i++; continue; }
      if (c === "'") { state = "s"; out += c; continue; }
      if (c === '"') { state = "d"; out += c; continue; }
      if (c === "`") { state = "t"; out += c; continue; }
      out += c;
    } else if (state === "line") {
      if (c === "\n") { state = "code"; out += c; } else out += " ";
    } else if (state === "block") {
      if (c === "*" && c2 === "/") { state = "code"; out += "  "; i++; }
      else out += c === "\n" ? c : " ";
    } else {
      // string literal — preserve content, honor escapes, watch the closer
      out += c;
      if (c === "\\") { out += c2 ?? ""; i++; continue; }
      const closer = state === "s" ? "'" : state === "d" ? '"' : "`";
      if (c === closer) state = "code";
    }
  }
  return out;
}

/**
 * #1541 tester T-3/T-4/T-5 — THE LITERAL SPACE.
 *
 * The per-line detector below requires the host and the path fragment on the
 * SAME physical line, so it only ever enforced "nobody wrote the URL the way
 * the four historical bypasses wrote it" — strictly weaker than the invariant
 * it is cited as enforcing. A hoisted `const TWILIO_HOST = "api.twilio.com"`,
 * or a URL concatenated across two lines, is ORDINARY REFACTORING, not
 * sabotage, and it walked straight past.
 *
 * So a second detector runs over the file's LITERAL SPACE: the contents of
 * every string and template literal in the comment-stripped source,
 * concatenated in source order. Concatenation is what makes it work — a URL
 * split across `"/api" + "/sms" + "/send"` reassembles here, and a host
 * declared far from its path still shares the space.
 *
 * Correlation, not presence: a Twilio hit requires BOTH `api.twilio.com` AND
 * `Messages.json` in that space, so a file that merely names the host (the
 * health probe reads `Accounts/{sid}.json` and `Balance.json`) is not flagged.
 */
/**
 * The CORRELATION UNIT for a repo-relative path: the edge-function directory.
 * `supabase/functions/rogue/constants.ts` and `supabase/functions/rogue/index.ts`
 * share the unit `supabase/functions/rogue`, so a URL split between them still
 * correlates. That directory is both the deployment unit and the unit an
 * ordinary refactor moves code within.
 */
function correlationUnit(rel) {
  const parts = rel.split("/");
  // supabase / functions / <unit> / …
  return parts.length >= 3 ? parts.slice(0, 3).join("/") : rel;
}

function literalSpace(strippedSrc) {
  const out = [];
  let state = "code"; // code | s | d | t
  for (let i = 0; i < strippedSrc.length; i++) {
    const c = strippedSrc[i];
    if (state === "code") {
      if (c === "'") state = "s";
      else if (c === '"') state = "d";
      else if (c === "`") state = "t";
      continue;
    }
    if (c === "\\") {
      i++; // skip the escaped char; it cannot close the literal
      continue;
    }
    const closer = state === "s" ? "'" : state === "d" ? '"' : "`";
    if (c === closer) {
      state = "code";
      continue;
    }
    out.push(c);
  }
  return out.join("");
}

// Correlation rules over the literal space. `all` fragments must ALL be present.
const CORRELATIONS = [
  {
    id: "twilio_messages",
    label: "Twilio Programmable Messaging (Messages.json)",
    all: ["api.twilio.com", "Messages.json"],
  },
  {
    id: "termii_send",
    label: "Termii message send (/api/sms/send)",
    all: ["/api/sms/send"],
  },
  {
    id: "twilio_verify",
    label: "Twilio Verify (verify.twilio.com)",
    all: ["verify.twilio.com"],
  },
];

/**
 * The single evaluation core. Live mode feeds it the real tree; --self-test
 * feeds it virtual trees. Both therefore exercise the SAME vacuity guards —
 * a self-test that describes the guards instead of running them is exactly the
 * unfalsifiable-test bug class this gate exists to close.
 *
 * @param {Array<{rel: string, src: string}>} sources
 * @returns {{code:number, messages:string[], matchCount:number,
 *            sanctioned:Record<string,number>, violations:string[],
 *            scannedFiles:number}}
 */
export function runGate(sources) {
  const messages = [];

  // --- P-VACUOUS (files). A scan that discovered nothing is a broken scan.
  if (!Array.isArray(sources) || sources.length === 0) {
    messages.push(
      `#1541 gate FAIL — discovered ZERO source files under ${SCAN_ROOT}. ` +
        "A gate that matches nothing must fail, not pass.",
    );
    return {
      code: 2,
      messages,
      matchCount: 0,
      sanctioned: {},
      violations: [],
      scannedFiles: 0,
    };
  }

  const violations = [];
  const sanctioned = Object.create(null);
  const anchorSeen = new Set();
  // unit key -> { space, files[], flagged:Set<endpointId> }
  const units = new Map();
  let matchCount = 0;
  let scannedFiles = 0;

  for (const { rel, src } of sources) {
    if (isTestFile(rel)) continue;
    scannedFiles += 1;
    const rawLines = src.split("\n");
    const stripped = stripComments(src);
    const codeLines = stripped.split("\n");
    const permitted = ALLOWLIST.get(rel) ?? null;
    // A test fixture beside production code may NAME an endpoint, but its
    // occurrences never count toward matchCount and never satisfy the anchor.
    const fixturePermitted = TEST_FIXTURE_ALLOWLIST.get(rel) ?? null;
    // Whole-file allow-marker: a file-level correlation hit has no single line
    // to carry the marker, so an explicitly-marked file is exempt from the
    // correlation pass (the per-line pass still honours the per-line marker).
    const fileMarkered = src.includes(ALLOW_MARKER);

    // ---- Detector 2 feed: accumulate this file's literal space into its
    // CORRELATION UNIT (T-3/T-4/T-5, and T-11 across files). Evaluated after
    // the whole sweep, below.
    if (permitted === null && fixturePermitted === null && !fileMarkered) {
      const unit = correlationUnit(rel);
      const acc = units.get(unit) ??
        { space: "", files: [], flagged: new Set() };
      // Lowercased: DNS is case-insensitive, so `API.Twilio.Com` is the same
      // host (#1541 tester T-10).
      acc.space += literalSpace(stripped).toLowerCase();
      acc.files.push(rel);
      units.set(unit, acc);
    }

    for (let i = 0; i < codeLines.length; i++) {
      // The allow-marker lives in a comment, so it is read off the RAW line;
      // endpoint matching runs on the comment-STRIPPED line.
      const markered = (rawLines[i] ?? "").includes(ALLOW_MARKER);
      const line = codeLines[i];
      for (const { id, label, re } of ENDPOINTS) {
        if (!re.test(line)) continue;
        if (permitted !== null && permitted.has(id)) {
          // A sanctioned occurrence. COUNT IT — this is the population the
          // match-count assertion below is asserted against.
          matchCount += 1;
          sanctioned[id] = (sanctioned[id] ?? 0) + 1;
          if (rel === ANCHOR_PATH) anchorSeen.add(id);
          continue;
        }
        if (fixturePermitted !== null && fixturePermitted.has(id)) {
          // A test fixture naming an endpoint. Permitted, but DELIBERATELY NOT
          // counted: a fixture must never stand in for the real send path when
          // the non-vacuity assertion is evaluated.
          continue;
        }
        if (markered) continue; // documented intentional exception
        // Record it so the unit-level correlation does not report the same
        // defect a second time.
        const unitAcc = units.get(correlationUnit(rel));
        if (unitAcc) unitAcc.flagged.add(id);
        violations.push(
          `${rel}:${i + 1}: unsanctioned SMS-provider send endpoint — ${label}. ` +
            "Every SMS must leave Mingla through supabase/functions/_shared/adapters/" +
            "smsAdapter.ts, which owns country routing, the SMS_LIVE_ENABLED_* market " +
            "kill switches, the fail-closed contract and the delivery ledger " +
            "(I-PROPOSED-1541-SMS-PROVIDER-EGRESS-ALLOWLIST).",
        );
      }
    }
  }

  // ---- Detector 2: CORRELATION OVER THE UNIT'S LITERAL SPACE.
  // The unit is the edge-function directory, because that is the deployment
  // unit AND the refactoring unit: splitting a URL into `constants.ts` beside
  // `index.ts` is the single most ordinary refactor there is, and a per-FILE
  // correlator sees two innocent halves (#1541 tester T-11). Allowlisted files
  // and test fixtures contribute nothing to the space, so the sanctioned
  // adapter cannot lend its host and path to a rogue sibling.
  for (const [unit, acc] of units) {
    for (const { id, label, all } of CORRELATIONS) {
      if (acc.flagged.has(id)) continue; // already reported per-line
      if (!all.every((frag) => acc.space.includes(frag.toLowerCase()))) continue;
      const where = acc.files.length === 1
        ? `${acc.files[0]}: assembled across the file`
        : `${unit}/: assembled across ${acc.files.length} files in this function ` +
          `(${acc.files.join(", ")})`;
      violations.push(
        `${where} — unsanctioned SMS-provider send endpoint: ${label}. ` +
          `The fragments [${all.join(" + ")}] all appear in this unit's string ` +
          "literals (case-insensitively), so the URL is reachable even though no " +
          "single line contains it. Every SMS must leave Mingla through " +
          "supabase/functions/_shared/adapters/smsAdapter.ts " +
          "(I-PROPOSED-1541-SMS-PROVIDER-EGRESS-ALLOWLIST).",
      );
    }
  }

  // --- P-VACUOUS (matches) — THE #1529 REQUIREMENT.
  // ASSERTED BEFORE ANY VIOLATION IS EVALUATED. If the sweep found no provider
  // endpoint anywhere — because a path moved, an extension was missed, or the
  // comment strip ate the literals — then "0 violations" means "the gate is
  // blind", not "the tree is clean". Fail.
  if (matchCount === 0) {
    messages.push(
      `#1541 gate FAIL — scanned ${scannedFiles} source files under ${SCAN_ROOT} ` +
        "and found ZERO sanctioned SMS-provider send endpoints. The sweep observed " +
        "nothing, so it cannot report a clean tree: a lookup must assert its match " +
        "count before anything else (#1529), and a check passes vacuously when its " +
        "target survives elsewhere (#1518).",
    );
    return {
      code: 2,
      messages,
      matchCount,
      sanctioned,
      violations,
      scannedFiles,
    };
  }

  // --- ANCHOR: the sanctioned path must still contain BOTH provider calls.
  const anchorMissing = ANCHOR_REQUIRED.filter((id) => !anchorSeen.has(id));
  if (anchorMissing.length > 0) {
    messages.push(
      `#1541 gate FAIL — the sanctioned send path ${ANCHOR_PATH} no longer contains ` +
        `[${anchorMissing.join(", ")}]. The sole send path has been dismantled or ` +
        "moved; a 'no violations' verdict over a missing chokepoint is meaningless.",
    );
    return {
      code: 2,
      messages,
      matchCount,
      sanctioned,
      violations,
      scannedFiles,
    };
  }

  if (violations.length > 0) {
    messages.push(
      "#1541 SMS-PROVIDER-SOLE-SEND-PATH FAIL — an edge function reaches an SMS\n" +
        "provider message-send endpoint directly, bypassing smsAdapter and therefore\n" +
        "bypassing country routing and the market kill switches.\n\nViolations:\n  " +
        violations.join("\n  "),
    );
    return {
      code: 1,
      messages,
      matchCount,
      sanctioned,
      violations,
      scannedFiles,
    };
  }

  messages.push(
    `#1541 SMS-PROVIDER-SOLE-SEND-PATH PASS — scanned ${scannedFiles} source files ` +
      `under ${SCAN_ROOT}; found ${matchCount} sanctioned provider call sites ` +
      `(adapter ${
        (sanctioned.twilio_messages ?? 0) + (sanctioned.termii_send ?? 0)
      }, verify ${sanctioned.twilio_verify ?? 0}); ${violations.length} unsanctioned.`,
  );
  return { code: 0, messages, matchCount, sanctioned, violations, scannedFiles };
}

function walk(dir, files) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIR.has(e.name)) continue;
      walk(path.join(dir, e.name), files);
    } else if (SCAN_EXT.has(path.extname(e.name))) {
      files.push(path.join(dir, e.name));
    }
  }
}

// ---------------------------------------------------------------------------
// Self-test — 10 cases, all driven through runGate() itself.
// ---------------------------------------------------------------------------
if (process.argv.includes("--self-test")) {
  const selfFailures = [];

  const ADAPTER = {
    rel: ANCHOR_PATH,
    src: [
      "const res = await fetch(",
      "  `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,",
      "  { method: 'POST' },",
      ");",
      'const r2 = await fetch(`${baseUrl.replace(/\\/$/, "")}/api/sms/send`, {',
      '  method: "POST",',
      "});",
    ].join("\n"),
  };
  const SEND_OTP = {
    rel: "supabase/functions/send-otp/index.ts",
    src:
      "const url = `https://verify.twilio.com/v2/Services/${sid}/Verifications`;",
  };
  const VERIFY_OTP = {
    rel: "supabase/functions/verify-otp/index.ts",
    src:
      "const url = `https://verify.twilio.com/v2/Services/${sid}/VerificationCheck`;",
  };
  const CLEAN_TREE = [ADAPTER, SEND_OTP, VERIFY_OTP];

  const expect = (n, desc, got, want) => {
    if (got !== want) {
      selfFailures.push(`case ${n} (${desc}): expected exit ${want}, got ${got}`);
    }
  };

  // 1. Clean tree → PASS, and it must report a NON-ZERO match count.
  const c1 = runGate(CLEAN_TREE);
  expect(1, "clean tree", c1.code, 0);
  if (c1.matchCount <= 0) {
    selfFailures.push("case 1: a passing run reported a zero match count");
  }

  // 2. New fn with a double-quoted Twilio Messages.json call → FAIL.
  expect(
    2,
    "double-quoted twilio send",
    runGate([
      ...CLEAN_TREE,
      {
        rel: "supabase/functions/new-sender/index.ts",
        src:
          'await fetch("https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json");',
      },
    ]).code,
    1,
  );

  // 3. Same, BACKTICK template literal → FAIL. (#1518: a `["']` class misses it.)
  expect(
    3,
    "backtick twilio send",
    runGate([
      ...CLEAN_TREE,
      {
        rel: "supabase/functions/new-sender/index.ts",
        src:
          "await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`);",
      },
    ]).code,
    1,
  );

  // 4. New fn POSTing Termii /api/sms/send → FAIL.
  expect(
    4,
    "termii send",
    runGate([
      ...CLEAN_TREE,
      {
        rel: "supabase/functions/new-sender/index.ts",
        src: 'await fetch("https://v3.api.termii.com/api/sms/send", init);',
      },
    ]).code,
    1,
  );

  // 5. New fn calling verify.twilio.com while NOT on the allowlist → FAIL.
  expect(
    5,
    "unallowlisted verify",
    runGate([
      ...CLEAN_TREE,
      {
        rel: "supabase/functions/rogue-otp/index.ts",
        src: 'await fetch("https://verify.twilio.com/v2/Services/VA1/Verifications");',
      },
    ]).code,
    1,
  );

  // 6. Adapter's own Twilio call removed → FAIL (anchor), NOT a clean pass.
  const c6 = runGate([
    {
      rel: ANCHOR_PATH,
      src: 'const r2 = await fetch(`${baseUrl}/api/sms/send`, { method: "POST" });',
    },
    SEND_OTP,
    VERIFY_OTP,
  ]);
  expect(6, "anchor: adapter twilio call removed", c6.code, 2);

  // 7. Zero files under the scan root → FAIL (P-vacuous files).
  expect(7, "P-vacuous files", runGate([]).code, 2);

  // 8. All provider endpoints absent everywhere → FAIL (P-vacuous matches).
  //    This is the case that would otherwise report "0 violations, all clean"
  //    over a gate that had gone completely blind.
  const c8 = runGate([
    { rel: ANCHOR_PATH, src: "export const smsAdapter = { async send() {} };" },
    { rel: "supabase/functions/send-otp/index.ts", src: "export const x = 1;" },
  ]);
  expect(8, "P-vacuous matches", c8.code, 2);
  if (c8.violations.length !== 0) {
    selfFailures.push("case 8: vacuity must be decided BEFORE violations");
  }

  // 9. A violation carrying the allow-marker → PASS.
  expect(
    9,
    "allow-marker suppresses",
    runGate([
      ...CLEAN_TREE,
      {
        rel: "supabase/functions/legacy-sender/index.ts",
        src:
          'await fetch("https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json"); // ' +
          ALLOW_MARKER + " — approved exception",
      },
    ]).code,
    0,
  );

  // 10. The endpoint inside a `//` comment ONLY → PASS (comment strip works,
  //     and it did not also eat the real template literals).
  const c10 = runGate([
    ...CLEAN_TREE,
    {
      rel: "supabase/functions/docs-only/index.ts",
      src:
        '// historical: we used to POST "https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json"\n' +
        "export const noop = true;\n",
    },
  ]);
  expect(10, "comment strip", c10.code, 0);
  if (c10.matchCount !== c1.matchCount) {
    selfFailures.push(
      "case 10: the comment strip changed the sanctioned match count — it is " +
        "eating real string literals",
    );
  }

  if (selfFailures.length) {
    console.error("#1541 SMS-PROVIDER-SOLE-SEND-PATH self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "#1541 SMS-PROVIDER-SOLE-SEND-PATH self-test PASS (10/10 cases: 1 clean, " +
      "2-6 planted violations + anchor, 7-8 vacuity, 9 allow-marker, 10 comment-strip).",
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Live mode
// ---------------------------------------------------------------------------
const absRoot = path.join(repoRoot, SCAN_ROOT);
if (!fs.existsSync(absRoot)) {
  console.error(
    `#1541 gate FAIL — scan root not found at ${absRoot} (gate path out of sync).`,
  );
  process.exit(2);
}
const files = [];
walk(absRoot, files);

const sources = files.map((f) => ({
  rel: path.relative(repoRoot, f).split(path.sep).join("/"),
  src: fs.readFileSync(f, "utf8"),
}));

const result = runGate(sources);
if (result.code === 0) {
  result.messages.forEach((m) => console.log(m));
} else {
  result.messages.forEach((m) => console.error(m));
}
process.exit(result.code);
