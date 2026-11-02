#!/usr/bin/env node
// Issue #4238 — Host ad screens and Ari's ad tool messages use plain words.
//
// MINGLA-INVARIANT: I-PROPOSED-HOST-AD-PLAIN-LANGUAGE | issue #4238 | Host-visible ad text (Business ad screens, their helpers and Ari ad tool messages) never uses Mingla's internal words (provider, lane, immutable, hash, snapshot, widening, creative, delivery, ...) and never shows the plan hash; identifiers, testIDs and comments may.
//
// WHY A GATE. The structural half of this rule (no banned word in any copy a
// screen file renders inline; the plan hash is never put on screen; the typed
// LAUNCH / CANCEL PLAN / END confirmations stay) can only be checked by
// reading source. It used to live in a Jest file as a readFileSync pin, which
// I-PROPOSED-1047-BIZ-NO-SOLE-SOURCE-PIN forbids. The behavioural half (what
// the copy helpers actually return) is tested by
// mingla-business/src/components/marketing/ads/__tests__/issue_4238_host_ad_plain_language.implementor.test.ts.
//
// WHAT IS CHECKED. Files are PARSED with the TypeScript compiler API. Only
// text a Host can see is scanned: JSX text, and string / template literals
// that read like sentences (contain a space) or one-word labels ("Creative").
// Identifiers, testIDs, styles, import paths, comments, comparisons, object
// keys and console arguments are never scanned. For Ari, only ToolError
// messages and the plain-text properties of tool results are scanned.
//
// ONE OWNER FOR THE WORD LIST. The banned words are read from
// HOST_AD_BANNED_WORDS in mingla-business/src/components/marketing/ads/hostAdCopy.ts
// (the same list the app's hostAdCopyIsPlain() uses). Fewer than 20 parsed
// patterns is a failure, so an emptied list cannot pass.
//
// FAILS CLOSED. A missing file, a missing anchor region, or an unparseable
// word list is a failure (exit 1). TypeScript not installed is exit 2.
//
// Usage:
//   node .github/scripts/strict-grep/issue-4238-host-ad-plain-language.mjs
//   node .github/scripts/strict-grep/issue-4238-host-ad-plain-language.mjs --self-test

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const TAG = "I-PROPOSED-HOST-AD-PLAIN-LANGUAGE";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const APP_ROOT = path.join(REPO_ROOT, "mingla-business");
const WORDS_FILE = "src/components/marketing/ads/hostAdCopy.ts";

// Paths relative to mingla-business/.
const HOST_AD_FILES = [
  "app/(tabs)/marketing/ads/create.tsx",
  "app/(tabs)/marketing/ads/[id].tsx",
  "app/(tabs)/marketing/ads/index.tsx",
  "src/components/marketing/ads/HostAdPagePicker.tsx",
  "src/components/marketing/ads/HostAdCountryPicker.tsx",
  "src/components/marketing/ads/hostAdCopy.ts",
  "src/components/marketing/ads/hostAdCountries.ts",
  "src/components/marketing/ads/hostAdGoal.ts",
  "src/components/marketing/ads/hostAdPageLabels.ts",
  "src/components/marketing/ads/hostAdSetupCopy.ts",
  "src/components/marketing/AdCreditLedgerRow.tsx",
  "src/components/marketing/AdCreditQuoteSheet.tsx",
  "src/services/hostAdPlanService.ts",
  "src/services/hostAdCampaignService.ts",
  "src/services/hostAdLifecycle.ts",
  "src/services/adCreditService.ts",
  "src/utils/adVideoFit.ts",
  "src/utils/homeAdLifecycle.ts",
];

const SKIP_ATTRIBUTES = new Set([
  "testID",
  "key",
  "style",
  "contentStyle",
  "nativeID",
  "accessibilityRole",
  "variant",
  "illustration",
  "leadingIcon",
  "mediaMode",
  "href",
]);

const ARI_MESSAGE_PROPERTIES = new Set(["next_step", "message", "note", "notice", "summary", "warning"]);

function loadTypeScript() {
  for (const base of [path.join(REPO_ROOT, "package.json"), path.join(APP_ROOT, "package.json")]) {
    try {
      return createRequire(base)("typescript");
    } catch {
      // try the next location
    }
  }
  return null;
}

const ts = loadTypeScript();
if (!ts) {
  console.error(`INCONCLUSIVE [${TAG}]: typescript is not installed (class B gate).`);
  process.exit(2);
}

/** Reads HOST_AD_BANNED_WORDS out of hostAdCopy.ts as real RegExp objects. */
function loadBannedWords(source) {
  const file = ts.createSourceFile("hostAdCopy.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let patterns = null;
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText() === "HOST_AD_BANNED_WORDS" &&
      node.initializer &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      patterns = node.initializer.elements
        .filter((el) => el.kind === ts.SyntaxKind.RegularExpressionLiteral)
        .map((el) => {
          const text = el.getText();
          const end = text.lastIndexOf("/");
          return new RegExp(text.slice(1, end), text.slice(end + 1));
        });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return patterns ?? [];
}

function isCopy(text) {
  const trimmed = text.trim();
  return /[A-Za-z]/.test(trimmed) && (/\s/.test(trimmed) || /^[A-Z][a-z]+$/.test(trimmed));
}

function bannedWord(words, text) {
  for (const pattern of words) {
    const match = pattern.exec(text);
    if (match) return match[0];
  }
  return null;
}

function literalText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    // Join fixed parts without spaces so `host_plan_${hash}` reads as a code.
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join("…");
  }
  if (ts.isJsxText(node)) return node.text.replace(/\s+/g, " ").trim();
  return null;
}

function skipped(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isImportDeclaration(current) || ts.isExportDeclaration(current)) return true;
    if (ts.isLiteralTypeNode(current) || ts.isTypeNode(current)) return true;
    if (ts.isJsxAttribute(current) && SKIP_ATTRIBUTES.has(current.name.getText())) return true;
    if (ts.isElementAccessExpression(current) && current.argumentExpression === node) return true;
    if (ts.isCallExpression(current)) {
      const callee = current.expression.getText();
      if (/^console\./.test(callee) || /^(require|import)$/.test(callee)) return true;
      if (/\b(includes|startsWith|endsWith|test|match|replace|replaceAll|split|indexOf|join)$/.test(callee)) {
        return true;
      }
    }
    if (ts.isBinaryExpression(current)) {
      const op = current.operatorToken.kind;
      if (op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
        return true;
      }
    }
    if (ts.isPropertyAssignment(current) && current.name === node) return true;
  }
  return false;
}

/** Host-visible sentences in a TSX/TS screen or helper that use banned words. */
function scanHostCopy(words, source, fileName) {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits = [];
  const visit = (node) => {
    const text = literalText(node);
    if (text !== null && isCopy(text) && !skipped(node)) {
      const word = bannedWord(words, text);
      if (word) hits.push({ text, word, line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return hits;
}

/** ToolError messages and plain-text result properties in an Ari tool region. */
function scanAriAdMessages(words, region) {
  const file = ts.createSourceFile("ari.ts", region, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hits = [];
  const record = (node) => {
    const collect = (inner) => {
      const text = literalText(inner);
      if (text !== null && isCopy(text)) {
        const word = bannedWord(words, text);
        if (word) hits.push({ text, word, line: file.getLineAndCharacterOfPosition(inner.getStart()).line + 1 });
      }
      ts.forEachChild(inner, collect);
    };
    collect(node);
  };
  const visit = (node) => {
    if (ts.isNewExpression(node) && node.expression.getText() === "ToolError" && node.arguments?.[1]) {
      record(node.arguments[1]);
    }
    if (ts.isPropertyAssignment(node) && ARI_MESSAGE_PROPERTIES.has(node.name.getText()) && node.initializer) {
      record(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return hits;
}

// ---------------------------------------------------------------------------

const failures = [];
const fail = (msg) => failures.push(msg);

function read(relToApp) {
  const abs = path.join(APP_ROOT, relToApp);
  try {
    return fs.readFileSync(abs, "utf8");
  } catch (e) {
    fail(`cannot read mingla-business/${relToApp} (${e.code ?? e.message})`);
    return null;
  }
}

/** source.slice(start, end) between two anchors, or null (recorded as a failure). */
function region(source, label, startAnchor, endAnchor, from = 0) {
  const start = source.indexOf(startAnchor, from);
  const end = start === -1 ? -1 : source.indexOf(endAnchor, start);
  if (start === -1 || end <= start) {
    fail(`${label}: anchor region not found (start ${JSON.stringify(startAnchor)}) — update the gate if the code moved`);
    return null;
  }
  return source.slice(start, end);
}

function report(prefix, hits) {
  for (const hit of hits) fail(`${prefix}:${hit.line} [${hit.word}] ${JSON.stringify(hit.text)}`);
}

function selfTest(words) {
  const old = `const a = <Text>Immutable plan hash</Text>;
      setNotice("This provider can run a broader audience. Review the exact widening before accepting it.");
      // comments may say provider, hash and lane
      const b = <View testID="host-ad-provider-hash" />;`;
  const got = scanHostCopy(words, old, "old.tsx").map((h) => h.word.toLowerCase());
  const okHost = JSON.stringify(got) === JSON.stringify(["immutable", "provider"]);
  const ari = scanAriAdMessages(words, 'throw new ToolError("RPC_FAILED", "provider create returned no campaign id");');
  const okAri = ari.length === 1;
  const clean = scanHostCopy(words, 'const a = <Text testID="lane_hash">Your ad is running.</Text>;', "clean.tsx");
  const okClean = clean.length === 0;
  console.log(`self-test: old Host wording flagged=${okHost} (${JSON.stringify(got)})`);
  console.log(`self-test: old Ari message flagged=${okAri}`);
  console.log(`self-test: plain copy + code ids pass=${okClean}`);
  if (!(okHost && okAri && okClean)) {
    console.error(`FAIL [${TAG}] self-test: the scanner no longer catches the old wording.`);
    process.exit(1);
  }
  console.log(`OK [${TAG}] self-test passed.`);
  process.exit(0);
}

function main() {
  const wordsSource = read(WORDS_FILE);
  const words = wordsSource ? loadBannedWords(wordsSource) : [];
  if (words.length < 20) {
    console.error(`FAIL [${TAG}]: HOST_AD_BANNED_WORDS in ${WORDS_FILE} parsed to ${words.length} patterns (need >= 20).`);
    process.exit(1);
  }
  if (process.argv.includes("--self-test")) selfTest(words);

  // 1. Every Host ad screen and helper.
  for (const file of HOST_AD_FILES) {
    const src = read(file);
    if (src !== null) report(file, scanHostCopy(words, src, file));
  }

  // 2. The ad-plan part of Ari's proposal card.
  const card = read("src/components/ari/ToolProposalCard.tsx");
  if (card !== null) {
    const body = region(
      card,
      "ToolProposalCard ad facts",
      'if (toolName === "propose_ad_plan" || toolName === "approve_ad_plan") {',
      "return out;",
    );
    const assuranceAt = card.indexOf("isAdPlanProposal\n                  ?");
    if (assuranceAt === -1) fail("ToolProposalCard: ad-plan assurance line anchor not found");
    if (body !== null && assuranceAt !== -1) {
      const assurance = card.slice(assuranceAt, card.indexOf(":", card.indexOf('"', assuranceAt) + 1) + 1);
      report("ToolProposalCard", scanHostCopy(words, `${body}\n${assurance}`, "ToolProposalCard.tsx"));
    }
    if (card.includes('label: "Plan binding"')) fail('ToolProposalCard: the "Plan binding" label is back');
  }

  // 3 + 4. Ari's ad card facts and ad tool messages.
  const ari = (() => {
    try {
      return fs.readFileSync(path.join(REPO_ROOT, "supabase/functions/_shared/agentDomainTools.ts"), "utf8");
    } catch (e) {
      fail(`cannot read supabase/functions/_shared/agentDomainTools.ts (${e.code ?? e.message})`);
      return null;
    }
  })();
  if (ari !== null) {
    const preflightAt = ari.indexOf("export async function preflightMoneyProposal(");
    if (preflightAt === -1) fail("agentDomainTools: preflightMoneyProposal anchor not found");
    else {
      const facts = region(ari, "Ari ad card facts", 'if (toolName === "propose_ad_plan") {', 'if (toolName === "cancel_trip_booking") {', preflightAt);
      if (facts !== null) report("ari-card", scanHostCopy(words, facts, "ari-card.ts"));
    }
    const tools = region(ari, "Ari ad tools", "function hostAdScheduleDays(", "const updateCampaignDraft = writeTool(");
    if (tools !== null) report("ari", scanAriAdMessages(words, tools));
  }

  // 5. The plan hash is never shown, but is still sent to Mingla.
  const create = read("app/(tabs)/marketing/ads/create.tsx");
  const service = read("src/services/hostAdPlanService.ts");
  if (create !== null) {
    if (create.includes("{prepared.planHash}")) fail("create.tsx renders {prepared.planHash} on screen");
    if (!create.includes("planHash: prepared.planHash")) fail("create.tsx no longer sends planHash: prepared.planHash");
  }
  if (service !== null) {
    if (!service.includes("plan_hash: aggregate.version.plan_hash")) fail("hostAdPlanService no longer reads plan_hash: aggregate.version.plan_hash");
    if (!service.includes("plan_hash: input.planHash")) fail("hostAdPlanService no longer sends plan_hash: input.planHash");
  }

  // 6. The typed confirmations stay, and are explained.
  const detail = read("app/(tabs)/marketing/ads/[id].tsx");
  if (create !== null) {
    for (const needle of ['launchPhrase !== "LAUNCH"', "Type LAUNCH to start your ad.", 'confirmText="CANCEL PLAN"']) {
      if (!create.includes(needle)) fail(`create.tsx lost the typed confirmation ${JSON.stringify(needle)}`);
    }
  }
  if (detail !== null) {
    for (const needle of ['confirmText={destructiveAction === "end" ? "END" : "CANCEL"}', "Type END to stop your ad on every app."]) {
      if (!detail.includes(needle)) fail(`[id].tsx lost the typed confirmation ${JSON.stringify(needle)}`);
    }
  }

  if (failures.length) {
    console.error(`FAIL [${TAG}]: Host ad copy uses internal words or lost a structural rule (issue #4238).`);
    for (const f of failures) console.error(`  x ${f}`);
    console.error("Fix: say it the way a Host would (see hostAdCopy.ts), or move the text into a copy helper.");
    process.exit(1);
  }
  console.log(`OK [${TAG}]: ${HOST_AD_FILES.length} Host ad files, the Ari ad card and Ari ad tools use plain words (${words.length} banned patterns).`);
}

main();
