#!/usr/bin/env node
/**
 * I-PROPOSED-ORCH-0939-COLLAB-DECK-HAS-PER-SESSION-PROVIDER strict-grep gate.
 *
 * CollabDeckSheet's SwipeableCards MUST be wrapped in a session-scoped
 * RecommendationsProvider so the modal reads collab deck data instead of the
 * global Home Explore currentMode="solo" provider.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const DEFAULT_TARGET =
  "app-mobile/src/components/connections/CollabDeckSheet.tsx";

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

const targetArg = argValue("--target");
const targetFile = targetArg
  ? isAbsolute(targetArg)
    ? targetArg
    : resolve(process.cwd(), targetArg)
  : resolve(REPO_ROOT, DEFAULT_TARGET);

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

if (!existsSync(targetFile)) {
  fail(
    `[I-PROPOSED-ORCH-0939] cannot find target file ${targetFile}`,
    2,
  );
}

let source;
try {
  source = readFileSync(targetFile, "utf8");
} catch (error) {
  fail(`[I-PROPOSED-ORCH-0939] cannot read ${targetFile}: ${error.message}`, 2);
}

const rel = relative(REPO_ROOT, targetFile).replaceAll("\\", "/");
const deckBlock = source.match(/<View style=\{styles\.deck\}>([\s\S]*?)<\/View>/)?.[1] ?? "";

const providerWrapRe =
  /<RecommendationsProvider\b[\s\S]*?currentMode=\{sessionId\}[\s\S]*?refreshKey=\{0\}[\s\S]*?persistedSessionId=\{sessionId\}[\s\S]*?onSessionLost=\{onClose\}[\s\S]*?key=\{sessionId\}[\s\S]*?>[\s\S]*?<SwipeableCards\b[\s\S]*?<\/RecommendationsProvider>/;

const hasProviderWrap = providerWrapRe.test(deckBlock);
const hasImport =
  /import \{ RecommendationsProvider \} from ["']\.\.\/\.\.\/contexts\/RecommendationsContext["'];/.test(
    source,
  );

const violations = [];
if (!hasImport) {
  violations.push("missing RecommendationsProvider import from ../../contexts/RecommendationsContext");
}
if (!hasProviderWrap) {
  violations.push(
    "missing <RecommendationsProvider currentMode={sessionId} refreshKey={0} persistedSessionId={sessionId} onSessionLost={onClose} key={sessionId}> around <SwipeableCards>",
  );
}

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(
      `x ${rel} - I-PROPOSED-ORCH-0939-COLLAB-DECK-HAS-PER-SESSION-PROVIDER: ${violation}.`,
    );
  }
  console.error(
    "  Fix: wrap CollabDeckSheet's SwipeableCards in a per-session RecommendationsProvider so collab decks do not fall through to global solo context.",
  );
}

console.log(
  [
    "I-PROPOSED-ORCH-0939-COLLAB-DECK-HAS-PER-SESSION-PROVIDER:",
    hasProviderWrap && hasImport ? "PASS" : "FAIL",
    `target=${rel}`,
    `violations=${violations.length}`,
  ].join(" "),
);

process.exit(violations.length === 0 ? 0 : 1);
