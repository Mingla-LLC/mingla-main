// Issue #1541 — TESTER ADVERSARIAL against the sole-send-path GATE ITSELF.
//
// ===========================================================================
// WHY THIS FILE EXISTS.
// ===========================================================================
// #1541 shipped `issue-1541-sms-provider-sole-send-path.mjs` to enforce
// I-PROPOSED-1541-SMS-PROVIDER-EGRESS-ALLOWLIST. The implementor's own
// built-in self test (10/10) plants violations it already knows the shape of, so it
//
// NOTE ON THE SPELLING ABOVE: the flag name is written in prose, never as the
// literal token, because MANIFEST parity P6 decides whether a file "supports"
// a self test with `src.includes("<the flag>")` — a raw substring over the
// whole file, comments included. This file has NO self-test mode
// (selfTest:"none"), and merely NAMING the flag would make P6 assert otherwise.
// That is the same assert-a-token-as-a-proxy-for-a-property class as #1553.
// can only ever confirm the shapes it was written against. That is the exact
// failure family this rail keeps hitting: #1518 shipped a gate that passed
// vacuously, #1529 shipped an audit that could match zero, and #1541 exists
// because I-PROPOSED-1161's named gate opened only the one file guaranteed to
// comply.
//
// So this suite does the thing a self-test structurally cannot: it attacks the
// gate from OUTSIDE its own imagination. It builds synthetic repo trees in a
// temp dir, runs the REAL gate binary as a subprocess against them, and asserts
// on the REAL exit code — never on the gate's internals, never on a doctored
// copy of it.
//
// It reports two different kinds of truth, and they are labelled:
//
//   PROOFS  (T-1, T-2, T-8, T-9) — properties the gate genuinely has. T-1 is
//           the FAILS-ON-REVERT anchor: it runs the gate against the REAL repo
//           tree, so reverting any of the four migrations turns this red.
//
//   PROOFS  (T-3 … T-7) — CONVERTED FROM PINS, #1541 IMPLEMENT REWORK.
//           These were written as PINS: evasions the gate did NOT catch, held
//           visible in CI so the ceiling could not be buried in a report.
//           Tester finding T-1541-GATE-EVASION (P2). Every one of them is now
//           CLOSED, so each has been flipped from "expect 0 (evades)" to
//           "expect 1 (caught)". The attack shapes are UNCHANGED and stay in CI
//           forever as guarantees rather than as known gaps — which is stronger
//           than deleting them, and is what the pin's own instruction asked for
//           ("IF A PIN STARTS FAILING, THE GATE GOT STRONGER... never weaken
//           the gate to keep this file green").
//
//           What closed them: the gate now runs a SECOND detector over each
//           file's LITERAL SPACE (the contents of every string/template literal,
//           concatenated in source order), correlating host against path, so a
//           hoisted constant, a two-line concatenation and a fragment-assembled
//           path all reassemble and are caught. SCAN_EXT gained
//           .mts/.cts/.cjs/.jsx, and test detection is now by DIRECTORY, never
//           by filename.
//
//           STILL OPEN, and documented as such in the gate's own header and in
//           I-PROPOSED-1541-SMS-PROVIDER-EGRESS-ALLOWLIST: static text analysis
//           cannot see a URL that never exists as text — assembled at runtime
//           from env/config/DB, base64-decoded, or built by String.fromCharCode.
//           Verified evading: all three. The gate closes the ACCIDENTAL routes
//           and raises the cost of the deliberate ones; it does not make direct
//           egress impossible, and nothing may claim it does.
//
// Run: node --test .github/scripts/strict-grep/__tests__/issue-1541-sms-provider-sole-send-path.tester.adversarial.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STRICT_GREP_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(STRICT_GREP_DIR, "../../..");
const GATE_REL = "issue-1541-sms-provider-sole-send-path.mjs";
const GATE_ABS = path.join(STRICT_GREP_DIR, GATE_REL);

const ADAPTER_REL =
  "supabase/functions/_shared/adapters/smsAdapter.ts";

// A minimal but REAL-shaped sanctioned tree: the adapter reaches both providers
// as template literals (which is how the production file actually writes them),
// and the two Verify exemptions reach verify.twilio.com.
const ADAPTER_SRC = [
  "const res = await fetch(",
  "  `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,",
  '  { method: "POST" },',
  ");",
  'const r2 = await fetch(`${baseUrl}/api/sms/send`, { method: "POST" });',
].join("\n");

const SEND_OTP_SRC =
  "const url = `https://verify.twilio.com/v2/Services/${sid}/Verifications`;";
const VERIFY_OTP_SRC =
  "const url = `https://verify.twilio.com/v2/Services/${sid}/VerificationCheck`;";

/** Files present in every synthetic tree so the anchor + match-count guards are satisfied. */
const SANCTIONED_TREE = {
  [ADAPTER_REL]: ADAPTER_SRC,
  "supabase/functions/send-otp/index.ts": SEND_OTP_SRC,
  "supabase/functions/verify-otp/index.ts": VERIFY_OTP_SRC,
};

/**
 * Build a throwaway repo root containing a copy of the real gate at the exact
 * relative path it expects (it resolves repoRoot as `../../..`), plus `files`.
 * Returns the temp root. Caller removes it.
 */
function buildTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "issue1541-gate-"));
  const gateDir = path.join(root, ".github", "scripts", "strict-grep");
  fs.mkdirSync(gateDir, { recursive: true });
  fs.copyFileSync(GATE_ABS, path.join(gateDir, GATE_REL));
  for (const [rel, src] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, src, "utf8");
  }
  return root;
}

/** Run the gate inside `root`. Returns {code, out}. */
function runGateIn(root, args = []) {
  const gate = path.join(root, ".github", "scripts", "strict-grep", GATE_REL);
  // Strip NODE_TEST_CONTEXT: a nested node process inheriting it emits TAP into
  // our own harness and masks the child's real result.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [gate, ...args], {
    encoding: "utf8",
    env,
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** Run the gate against a synthetic tree, then always clean up. */
function withTree(files, fn) {
  const root = buildTree(files);
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const violation = (files) =>
  withTree({ ...SANCTIONED_TREE, ...files }, (root) => runGateIn(root));

// ===========================================================================
// PROOF T-1 — FAILS-ON-REVERT ANCHOR. The gate over the REAL repository.
// ===========================================================================
// This is the only case bound to the actual tree, and it is what makes this
// file a regression test rather than a thought experiment: restore ANY of the
// four direct Twilio calls that #1541 removed (ticket-confirmation-dispatch,
// send-venue-sms, send-phone-invite, send-pair-request) and this goes red.
test("T-1 PROOF: the real tree passes, and the pass is NOT vacuous", () => {
  const { code, out } = runGateIn(REPO_ROOT);
  assert.equal(
    code,
    0,
    `the real tree must pass the sole-send-path gate; got exit ${code}:\n${out}`,
  );

  // Vacuity guard on our OWN assertion (#1529): a pass that observed nothing
  // proves nothing, so read the counts the gate prints and require them real.
  const scanned = /scanned (\d+) source files/.exec(out);
  const found = /found (\d+) sanctioned provider call sites/.exec(out);
  assert.ok(scanned, `gate did not report a scanned-file count:\n${out}`);
  assert.ok(found, `gate did not report a sanctioned match count:\n${out}`);
  assert.ok(
    Number(scanned[1]) > 100,
    `expected a real sweep of supabase/functions, saw ${scanned[1]} files`,
  );
  assert.ok(
    Number(found[1]) > 0,
    "a passing run reported ZERO sanctioned call sites — the gate is blind",
  );
  assert.match(out, /0 unsanctioned/);
});

// ===========================================================================
// PROOF T-2 — the gate is genuinely falsifiable on the shape it was built for.
// ===========================================================================
test("T-2 PROOF: a naive direct Twilio send is caught, in every quote class", () => {
  for (
    const [label, src] of [
      [
        "backtick",
        "await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`);",
      ],
      [
        "double",
        'await fetch("https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json");',
      ],
      [
        "single",
        "await fetch('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');",
      ],
      ["termii", 'await fetch("https://v3.api.termii.com/api/sms/send", init);'],
    ]
  ) {
    const { code, out } = violation({
      "supabase/functions/rogue/index.ts": src,
    });
    assert.equal(
      code,
      1,
      `a ${label}-quoted direct send must be caught; got exit ${code}:\n${out}`,
    );
    assert.match(out, /unsanctioned SMS-provider send endpoint/);
  }
});

// ===========================================================================
// PROOFS T-3 … T-7 — tester finding T-1541-GATE-EVASION (P2), NOW CLOSED.
// Converted from pins during #1541 IMPLEMENT REWORK. Shapes unchanged; only the
// expectation flipped, because the gate now catches every one of them.
// ===========================================================================
// The detector is a PER-LINE regex requiring an opening quote and BOTH the host
// and the path fragment on the SAME physical line:
//     /["'`][^\n]*api\.twilio\.com[^\n]*Messages\.json/
// Any code shape that puts the host and the path on different lines — which is
// ordinary, innocent refactoring, not sabotage — walks straight past it. The
// gate therefore enforces "nobody wrote the URL the way the four historical
// bypasses wrote it", which is strictly weaker than the invariant it is cited
// as enforcing ("no file may reach an SMS-provider message-send endpoint").
//
// FIX THAT CLOSES T-3/T-4/T-5: match against the comment-stripped WHOLE FILE
// (or a sliding join of N lines) instead of line-by-line, and add a
// host-only + path-only correlation rule; or assert that any `fetch(` in a
// non-allowlisted edge function cannot reach a provider constant.
// FIX THAT CLOSES T-6: add .mts/.cts/.jsx/.cjs to SCAN_EXT.
// FIX THAT CLOSES T-7: only treat a file as a test if it lives under a test
// directory, not merely because its NAME contains `.spec.`/`.test.`.

test("T-3 PROOF: a hoisted host constant is CAUGHT", () => {
  const { code } = violation({
    "supabase/functions/rogue/index.ts": [
      'const TWILIO_HOST = "api.twilio.com";',
      "const url = `https://${TWILIO_HOST}/2010-04-01/Accounts/${sid}/Messages.json`;",
      'await fetch(url, { method: "POST" });',
    ].join("\n"),
  });
  assert.equal(
    code,
    1,
    "REGRESSION: a hoisted host constant evades the gate again. The literal-space " +
      "correlation detector has been weakened or removed.",
  );
});

test("T-4 PROOF: a URL concatenated across two lines is CAUGHT", () => {
  const { code } = violation({
    "supabase/functions/rogue/index.ts": [
      'const url = "https://api.twilio.com/2010-04-01/Accounts/AC1" +',
      '  "/Messages.json";',
      'await fetch(url, { method: "POST" });',
    ].join("\n"),
  });
  assert.equal(
    code,
    1,
    "REGRESSION: multi-line concatenation evades the gate again.",
  );
});

test("T-5 PROOF: a fragment-assembled Termii path is CAUGHT", () => {
  const { code } = violation({
    "supabase/functions/rogue/index.ts": [
      'const SEND_PATH = "/api" + "/sms" + "/send";',
      "await fetch(`${termiiBase}${SEND_PATH}`, { method: \"POST\" });",
    ].join("\n"),
  });
  assert.equal(
    code,
    1,
    "REGRESSION: literal-fragment assembly evades the gate again. Note this " +
      "closes only fragments that ARE string literals; runtime assembly from " +
      "env/config/decoding remains out of reach of static analysis by design.",
  );
});

test("T-6 PROOF: .mts/.cts/.jsx are SCANNED", () => {
  // SCAN_EXT is {.ts,.tsx,.mjs,.js}. Deno resolves .mts/.cts too, and a plain
  // single-line call inside one is never even read.
  for (const ext of ["mts", "cts", "jsx"]) {
    const { code } = violation({
      [`supabase/functions/rogue/sender.${ext}`]:
        "await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`);",
    });
    assert.equal(
      code,
      1,
      `REGRESSION: .${ext} is no longer scanned — SCAN_EXT lost an extension, ` +
        "and a sender written in it would ship unguarded.",
    );
  }
});

test("T-7 PROOF: a `.spec.ts` name inside a live function dir is SCANNED", () => {
  // isTestFile() skips on the FILENAME, so a deployed module named like a test
  // is never scanned even though it ships inside the function bundle.
  const { code } = violation({
    "supabase/functions/rogue/sender.spec.ts":
      "export const send = () => fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`);",
  });
  assert.equal(
    code,
    1,
    "REGRESSION: test detection went back to matching on FILENAME, so a deployed " +
      "module named like a test is unguarded again. A naming convention is not " +
      "an access control.",
  );
});

// ===========================================================================
// PINS T-10 … T-11 — tester RETEST finding T-1541-GATE-EVASION-RESIDUAL (P2).
// ===========================================================================
// Found during the retest of the #1541 IMPLEMENT REWORK, AFTER T-3…T-7 were
// closed. These matter more than their size suggests, because the gate's own
// header now enumerates what it cannot catch — and enumerates it too narrowly.
// It says the blind spot is a URL that "never exists as text": runtime
// assembly from env/config/DB, base64/hex decoding, `String.fromCharCode`.
//
// In BOTH shapes below the URL exists ENTIRELY as static text. Neither is
// runtime-assembled, neither is transformed, and both are shapes an ordinary
// engineer produces without any intent to evade. So the disclosure is not
// merely incomplete — it points at the wrong category, which is the specific
// hazard the header warns about two paragraphs earlier: "a guard that claims
// completeness it lacks is the failure class catalogued in #1553."
//
// NOT A MERGE BLOCKER. The gate is strictly stronger than it was and far
// stronger than `main`; the real-time control is the adapter kill switch, not
// this gate. But the invariant text and the header must say THESE words.
//
// FIX FOR T-10: add the `i` flag to the ENDPOINTS regexes and lowercase the
//   literal space before correlating. DNS is case-insensitive, so
//   `API.Twilio.Com` resolves and bills identically — one character of gate.
// FIX FOR T-11: correlate host against path across the MODULE GRAPH (or, more
//   cheaply, treat a bare provider-host literal in any non-allowlisted file as
//   a violation on its own — no edge function has an innocent reason to name
//   `api.twilio.com` in code).

test("T-10 PIN: a mixed-case host evades the gate, fully as text (KNOWN GAP)", () => {
  // The ENDPOINTS regexes carry no `i` flag. This URL is 100% static text and
  // works: hostnames are case-insensitive.
  const inline = violation({
    "supabase/functions/rogue/index.ts":
      'await fetch("https://API.Twilio.Com/2010-04-01/Accounts/AC1/Messages.json", { method: "POST" });',
  });
  assert.equal(
    inline.code,
    0,
    "PIN BROKEN (good news): the endpoint match is now case-insensitive. " +
      "Delete this pin and close T-1541-GATE-EVASION-RESIDUAL.",
  );

  // Same root cause via a hoisted constant, which is what real code looks like.
  const hoisted = violation({
    "supabase/functions/rogue/index.ts": [
      'const H = "API.TWILIO.COM";',
      "await fetch(`https://${H}/2010-04-01/Accounts/AC1/Messages.json`, { method: \"POST\" });",
    ].join("\n"),
  });
  assert.equal(
    hoisted.code,
    0,
    "PIN BROKEN (good news): case-insensitive matching reached the literal space too.",
  );
});

test("T-11 PIN: host and path in DIFFERENT FILES evade the gate (KNOWN GAP)", () => {
  // `literalSpace` correlates host against path PER FILE. Split the two halves
  // across a constants module — the single most ordinary refactor there is —
  // and neither file correlates. Both halves are plain string literals.
  const { code } = violation({
    "supabase/functions/rogue/constants.ts":
      'export const TWILIO_HOST = "api.twilio.com";',
    "supabase/functions/rogue/index.ts": [
      'import { TWILIO_HOST } from "./constants.ts";',
      "await fetch(`https://${TWILIO_HOST}/2010-04-01/Accounts/AC1/Messages.json`, { method: \"POST\" });",
    ].join("\n"),
  });
  assert.equal(
    code,
    0,
    "PIN BROKEN (good news): correlation now spans files. Delete this pin.",
  );
});

// ===========================================================================
// PROOF T-8 — the vacuity guards CANNOT be defeated.
// ===========================================================================
// The dispatch asked directly: can the scan be made to match nothing and still
// pass? Answer: NO. Every route to an empty observation exits 2, and the
// match-count assertion is evaluated BEFORE any violation, so a blind sweep can
// never launder itself into "0 violations, clean".
test("T-8 PROOF: every route to an empty observation exits 2, not 0", () => {
  // (a) no source files at all under the scan root
  const empty = withTree({ "supabase/functions/.keep": "" }, (root) =>
    runGateIn(root));
  assert.equal(empty.code, 2, `zero-files must exit 2:\n${empty.out}`);
  assert.match(empty.out, /ZERO source files/);

  // (b) files exist, but no provider endpoint survives anywhere
  const blind = withTree({
    [ADAPTER_REL]: "export const smsAdapter = { async send() {} };",
    "supabase/functions/send-otp/index.ts": "export const x = 1;",
  }, (root) => runGateIn(root));
  assert.equal(blind.code, 2, `zero-matches must exit 2:\n${blind.out}`);
  assert.match(blind.out, /ZERO sanctioned SMS-provider send endpoints/);

  // (c) the anchor is dismantled: adapter keeps Termii, loses Twilio. Match
  //     count is NON-zero (verify still matches), so only the anchor can catch
  //     this — proving the two guards are independent, not one guard twice.
  const anchorless = withTree({
    [ADAPTER_REL]: 'await fetch(`${baseUrl}/api/sms/send`, { method: "POST" });',
    "supabase/functions/send-otp/index.ts": SEND_OTP_SRC,
    "supabase/functions/verify-otp/index.ts": VERIFY_OTP_SRC,
  }, (root) => runGateIn(root));
  assert.equal(anchorless.code, 2, `anchor loss must exit 2:\n${anchorless.out}`);
  assert.match(anchorless.out, /no longer contains/);

  // (d) a violation present AND the sweep blind → vacuity wins, and the run
  //     must NOT be reported as a mere violation (exit 1) or a pass (exit 0).
  const both = withTree({
    [ADAPTER_REL]: "export const smsAdapter = {};",
    "supabase/functions/rogue/index.ts":
      'await fetch("https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json");',
  }, (root) => runGateIn(root));
  assert.equal(
    both.code,
    2,
    `vacuity must be decided BEFORE violations; got exit ${both.code}:\n${both.out}`,
  );
});

// ===========================================================================
// PROOF T-9 — the escape hatch and the comment strip behave as documented.
// ===========================================================================
test("T-9 PROOF: allow-marker suppresses; a comment-only mention does not fire", () => {
  const marker = "orch-strict-grep-allow sms-provider-sole-send-path";

  const allowed = violation({
    "supabase/functions/legacy/index.ts":
      'await fetch("https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json"); // ' +
      marker,
  });
  assert.equal(allowed.code, 0, `allow-marker must suppress:\n${allowed.out}`);

  const commented = violation({
    "supabase/functions/docs/index.ts":
      '// we used to POST "https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json"\n' +
      "export const noop = true;\n",
  });
  assert.equal(
    commented.code,
    0,
    `a commented-out endpoint must not fire:\n${commented.out}`,
  );

  // …and the strip did not also eat the REAL literals: the sanctioned count
  // must be identical to the clean tree's. Without this, a comment strip that
  // devoured every string would look like a clean pass.
  const clean = withTree(SANCTIONED_TREE, (root) => runGateIn(root));
  const n = (s) => /found (\d+) sanctioned/.exec(s)?.[1];
  assert.ok(n(clean.out), "clean tree reported no count");
  assert.equal(
    n(commented.out),
    n(clean.out),
    "the comment strip changed the sanctioned match count — it is eating real literals",
  );
});
