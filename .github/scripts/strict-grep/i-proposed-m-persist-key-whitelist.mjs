#!/usr/bin/env node
/**
 * I-PROPOSED-M strict-grep gate — PERSIST-KEY-WHITELIST-SYNC.
 *
 * Verifies every Zustand persist name literal in mingla-business/src/store/*.ts
 * appears in KNOWN_MINGLA_KEYS inside reapOrphanStorageKeys.ts, and vice versa.
 *
 * Per META-ORCH-0744-PROCESS / SPEC §3.3.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");
const STORE_DIR = join(REPO_ROOT, "mingla-business", "src", "store");
const REAPER_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "utils",
  "reapOrphanStorageKeys.ts",
);

const PERSIST_NAME_PATTERN = /name:\s*"(mingla-business\.[^"]+)"/g;
const WHITELIST_BLOCK_PATTERN =
  /KNOWN_MINGLA_KEYS\s*=\s*new Set<string>\(\[([\s\S]*?)\]\)/m;
const STRING_LITERAL_PATTERN = /"([^"]+)"/g;

function rel(path) {
  return relative(REPO_ROOT, path).split(sep).join("/");
}

function stripComments(source) {
  let output = "";
  let i = 0;
  let inString = null;
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];

    if (inString) {
      output += char;
      if (char === "\\") {
        output += next ?? "";
        i += 2;
        continue;
      }
      if (char === inString) inString = null;
      i += 1;
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      inString = char;
      output += char;
      i += 1;
      continue;
    }

    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      output += "\n";
      i += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      output += "  ";
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        output += source[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      output += "  ";
      i += 2;
      continue;
    }

    output += char;
    i += 1;
  }
  return output;
}

function extractPersistNames() {
  const names = new Map();
  const files = readdirSync(STORE_DIR).filter((file) => file.endsWith(".ts"));
  for (const file of files) {
    const path = join(STORE_DIR, file);
    const source = stripComments(readFileSync(path, "utf8"));
    let match;
    PERSIST_NAME_PATTERN.lastIndex = 0;
    while ((match = PERSIST_NAME_PATTERN.exec(source)) !== null) {
      names.set(match[1], rel(path));
    }
  }
  return names;
}

function extractWhitelist() {
  const source = stripComments(readFileSync(REAPER_PATH, "utf8"));
  const blockMatch = WHITELIST_BLOCK_PATTERN.exec(source);
  if (!blockMatch) {
    console.error(
      `[I-PROPOSED-M] FAIL — KNOWN_MINGLA_KEYS Set declaration not found in ${rel(REAPER_PATH)}.`,
    );
    console.error(
      "Fix: preserve the recognizable `const KNOWN_MINGLA_KEYS = new Set<string>([...])` shape or update this gate in the same PR.",
    );
    process.exit(1);
  }

  const whitelist = new Set();
  let match;
  STRING_LITERAL_PATTERN.lastIndex = 0;
  while ((match = STRING_LITERAL_PATTERN.exec(blockMatch[1])) !== null) {
    if (match[1].startsWith("mingla-business.")) {
      whitelist.add(match[1]);
    }
  }
  return whitelist;
}

const persistNames = extractPersistNames();
const whitelist = extractWhitelist();
const missingFromWhitelist = [];
const staleWhitelistEntries = [];

for (const [name, file] of persistNames) {
  if (!whitelist.has(name)) {
    missingFromWhitelist.push({ name, file });
  }
}

for (const name of whitelist) {
  if (!persistNames.has(name)) {
    staleWhitelistEntries.push(name);
  }
}

if (missingFromWhitelist.length > 0) {
  console.error(
    `[I-PROPOSED-M] FAIL — ${missingFromWhitelist.length} persist key(s) missing from KNOWN_MINGLA_KEYS:`,
  );
  for (const { name, file } of missingFromWhitelist) {
    console.error(`  - ${file}: name: "${name}"`);
  }
  console.error(
    "\nFix: add the missing key(s) to KNOWN_MINGLA_KEYS in mingla-business/src/utils/reapOrphanStorageKeys.ts before the persist-key bump merges.",
  );
  process.exit(1);
}

if (staleWhitelistEntries.length > 0) {
  console.error(
    `[I-PROPOSED-M] FAIL — ${staleWhitelistEntries.length} stale KNOWN_MINGLA_KEYS entrie(s) with no live persist name:`,
  );
  for (const name of staleWhitelistEntries) {
    console.error(`  - ${rel(REAPER_PATH)}: "${name}"`);
  }
  console.error(
    "\nFix: remove stale whitelist entries or restore the matching persisted store name in the same PR.",
  );
  process.exit(1);
}

console.log(
  `[I-PROPOSED-M] PASS — ${persistNames.size} persist key(s) match ${whitelist.size} whitelist entry(ies) exactly.`,
);
process.exit(0);
