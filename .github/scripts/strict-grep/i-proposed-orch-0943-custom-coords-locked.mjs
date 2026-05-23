#!/usr/bin/env node
/**
 * I-PROPOSED-CUSTOM-COORDS-LOCKED-WHEN-CUSTOM-LOCATION-MODE strict-grep gate.
 *
 * Any client write containing custom_lat/custom_lng must either include
 * custom_location in the same payload, or be structurally gated to GPS mode.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const DEFAULT_SCAN_ROOT = resolve(REPO_ROOT, "app-mobile/src");

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

const rootArg = argValue("--root") ?? argValue("--target");
const scanRoot = rootArg
  ? isAbsolute(rootArg)
    ? rootArg
    : resolve(process.cwd(), rootArg)
  : DEFAULT_SCAN_ROOT;

const SOURCE_EXT_RE = /\.(tsx?|jsx?)$/;
const COORD_KEY_RE = /\bcustom_(?:lat|lng)\b/;
const LOCATION_KEY_RE = /\bcustom_location\b/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const full = resolve(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (SOURCE_EXT_RE.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function lineNumber(source, index) {
  return source.slice(0, index).split("\n").length;
}

function previousLines(source, index, count = 10) {
  const lines = source.slice(0, index).split("\n");
  return lines.slice(Math.max(0, lines.length - count)).join("\n");
}

function findMatching(source, openIndex, openChar, closeChar) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === openChar) depth += 1;
    if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function captureBalancedObject(source, openBraceIndex) {
  if (openBraceIndex < 0 || source[openBraceIndex] !== "{") return null;
  const end = findMatching(source, openBraceIndex, "{", "}");
  if (end < 0) return null;
  return source.slice(openBraceIndex, end + 1);
}

function resolveVariableObject(source, beforeIndex, name) {
  const prefix = source.slice(0, beforeIndex);
  const declRe = new RegExp(`(?:const|let|var)\\s+${name}\\s*(?::[^=]+)?=\\s*\\{`, "g");
  let match = null;
  for (const candidate of prefix.matchAll(declRe)) {
    match = candidate;
  }
  if (!match || match.index == null) return null;
  const openBrace = prefix.indexOf("{", match.index);
  return captureBalancedObject(source, openBrace);
}

function captureValue(source, absoluteStart, callStart) {
  let i = absoluteStart;
  while (/\s/.test(source[i] ?? "")) i += 1;
  if (source[i] === "{") return captureBalancedObject(source, i);
  const varMatch = source.slice(i).match(/^([A-Za-z_$][\w$]*)/);
  if (!varMatch) return "";
  return resolveVariableObject(source, callStart, varMatch[1]) ?? varMatch[1];
}

function captureUpsertPrefsPayload(source, callStart, span) {
  const localIdx = span.indexOf("p_prefs");
  if (localIdx < 0) return "";
  const colonIdx = span.indexOf(":", localIdx);
  if (colonIdx < 0) return "";
  return captureValue(source, callStart + colonIdx + 1, callStart);
}

function findTopLevelSecondArgument(source, callOpen, callClose) {
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let quote = null;
  let escaped = false;
  for (let i = callOpen + 1; i < callClose; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") depthParen += 1;
    else if (ch === ")") depthParen -= 1;
    else if (ch === "{") depthBrace += 1;
    else if (ch === "}") depthBrace -= 1;
    else if (ch === "[") depthBracket += 1;
    else if (ch === "]") depthBracket -= 1;
    else if (ch === "," && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
      return i + 1;
    }
  }
  return -1;
}

function captureUpdateUserPreferencesPayload(source, callStart, callOpen, callClose) {
  const secondArg = findTopLevelSecondArgument(source, callOpen, callClose);
  if (secondArg < 0) return "";
  return captureValue(source, secondArg, callStart);
}

function hasGpsGuard(context) {
  return (
    /use_gps_location\s*===\s*true/.test(context) ||
    /use_gps_location\s*!==\s*false/.test(context) ||
    /useGpsLocation\s*===\s*true/.test(context) ||
    /participantUseGps\s*!==\s*true\s*\)\s*return/.test(context) ||
    /use_gps_location[\s\S]*?if\s*\([^)]*!==\s*true\s*\)\s*return/.test(context)
  );
}

function findCalls(source) {
  const calls = [];
  const patterns = [
    { type: "upsert_participant_prefs", re: /supabase\.rpc\s*\(/g },
    { type: "updateUserPreferences", re: /PreferencesService\.updateUserPreferences\s*\(/g },
  ];

  for (const { type, re } of patterns) {
    for (const match of source.matchAll(re)) {
      const callStart = match.index ?? 0;
      const callOpen = source.indexOf("(", callStart);
      const callClose = findMatching(source, callOpen, "(", ")");
      if (callClose < 0) continue;
      const span = source.slice(callStart, callClose + 1);
      if (type === "upsert_participant_prefs" && !span.includes("upsert_participant_prefs")) {
        continue;
      }
      const payload =
        type === "upsert_participant_prefs"
          ? captureUpsertPrefsPayload(source, callStart, span)
          : captureUpdateUserPreferencesPayload(source, callStart, callOpen, callClose);
      calls.push({ type, callStart, span, payload });
    }
  }
  return calls;
}

if (!existsSync(scanRoot)) {
  console.error(`[I-PROPOSED-ORCH-0943] cannot find scan root ${scanRoot}`);
  process.exit(2);
}

const violations = [];
for (const file of walk(scanRoot)) {
  const source = readFileSync(file, "utf8");
  for (const call of findCalls(source)) {
    if (!COORD_KEY_RE.test(call.payload)) continue;
    if (LOCATION_KEY_RE.test(call.payload)) continue;
    if (hasGpsGuard(previousLines(source, call.callStart, 10))) continue;
    violations.push({
      file,
      line: lineNumber(source, call.callStart),
      type: call.type,
    });
  }
}

for (const violation of violations) {
  const rel = relative(REPO_ROOT, violation.file).replaceAll("\\", "/");
  console.error(
    `x ${rel}:${violation.line} - I-PROPOSED-CUSTOM-COORDS-LOCKED-WHEN-CUSTOM-LOCATION-MODE: ${violation.type} writes custom_lat/custom_lng without custom_location and without a GPS-mode guard.`,
  );
}

console.log(
  [
    "I-PROPOSED-CUSTOM-COORDS-LOCKED-WHEN-CUSTOM-LOCATION-MODE:",
    violations.length === 0 ? "PASS" : "FAIL",
    `root=${relative(REPO_ROOT, scanRoot).replaceAll("\\", "/") || "."}`,
    `violations=${violations.length}`,
  ].join(" "),
);

process.exit(violations.length === 0 ? 0 : 1);
