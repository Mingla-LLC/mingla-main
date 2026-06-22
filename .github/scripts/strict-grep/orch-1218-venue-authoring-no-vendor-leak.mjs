#!/usr/bin/env node
/**
 * ORCH-1218 [venue-authoring vendor-error scrub] —
 * I-PROPOSED-1218-VENUE-AUTHORING-NO-VENDOR-LEAK.
 *
 * WHY: Seth's standing intent is that business users must NEVER learn which AI
 * technology powers Mingla (ORCH-1217 established this for the Ari co-pilot
 * copy; this is the second leak the 1217 tester found). The venue
 * auto-authoring pipeline can fail and rethrow a raw reason string that
 * contains our AI vendor's name (`gemini_failed:429:...`, etc.). That raw
 * string used to be rendered verbatim to the venue operator in
 * `VenueCreatorWizard`. The fix routes every pipeline catch through
 * `sanitizeAuthoringError`, which maps vendor-tagged reasons to generic
 * "Mingla's AI" copy while passing non-vendor reasons through unchanged. This
 * gate guarantees a vendor token can never reach a user-facing error string on
 * the venue-authoring path again, AND that the wizard never reverts to
 * rendering a raw pipeline `error.message`.
 *
 * Sibling to `orch-1217-ari-no-vendor-disclosure.mjs` (Ari surface). This gate
 * carries its OWN `stripComments` copy (does NOT import the 1217 gate — 1217
 * may not yet be on `origin/main`).
 *
 * RULES (all must hold; comments stripped before scanning so internal code
 * comments naming a vendor never false-trip):
 *   (a) No forbidden AI-vendor token in NON-COMMENT source of the sanitizer +
 *       wizard. The sanitizer's own FORBIDDEN regex-definition block is exempted
 *       via the `strict-grep-allow: vendor-token-list` sentinel comment.
 *   (b) Structural binding — VenueCreatorWizard.tsx imports + calls
 *       sanitizeAuthoringError >= 4 times, AND contains NO reverted raw
 *       `setMessage(error instanceof Error ? error.message ...)` /
 *       `setSubmitErr(e instanceof Error ? e.message ...)` pipeline shape.
 *   (c) Positive presence — sanitizeAuthoringError.ts contains "Mingla's AI".
 *
 * `--self-test` injects synthetic compliant / reverted source and asserts the
 * gate fires on a raw revert, on a vendor token in a string literal, and on a
 * missing "Mingla's AI" phrase; passes on the clean shape and on a comment-only
 * vendor mention.
 *
 * Model: orch-1211-notif-web-render-safe.mjs (stripComments copied verbatim from
 * the i-proposed-1213 gate's canonical helper).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const SANITIZER = "mingla-business/src/utils/sanitizeAuthoringError.ts";
const WIZARD =
  "mingla-business/src/components/venue/VenueCreatorWizard.tsx";

// Forbidden AI-vendor tokens (word-boundaried, case-insensitive). MUST mirror
// the sanitizer's FORBIDDEN list. "Google location" (geocoding) is NOT a vendor
// disclosure — the narrow `\bgoogle\s+ai\b` pattern won't match it, and no broad
// `\bgoogle\b` rule exists here.
const FORBIDDEN_VENDOR_TOKENS = [
  /\bgemini(?![a-z])/i,
  /\bopenai(?![a-z])/i,
  /\banthropic(?![a-z])/i,
  /\bclaude(?![a-z])/i,
  /\bgpt-/i,
  /\bgoogle\s+ai(?![a-z])/i,
  /\bvertex\s+ai(?![a-z])/i,
  /\bbard(?![a-z])/i,
  /\bllama(?![a-z])/i,
  /\bmistral(?![a-z])/i,
];

// Sentinel comment that exempts the sanitizer's vendor-token-list definition
// block (the regex literals legitimately spell the tokens to scrub them).
const ALLOW_SENTINEL = "strict-grep-allow: vendor-token-list";

/**
 * Strip line + block comments so a vendor token mentioned in a comment (e.g. the
 * protective ORCH-1218 comment, or this gate's own JSDoc when swept) is not
 * matched. Preserve newlines so line numbers stay accurate.
 *
 * Copied verbatim from the canonical i-proposed-1213 gate helper (not imported —
 * the ORCH-1217 sibling may not yet be on main).
 */
function stripComments(src) {
  let out = "";
  let i = 0;
  let mode = "code"; // code | line | block | str | tmpl
  let quote = "";
  while (i < src.length) {
    const c = src[i];
    const c2 = src[i + 1];
    if (mode === "code") {
      if (c === "/" && c2 === "/") {
        mode = "line";
        i += 2;
        continue;
      }
      if (c === "/" && c2 === "*") {
        mode = "block";
        out += "  ";
        i += 2;
        continue;
      }
      if (c === '"' || c === "'") {
        mode = "str";
        quote = c;
        out += c;
        i += 1;
        continue;
      }
      if (c === "`") {
        mode = "tmpl";
        out += c;
        i += 1;
        continue;
      }
      out += c;
      i += 1;
      continue;
    }
    if (mode === "line") {
      if (c === "\n") {
        mode = "code";
        out += "\n";
      }
      i += 1;
      continue;
    }
    if (mode === "block") {
      if (c === "*" && c2 === "/") {
        mode = "code";
        out += "  ";
        i += 2;
        continue;
      }
      out += c === "\n" ? "\n" : " ";
      i += 1;
      continue;
    }
    if (mode === "str") {
      out += c;
      if (c === "\\") {
        out += c2 ?? "";
        i += 2;
        continue;
      }
      if (c === quote) mode = "code";
      i += 1;
      continue;
    }
    if (mode === "tmpl") {
      out += c;
      if (c === "\\") {
        out += c2 ?? "";
        i += 2;
        continue;
      }
      if (c === "`") mode = "code";
      i += 1;
      continue;
    }
  }
  return out;
}

/**
 * Drop any line carrying the allow-sentinel AND the block of regex-literal lines
 * that immediately follow it (until the closing `];` of the array). This exempts
 * the sanitizer's vendor-token-list from rule (a) — those literals legitimately
 * spell the vendor names to scrub them.
 */
function dropVendorTokenListBlock(src) {
  const lines = src.split("\n");
  const out = [];
  let skipping = false;
  for (const line of lines) {
    if (line.includes(ALLOW_SENTINEL)) {
      skipping = true;
      out.push(""); // preserve line count
      continue;
    }
    if (skipping) {
      out.push("");
      // End the exemption at the array close `];`.
      if (/\]\s*;/.test(line)) {
        skipping = false;
      }
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

function readTarget(rel, failures) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    failures.push(
      `${rel}: target not found (gate path out of sync with source).`,
    );
    return null;
  }
  return fs.readFileSync(abs, "utf8");
}

// Rule (a): no forbidden vendor token in non-comment source (sanitizer block
// exempted via sentinel).
function checkNoVendorToken(rel, src, failures) {
  const clean = stripComments(dropVendorTokenListBlock(src));
  for (const re of FORBIDDEN_VENDOR_TOKENS) {
    if (re.test(clean)) {
      failures.push(
        `${rel}: forbidden AI-vendor token matching ${re} appears in ` +
          `non-comment source. Users must never learn the AI vendor (ORCH-1218). ` +
          `Use the generic "Mingla's AI" copy instead.`,
      );
    }
  }
}

// Rule (b): wizard structural binding.
function checkWizardBinding(src, failures) {
  const clean = stripComments(src);

  // imports the sanitizer
  if (!/import\s*\{\s*sanitizeAuthoringError\s*\}/.test(clean)) {
    failures.push(
      `${WIZARD}: missing import of sanitizeAuthoringError — every venue-authoring ` +
        `pipeline catch must route through the sanitizer (ORCH-1218).`,
    );
  }

  // calls it at least 4 times (handleRunAi, handleConfirm, handleRefresh,
  // handleSubmit are the 4 mandatory; handleCoverChange is the 5th).
  const callCount = (clean.match(/sanitizeAuthoringError\s*\(/g) || []).length;
  if (callCount < 4) {
    failures.push(
      `${WIZARD}: sanitizeAuthoringError() is called ${callCount} time(s) — ` +
        `expected >= 4 (handleRunAi, handleConfirm, handleRefresh, handleSubmit). ` +
        `A missing call means a pipeline error path renders a raw reason (ORCH-1218).`,
    );
  }

  // FAIL-on-revert: the raw pipeline shapes must NOT reappear.
  const revertedMessage = /setMessage\(\s*error instanceof Error \? error\.message/;
  const revertedSubmit = /setSubmitErr\(\s*e instanceof Error \? e\.message/;
  if (revertedMessage.test(clean)) {
    failures.push(
      `${WIZARD}: reverted raw pipeline shape ` +
        `\`setMessage(error instanceof Error ? error.message ...)\` is present — ` +
        `it re-introduces the raw vendor-code leak. Route through ` +
        `sanitizeAuthoringError(error, <fallback>) (ORCH-1218).`,
    );
  }
  if (revertedSubmit.test(clean)) {
    failures.push(
      `${WIZARD}: reverted raw pipeline shape ` +
        `\`setSubmitErr(e instanceof Error ? e.message ...)\` is present — ` +
        `it re-introduces the raw vendor-code leak. Route through ` +
        `sanitizeAuthoringError(e, <fallback>) (ORCH-1218).`,
    );
  }
}

// Rule (c): positive presence of approved copy in the sanitizer.
function checkPositivePresence(src, failures) {
  if (!src.includes("Mingla's AI")) {
    failures.push(
      `${SANITIZER}: missing the approved phrase "Mingla's AI" — a future edit ` +
        `that deletes the mapping (not just swaps a token) must also be caught ` +
        `(ORCH-1218).`,
    );
  }
}

function checkAll(sanitizerSrc, wizardSrc, failures) {
  checkNoVendorToken(SANITIZER, sanitizerSrc, failures);
  checkNoVendorToken(WIZARD, wizardSrc, failures);
  checkWizardBinding(wizardSrc, failures);
  checkPositivePresence(sanitizerSrc, failures);
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const run = (sanitizerSrc, wizardSrc) => {
    const f = [];
    checkAll(sanitizerSrc, wizardSrc, f);
    return f;
  };

  // A clean, compliant sanitizer (vendor tokens only inside the sentinel-exempt
  // block; approved phrase present).
  const goodSanitizer =
    `const GENERIC = "Mingla's AI couldn't finish. Please try again.";\n` +
    `// strict-grep-allow: vendor-token-list\n` +
    `const FORBIDDEN = [\n` +
    `  /\\bgemini(?![a-z])/i,\n` +
    `  /\\bopenai(?![a-z])/i,\n` +
    `];\n` +
    `// strict-grep-allow: vendor-token-list\n` +
    `const TABLE = [\n` +
    `  ["gemini_failed:429", "Mingla's AI is busy."],\n` +
    `  ["gemini_empty", GENERIC],\n` +
    `];\n` +
    `export function sanitizeAuthoringError(err, fallback) {\n` +
    `  const raw = err instanceof Error ? err.message : "";\n` +
    `  for (const [p, m] of TABLE) if (raw.startsWith(p)) return m;\n` +
    `  return raw || fallback;\n` +
    `}\n`;

  // A clean, compliant wizard: imports + 5 sanitizer calls, no reverted shapes.
  const goodWizard =
    `import { sanitizeAuthoringError } from "../../utils/sanitizeAuthoringError";\n` +
    `setSubmitErr(sanitizeAuthoringError(e, "Could not submit. Try again."));\n` +
    `setMessage(sanitizeAuthoringError(error, "Cover saved, did not sync yet."));\n` +
    `setMessage(sanitizeAuthoringError(error, "AI setup failed."));\n` +
    `setMessage(sanitizeAuthoringError(error, "Could not confirm AI outputs."));\n` +
    `setMessage(sanitizeAuthoringError(error, "Could not refresh deck readiness."));\n` +
    `if (e instanceof Error && e.message.includes("Google location")) {\n` +
    `  setSubmitErr(e.message);\n` +
    `}\n`;

  // (1) Reverted wizard catch → MUST fail rule (b).
  const revertedWizard =
    `import { sanitizeAuthoringError } from "../../utils/sanitizeAuthoringError";\n` +
    `setMessage(error instanceof Error ? error.message : "AI setup failed.");\n` +
    `setMessage(sanitizeAuthoringError(error, "Could not confirm AI outputs."));\n` +
    `setMessage(sanitizeAuthoringError(error, "Could not refresh deck readiness."));\n` +
    `setSubmitErr(sanitizeAuthoringError(e, "Could not submit. Try again."));\n` +
    `setMessage(sanitizeAuthoringError(error, "Cover saved, did not sync yet."));\n`;
  if (run(goodSanitizer, revertedWizard).length === 0) {
    selfFailures.push("(1) reverted raw setMessage(error.message) not flagged");
  }

  // (2) Clean tree → MUST pass.
  if (run(goodSanitizer, goodWizard).length !== 0) {
    selfFailures.push(
      "(2) clean compliant fixture wrongly flagged: " +
        JSON.stringify(run(goodSanitizer, goodWizard)),
    );
  }

  // (3) Vendor token in a STRING literal of the sanitizer (outside the
  // sentinel block) → MUST fail rule (a).
  const leakySanitizer =
    `const GENERIC = "Powered by Gemini — try again.";\n` +
    `export function sanitizeAuthoringError(err, fallback) { return GENERIC; }\n`;
  if (run(leakySanitizer, goodWizard).length === 0) {
    selfFailures.push("(3) vendor token in a string literal not flagged");
  }

  // (4) Vendor token ONLY in a comment → MUST pass (comments stripped).
  const commentVendorSanitizer =
    `// historical: this used to leak the raw Gemini code to the user\n` +
    `const GENERIC = "Mingla's AI couldn't finish. Please try again.";\n` +
    `// strict-grep-allow: vendor-token-list\n` +
    `const FORBIDDEN = [\n  /\\bgemini\\b/i,\n];\n` +
    `export function sanitizeAuthoringError(err, fallback) { return GENERIC; }\n`;
  if (run(commentVendorSanitizer, goodWizard).length !== 0) {
    selfFailures.push("(4) vendor token only in a comment wrongly flagged");
  }

  // (5) Sanitizer missing "Mingla's AI" → MUST fail rule (c).
  const noPhraseSanitizer =
    `const GENERIC = "Our AI couldn't finish. Please try again.";\n` +
    `// strict-grep-allow: vendor-token-list\n` +
    `const FORBIDDEN = [\n  /\\bgemini\\b/i,\n];\n` +
    `export function sanitizeAuthoringError(err, fallback) { return GENERIC; }\n`;
  if (run(noPhraseSanitizer, goodWizard).length === 0) {
    selfFailures.push("(5) missing 'Mingla\\'s AI' phrase not flagged");
  }

  // (6) Reverted setSubmitErr shape → MUST fail rule (b).
  const revertedSubmitWizard =
    `import { sanitizeAuthoringError } from "../../utils/sanitizeAuthoringError";\n` +
    `setSubmitErr(e instanceof Error ? e.message : "Could not submit. Try again.");\n` +
    `setMessage(sanitizeAuthoringError(error, "AI setup failed."));\n` +
    `setMessage(sanitizeAuthoringError(error, "Could not confirm AI outputs."));\n` +
    `setMessage(sanitizeAuthoringError(error, "Could not refresh deck readiness."));\n` +
    `setMessage(sanitizeAuthoringError(error, "Cover saved, did not sync yet."));\n`;
  if (run(goodSanitizer, revertedSubmitWizard).length === 0) {
    selfFailures.push("(6) reverted raw setSubmitErr(e.message) not flagged");
  }

  // (7) Missing import / too few calls → MUST fail rule (b).
  const underWiredWizard =
    `setMessage(sanitizeAuthoringError(error, "AI setup failed."));\n` +
    `setMessage(sanitizeAuthoringError(error, "Could not confirm AI outputs."));\n`;
  if (run(goodSanitizer, underWiredWizard).length === 0) {
    selfFailures.push("(7) missing import + too-few-calls not flagged");
  }

  // ---- ORCH-1218 TESTER adversarial additions (different angle than the
  // implementor's revert-shape proof). These attack vectors the implementor's
  // 7 cases did NOT cover: a vendor token leaking via a fully-wired WIZARD
  // string literal (rule (a) on the wizard, not the reverted-shape (b)); a
  // vendor token escaping the sanitizer's sentinel-exempt block AFTER the array
  // closes (proving dropVendorTokenListBlock does not over-exempt the rest of
  // the file); a two-word vendor token in a wizard literal; and a partial
  // revert that coexists with >=4 compliant calls (proving the fail-on-revert
  // is not bypassed by call count alone).

  // (8) ADVERSARIAL — vendor token in a WIZARD string literal even though the
  // wizard is otherwise fully wired (4+ sanitizer calls, import present, no
  // reverted shape). Rule (a) on the wizard MUST fire — a different leak vector
  // than the reverted-shape (b) the implementor proved.
  const leakyButWiredWizard =
    goodWizard +
    `setMessage("Our Gemini step failed — try again.");\n`;
  if (run(goodSanitizer, leakyButWiredWizard).length === 0) {
    selfFailures.push(
      "(8) vendor token in a fully-wired wizard string literal not flagged",
    );
  }

  // (9) ADVERSARIAL — sentinel must NOT over-exempt. A sanitizer that closes its
  // vendor-token-list array, then leaks a vendor token in a REAL (non-comment)
  // string literal afterward, MUST fail rule (a).
  const sentinelEscapeSanitizer =
    `const GENERIC = "Mingla's AI couldn't finish. Please try again.";\n` +
    `// strict-grep-allow: vendor-token-list\n` +
    `const FORBIDDEN = [\n  /\\bgemini(?![a-z])/i,\n];\n` +
    `const LEAK = "powered by OpenAI";\n` + // outside the exempt block → must trip
    `export function sanitizeAuthoringError(err, fallback) { return GENERIC; }\n`;
  if (run(sentinelEscapeSanitizer, goodWizard).length === 0) {
    selfFailures.push(
      "(9) vendor token AFTER the sentinel array close was over-exempted (not flagged)",
    );
  }

  // (10) ADVERSARIAL — a two-word vendor token ("Vertex AI") in a wizard string
  // literal MUST be caught (multi-word \bvertex\s+ai pattern), not just the
  // single-word tokens.
  const twoWordLeakWizard =
    goodWizard + `setMessage("Vertex AI is unavailable.");\n`;
  if (run(goodSanitizer, twoWordLeakWizard).length === 0) {
    selfFailures.push("(10) two-word vendor token 'Vertex AI' not flagged");
  }

  // (11) ADVERSARIAL — a partial revert that COEXISTS with >=4 compliant
  // sanitizer calls MUST still fail rule (b). Proves the fail-on-revert is not
  // bypassed by simply having enough other compliant calls present.
  const partialRevertWizard =
    goodWizard +
    `setMessage(error instanceof Error ? error.message : "AI setup failed.");\n`;
  if (run(goodSanitizer, partialRevertWizard).length === 0) {
    selfFailures.push(
      "(11) partial raw revert coexisting with >=4 compliant calls not flagged",
    );
  }

  if (selfFailures.length) {
    console.error(
      "ORCH-1218 I-PROPOSED-1218-VENUE-AUTHORING-NO-VENDOR-LEAK self-test FAIL:",
    );
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "ORCH-1218 I-PROPOSED-1218-VENUE-AUTHORING-NO-VENDOR-LEAK self-test PASS (11/11 cases; +4 tester adversarial).",
  );
  process.exit(0);
}

// ---- Live mode
const failures = [];
const sanitizerSrc = readTarget(SANITIZER, failures);
const wizardSrc = readTarget(WIZARD, failures);
if (sanitizerSrc !== null && wizardSrc !== null) {
  checkAll(sanitizerSrc, wizardSrc, failures);
}

if (failures.length > 0) {
  console.error(
    "ORCH-1218 I-PROPOSED-1218-VENUE-AUTHORING-NO-VENDOR-LEAK FAIL — an AI-vendor\n" +
      "token can reach a venue-authoring user-facing error string, or a wizard catch\n" +
      "reverted to rendering a raw pipeline error.message. Users must never learn the\n" +
      "AI vendor (ORCH-1218; sibling to ORCH-1217).\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1218 I-PROPOSED-1218-VENUE-AUTHORING-NO-VENDOR-LEAK PASS — no vendor token in\n" +
    "the sanitizer/wizard source; VenueCreatorWizard routes every pipeline catch\n" +
    "through sanitizeAuthoringError; approved 'Mingla's AI' copy present.",
);
