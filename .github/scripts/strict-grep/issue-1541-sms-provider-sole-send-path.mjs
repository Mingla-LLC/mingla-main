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
 * `--self-test` runs 10 cases against the SAME runGate() the live mode uses, so
 * the vacuity guards are exercised for real rather than described.
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
const SCAN_EXT = new Set([".ts", ".tsx", ".mjs", ".js"]);
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
    re: new RegExp(`${Q}[^\\n]*api\\.twilio\\.com[^\\n]*Messages\\.json`),
  },
  {
    id: "termii_send",
    label: "Termii message send (/api/sms/send)",
    re: new RegExp(`${Q}[^\\n]*\\/api\\/sms\\/send`),
  },
  {
    id: "twilio_verify",
    label: "Twilio Verify (verify.twilio.com)",
    re: new RegExp(`${Q}[^\\n]*verify\\.twilio\\.com`),
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

// The anchor: the sanctioned path must still BE the sanctioned path. If
// smsAdapter.ts stops containing both provider calls, the sole send path has
// been dismantled and "0 violations" would be a lie.
const ANCHOR_PATH = "supabase/functions/_shared/adapters/smsAdapter.ts";
const ANCHOR_REQUIRED = ["twilio_messages", "termii_send"];

const isTestFile = (rel) =>
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) || rel.includes("/__tests__/");

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
  let matchCount = 0;
  let scannedFiles = 0;

  for (const { rel, src } of sources) {
    if (isTestFile(rel)) continue;
    scannedFiles += 1;
    const rawLines = src.split("\n");
    const codeLines = stripComments(src).split("\n");
    const permitted = ALLOWLIST.get(rel) ?? null;
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
        if (markered) continue; // documented intentional exception
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
