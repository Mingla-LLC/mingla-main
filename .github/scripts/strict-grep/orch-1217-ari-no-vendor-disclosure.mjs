#!/usr/bin/env node
/**
 * ORCH-1217 [Scrub AI-vendor disclosure from user-facing Ari copy] —
 * I-PROPOSED-1217-ARI-NO-VENDOR-DISCLOSURE.
 *
 * WHY: The business-app Ari co-pilot disclosure copy named the underlying AI
 * vendor ("Google Gemini") to end users in two surfaces:
 *   - AriSettingsScreen.tsx  About section: "Ari uses Google Gemini. …"
 *   - AiDisclosureModal.tsx   intro:        "…powered by Google Gemini. …"
 * Seth-approved framing is first-party — "Mingla's AI" — and the vendor name
 * must never reappear in any user-facing Ari surface.
 *
 * RULE (both must hold across the Ari copy surfaces):
 *   (a) NO forbidden AI-vendor token (case-insensitive, word-boundaried) may
 *       appear in NON-COMMENT (user-facing) source under the two Ari dirs:
 *         mingla-business/src/screens/ari/
 *         mingla-business/src/components/ari/
 *       Forbidden: Gemini, OpenAI, Anthropic, Claude, GPT-, Google AI,
 *       Vertex AI, Bard, Llama, Mistral.
 *       Comments (// … and /* … *\/ and JSDoc) are STRIPPED before scanning so
 *       legitimate internal code comments (e.g. "Gemini re-proposes …") never
 *       false-trip; the scope is the Ari dirs ONLY so unrelated code elsewhere
 *       is never swept.
 *   (b) The approved copy "Mingla's AI" MUST be present in BOTH
 *       AriSettingsScreen.tsx AND AiDisclosureModal.tsx — so a future edit that
 *       DELETES the disclosure line (not just swaps the vendor) is also caught.
 *
 * `--self-test` runs the forbidden-token check against an inline fixture
 * containing "Google Gemini" (must FAIL) and a clean fixture (must PASS), plus
 * a comment-only fixture (must PASS — comments stripped) and the positive
 * "Mingla's AI" assertion both ways.
 *
 * Model: orch-1211-notif-web-render-safe.mjs (stripComments reused verbatim).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

// User-facing Ari copy surfaces. Scope is these two dirs ONLY.
const ARI_DIRS = [
  "mingla-business/src/screens/ari",
  "mingla-business/src/components/ari",
];

// The two files that must POSITIVELY carry the approved "Mingla's AI" copy.
const APPROVED_COPY = "Mingla's AI";
const APPROVED_COPY_FILES = [
  "mingla-business/src/screens/ari/AriSettingsScreen.tsx",
  "mingla-business/src/components/ari/AiDisclosureModal.tsx",
];

// Forbidden AI-vendor tokens. Word-boundaried + case-insensitive. "GPT-" and
// the multi-word ones are matched literally; the rest carry \b boundaries so we
// never hit substrings (e.g. "claimant" must not match "claim…", "llama" must
// be the standalone word, etc.).
const FORBIDDEN = [
  { label: "Gemini", re: /\bgemini\b/i },
  { label: "OpenAI", re: /\bopenai\b/i },
  { label: "Anthropic", re: /\banthropic\b/i },
  { label: "Claude", re: /\bclaude\b/i },
  { label: "GPT-", re: /\bgpt-/i },
  { label: "Google AI", re: /\bgoogle\s+ai\b/i },
  { label: "Vertex AI", re: /\bvertex\s+ai\b/i },
  { label: "Bard", re: /\bbard\b/i },
  { label: "Llama", re: /\bllama\b/i },
  { label: "Mistral", re: /\bmistral\b/i },
];

const SCAN_EXT = new Set([".ts", ".tsx"]);

/**
 * Strip line comments + block comments so a vendor name mentioned only in an
 * internal code comment (e.g. "Gemini re-proposes with the resolved target") is
 * not flagged — only USER-FACING source text counts. Newlines are preserved so
 * line numbers stay accurate. (Reused verbatim from orch-1211-notif-web-render-safe.mjs.)
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
 * Scan one source string for forbidden vendor tokens in non-comment text.
 * Pushes a failure per offending line into `failures`, prefixed with `label`.
 */
function checkForbidden(src, label, failures) {
  const clean = stripComments(src);
  const lines = clean.split("\n");
  for (let n = 0; n < lines.length; n++) {
    for (const tok of FORBIDDEN) {
      if (tok.re.test(lines[n])) {
        failures.push(
          `${label}:${n + 1}: forbidden AI-vendor token "${tok.label}" in ` +
            `user-facing Ari copy — "${lines[n].trim().slice(0, 100)}". Use the ` +
            `Seth-approved first-party framing "Mingla's AI" (ORCH-1217).`,
        );
      }
    }
  }
}

/** Recursively list .ts/.tsx files under a dir (skips __tests__ and node_modules). */
function listSourceFiles(absDir) {
  const out = [];
  if (!fs.existsSync(absDir)) return out;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__") continue;
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(abs));
    } else if (SCAN_EXT.has(path.extname(entry.name))) {
      out.push(abs);
    }
  }
  return out;
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];

  const runForbidden = (src, label = "fixture") => {
    const f = [];
    checkForbidden(src, label, f);
    return f;
  };

  // (a) Dirty fixture with "Google Gemini" in JSX text → MUST fire.
  const dirty = `<Text>Ari is powered by Google Gemini. Enjoy.</Text>\n`;
  if (runForbidden(dirty).length === 0) {
    selfFailures.push('dirty fixture containing "Google Gemini" was NOT flagged');
  }

  // (b) Clean fixture with the approved copy → MUST pass.
  const clean = `<Text>Ari is powered by Mingla's AI. Enjoy.</Text>\n`;
  if (runForbidden(clean).length !== 0) {
    selfFailures.push("clean approved-copy fixture was wrongly flagged");
  }

  // (c) Vendor name ONLY in a code comment → MUST pass (comments stripped).
  const commentOnly = `// Gemini re-proposes with the resolved target.\nconst x = 1;\n`;
  if (runForbidden(commentOnly).length !== 0) {
    selfFailures.push("vendor name in a code comment was wrongly flagged");
  }

  // (d) Block-comment / JSDoc vendor mention → MUST pass.
  const blockComment = `/**\n * Q2 (resolved): a chip tap sends its label — Gemini handles it.\n */\nconst y = 2;\n`;
  if (runForbidden(blockComment).length !== 0) {
    selfFailures.push("vendor name in a block comment was wrongly flagged");
  }

  // (e) Other forbidden vendors in user-facing text → MUST fire.
  const otherVendors = `<Text>Powered by OpenAI GPT-4 and Claude and Anthropic.</Text>\n`;
  if (runForbidden(otherVendors).length === 0) {
    selfFailures.push("other forbidden vendor tokens (OpenAI/GPT-/Claude) were NOT flagged");
  }

  // (f) Positive assertion: a fixture WITHOUT "Mingla's AI" → must be detectable.
  const missingApproved = `<Text>Ari helps you.</Text>\n`;
  if (missingApproved.includes(APPROVED_COPY)) {
    selfFailures.push(`positive-assertion fixture wrongly reported "${APPROVED_COPY}" present`);
  }
  const hasApproved = `<Text>Ari is powered by Mingla's AI.</Text>\n`;
  if (!hasApproved.includes(APPROVED_COPY)) {
    selfFailures.push(`positive-assertion fixture failed to detect present "${APPROVED_COPY}"`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TESTER ADVERSARIAL CASES (ORCH-1217 QA, append-only — do NOT modify (a)–(f)).
  // The implementor's cases (a)–(f) exercise checkForbidden() on INLINE strings
  // only. These cases attack a DIFFERENT angle: the END-TO-END live directory
  // scan (listSourceFiles → checkForbidden) that a real leak in a NOT-explicitly-
  // named file in the scoped Ari dir would actually hit, plus case/spacing
  // variations the inline cases never cover. Mirrors tester probes 1/2a/2b.
  // ─────────────────────────────────────────────────────────────────────────

  // (g) Live directory-scan path: a vendor leak in a THIRD, NOT-NAMED file placed
  //     inside a scoped Ari dir MUST be caught by the recursive scan — proving the
  //     gate guards the WHOLE dir, not just AriSettingsScreen + AiDisclosureModal.
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch1217-arigate-"));
    try {
      const leakFile = path.join(tmpDir, "AriHelpScreen.tsx");
      fs.writeFileSync(
        leakFile,
        `import { Text } from "react-native";\nexport const AriHelp = () => <Text>Ari is powered by Gemini. Need help?</Text>;\n`,
      );
      const cleanFile = path.join(tmpDir, "AriOk.tsx");
      fs.writeFileSync(
        cleanFile,
        `import { Text } from "react-native";\nexport const AriOk = () => <Text>Ari is powered by Mingla's AI.</Text>;\n`,
      );
      const dirFailures = [];
      for (const abs of listSourceFiles(tmpDir)) {
        checkForbidden(fs.readFileSync(abs, "utf8"), abs, dirFailures);
      }
      const caughtLeak = dirFailures.some((m) => m.includes("AriHelpScreen.tsx"));
      const flaggedClean = dirFailures.some((m) => m.includes("AriOk.tsx"));
      if (!caughtLeak) {
        selfFailures.push(
          "live directory scan did NOT catch a vendor leak in a THIRD, not-explicitly-named Ari-dir file (AriHelpScreen.tsx)",
        );
      }
      if (flaggedClean) {
        selfFailures.push(
          "live directory scan wrongly flagged a clean third Ari-dir file (AriOk.tsx)",
        );
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // (h) Case variation: lowercase "gemini" in user-facing text → MUST fire
  //     (case-insensitive). Implementor cases only used the canonical-cased form.
  const lowerCase = `<Text>Ari is powered by gemini.</Text>\n`;
  if (runForbidden(lowerCase).length === 0) {
    selfFailures.push('lowercase "gemini" in user-facing text was NOT flagged (case-insensitivity broken)');
  }

  // (i) Spacing variation: double-spaced "Google  Gemini" → MUST fire (the \b on
  //     /\bgemini\b/ still matches regardless of leading whitespace count).
  const doubleSpace = `<Text>Ari is powered by Google  Gemini.</Text>\n`;
  if (runForbidden(doubleSpace).length === 0) {
    selfFailures.push('double-spaced "Google  Gemini" in user-facing text was NOT flagged');
  }

  // (j) Comment-strip must NOT create a false negative: a vendor token inside a
  //     STRING LITERAL whose content begins with "//" is still CODE (user-facing)
  //     and MUST fire — the stripper only removes real comments, not string bodies.
  const stringLooksLikeComment = `const x = "// powered by Gemini";\n`;
  if (runForbidden(stringLooksLikeComment).length === 0) {
    selfFailures.push('vendor token in a string literal beginning with "//" was wrongly stripped as a comment');
  }

  if (selfFailures.length) {
    console.error("ORCH-1217 I-PROPOSED-1217-ARI-NO-VENDOR-DISCLOSURE self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "ORCH-1217 I-PROPOSED-1217-ARI-NO-VENDOR-DISCLOSURE self-test PASS " +
      "(6 implementor cases + 4 tester adversarial cases g–j = 10/10).",
  );
  process.exit(0);
}

// ---- Live mode
const failures = [];

// (a) Forbidden-token scan across the Ari dirs (non-comment source only).
for (const dir of ARI_DIRS) {
  const absDir = path.join(root, dir);
  if (!fs.existsSync(absDir)) {
    failures.push(
      `${dir}: Ari copy dir not found (gate path out of sync with source).`,
    );
    continue;
  }
  for (const abs of listSourceFiles(absDir)) {
    const rel = path.relative(root, abs);
    checkForbidden(fs.readFileSync(abs, "utf8"), rel, failures);
  }
}

// (b) Positive assertion — approved copy present in BOTH named files.
for (const rel of APPROVED_COPY_FILES) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    failures.push(`${rel}: file not found (gate path out of sync with source).`);
    continue;
  }
  const src = fs.readFileSync(abs, "utf8");
  if (!src.includes(APPROVED_COPY)) {
    failures.push(
      `${rel}: approved first-party copy "${APPROVED_COPY}" is MISSING — the Ari ` +
        `disclosure line must state Ari is powered by "Mingla's AI" (ORCH-1217). ` +
        `Do not delete or reword away the disclosure.`,
    );
  }
}

if (failures.length > 0) {
  console.error(
    "ORCH-1217 I-PROPOSED-1217-ARI-NO-VENDOR-DISCLOSURE FAIL — the Ari co-pilot copy\n" +
      "regressed: an AI-vendor name leaked into user-facing copy, or the approved\n" +
      '"Mingla\'s AI" framing went missing. Replace any vendor name with "Mingla\'s AI".\n\nFailures:\n  ' +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1217 I-PROPOSED-1217-ARI-NO-VENDOR-DISCLOSURE PASS — no AI-vendor name in\n" +
    'user-facing Ari copy; "Mingla\'s AI" present in both AriSettingsScreen + AiDisclosureModal.',
);
