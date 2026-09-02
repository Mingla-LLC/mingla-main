#!/usr/bin/env node
/**
 * Complete, value-blind Edge environment contract audit (#2241).
 *
 * The audit walks every production function's recursive relative-import
 * closure. It records public environment variable names only; values and
 * value-derived metadata never enter this process.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
export const DEFAULT_CONTRACT = resolve(
  REPO_ROOT,
  "supabase",
  "function-env.contract.json",
);
export const DEFAULT_MANIFEST = resolve(
  REPO_ROOT,
  "supabase",
  "secrets.manifest.json",
);
export const FUNCTIONS_ROOT = resolve(REPO_ROOT, "supabase", "functions");

// #2241: the migration band holds ONLY the direct names still set in
// production. META_COMPETITOR_ACCESS_TOKEN, META_COMPETITOR_IG_USER_ID and
// RESEND_WEBHOOK_SECRET were removed after their bundle-first readers logged
// zero `governed_ad_legacy_fallback` in production, so the band narrows to the
// two that remain. Each is still DECLARED as a bundle field; this list is the
// leftover direct-name surface, not the declaration. Founder-approved
// 2026-09-02. A band that still expects names nobody can produce is a check
// that cannot pass (#2113).
export const ISSUE_2241_EXTRA_NAMES = Object.freeze([
  "ATTENDANCE_CLAIM_PEPPER",
  "CHECKOUT_REVOCATION_EXECUTE",
]);

export const ISSUE_2241_FUNCTIONS = Object.freeze([
  "brand-paystack-onboard",
  "brand-stripe-onboard",
  "payout-release-sweep",
  "marketing-send",
  "event-cancel-refund-fanout",
  "rsvp-contribution-refund",
  "source-refund-sweep",
  "venue-reservation-cancel",
  "send-pair-request",
  "send-phone-invite",
  "send-venue-sms",
  "ticket-confirmation-dispatch",
  "notify-dispatch",
  "offering-invite-dispatch",
  "rsvp-notify",
  "guest-roster-actions",
  "support-brand-person-erasure",
  "checkout-sale-revocation",
  "attendance-claim-link",
  "claim-attendance",
  "attendance-claim-backfill",
  "competitor-intel-worker",
  "resend-webhook",
]);

const FUNCTION_KEYS = [
  "migration_fallback_top_level",
  "optional_top_level",
  "required_bundle_fields",
  "required_top_level",
];
const ROOT_KEYS = [
  "functions",
  "non_secret_runtime_config",
  "platform_managed",
  "remediation",
  "schema_version",
  "shared_modules",
];
const REMEDIATION_KEYS = [
  "allowed_extra_live_names",
  "expires_after_merge_hours",
  "issue",
  "production_ref",
  "selected_functions",
];
const SHARED_MODULE_KEYS = [
  "allowed_call_expressions",
  "allowed_bundle_fields",
  "allowed_identifier_references",
  "allowed_top_level",
  "closure_call_identifiers",
  "dynamic_getters",
  "local_call_identifiers",
];
const SHARED_MODULE_REQUIRED_KEYS = SHARED_MODULE_KEYS.filter((key) =>
  !["allowed_call_expressions", "allowed_identifier_references"].includes(key)
);
const PRODUCTION_REF = "gqnoajqerqhnvulmnyvv";
const ENV_NAME = /^(?:[A-Z][A-Z0-9_]*|app\.qr_token_pepper)$/;
const IDENTIFIER_REFERENCE_SITE =
  /^[^@\s]+@\d+:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?:.+$/;
const SOURCE_EXTENSION = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;

function exactKeys(value, expected) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...expected].sort());
}

function validSharedModuleKeys(value) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    SHARED_MODULE_REQUIRED_KEYS.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => SHARED_MODULE_KEYS.includes(key));
}

function isSortedUniqueStrings(value, pattern = null) {
  return Array.isArray(value) &&
    value.every((entry) =>
      typeof entry === "string" &&
      entry.length > 0 &&
      (pattern === null || pattern.test(entry))
    ) &&
    JSON.stringify(value) === JSON.stringify([...new Set(value)].sort());
}

function toRepoPath(path, repoRoot = REPO_ROOT) {
  return relative(repoRoot, path).split(sep).join("/");
}

function isProductionSource(path) {
  const normalized = path.split(sep).join("/");
  return SOURCE_EXTENSION.test(path) &&
    !normalized.includes("/__tests__/") &&
    !normalized.includes("/fixtures/") &&
    !/\.test\.[^.]+$/.test(path) &&
    !/\.fixture\.[^.]+$/.test(path);
}

function sourceCandidates(importer, specifier) {
  if (!specifier.startsWith(".")) return [];
  const base = resolve(dirname(importer), specifier);
  if (extname(base)) return [base];
  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    resolve(base, "index.ts"),
    resolve(base, "index.tsx"),
    resolve(base, "index.js"),
  ];
}

function stripComments(source) {
  let output = "";
  let index = 0;
  let state = "code";
  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];
    if (state === "line") {
      if (current === "\n") {
        output += "\n";
        state = "code";
      } else output += " ";
      index += 1;
      continue;
    }
    if (state === "block") {
      if (current === "*" && next === "/") {
        output += "  ";
        index += 2;
        state = "code";
      } else {
        output += current === "\n" ? "\n" : " ";
        index += 1;
      }
      continue;
    }
    if (state === "single" || state === "double" || state === "template") {
      output += current;
      if (current === "\\") {
        output += next ?? "";
        index += 2;
        continue;
      }
      const terminator = state === "single"
        ? "'"
        : state === "double"
        ? '"'
        : "`";
      if (current === terminator) state = "code";
      index += 1;
      continue;
    }
    if (current === "/" && next === "/") {
      output += "  ";
      index += 2;
      state = "line";
    } else if (current === "/" && next === "*") {
      output += "  ";
      index += 2;
      state = "block";
    } else {
      output += current;
      if (current === "'") state = "single";
      else if (current === '"') state = "double";
      else if (current === "`") state = "template";
      index += 1;
    }
  }
  return output;
}

function normalizeExpression(expression) {
  return expression.replace(/\s+/g, " ").trim();
}

const IDENTIFIER_START = /[$_\p{ID_Start}]/u;
const IDENTIFIER_PART = /[$_\u200C\u200D\p{ID_Continue}]/u;
const REGEX_PREFIX_KEYWORDS = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);
const GROUP_PREFIX_KEYWORDS = new Set([
  ...REGEX_PREFIX_KEYWORDS,
  "const",
  "let",
  "var",
]);

function skipQuotedLiteral(source, start, quote) {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\") index += 2;
    else if (source[index] === quote) return index + 1;
    else index += 1;
  }
  return source.length;
}

function skipLineComment(source, start) {
  const newline = source.indexOf("\n", start + 2);
  return newline === -1 ? source.length : newline;
}

function skipBlockComment(source, start) {
  const close = source.indexOf("*/", start + 2);
  return close === -1 ? source.length : close + 2;
}

function regexCanStart(previous) {
  if (previous === undefined) return true;
  if (previous.type === "identifier") {
    return REGEX_PREFIX_KEYWORDS.has(previous.value);
  }
  return new Set([
    "(",
    "[",
    "{",
    ",",
    ";",
    ":",
    "=",
    "=>",
    "!",
    "!=",
    "!==",
    "?",
    "??",
    "&&",
    "||",
    "+",
    "-",
    "*",
    "%",
    "&",
    "|",
    "^",
    "~",
    "<",
    ">",
    "<=",
    ">=",
    "==",
    "===",
  ]).has(previous.raw);
}

function skipRegexLiteral(source, start) {
  let index = start + 1;
  let inClass = false;
  while (index < source.length) {
    const character = source[index];
    if (character === "\\") index += 2;
    else if (character === "[" && !inClass) {
      inClass = true;
      index += 1;
    } else if (character === "]" && inClass) {
      inClass = false;
      index += 1;
    } else if (character === "/" && !inClass) {
      index += 1;
      while (/[A-Za-z]/.test(source[index] ?? "")) index += 1;
      return index;
    } else if (character === "\n" || character === "\r") return start + 1;
    else index += 1;
  }
  return start + 1;
}

function regexCanStartAtSource(source, index, expressionStart) {
  const prefix = source.slice(expressionStart, index).trimEnd();
  if (prefix.length === 0) return true;
  if (
    /(?:^|[^A-Za-z0-9_$])(?:await|case|delete|in|instanceof|new|return|throw|typeof|void|yield)$/
      .test(
        prefix,
      )
  ) return true;
  return /[([{:;,=!?&|+\-*%^~<>]$/.test(prefix);
}

function skipTemplateExpression(source, start) {
  let depth = 1;
  let index = start;
  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];
    if (character === "'" || character === '"') {
      index = skipQuotedLiteral(source, index, character);
    } else if (character === "`") {
      index = skipTemplateLiteral(source, index);
    } else if (
      character === "/" && next === "/" && source[index - 1] !== "\\"
    ) {
      index = skipLineComment(source, index);
    } else if (
      character === "/" && next === "*" && source[index - 1] !== "\\"
    ) {
      index = skipBlockComment(source, index);
    } else if (
      character === "/" && regexCanStartAtSource(source, index, start)
    ) {
      index = skipRegexLiteral(source, index);
    } else if (character === "{") {
      depth += 1;
      index += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
      index += 1;
    } else index += 1;
  }
  return source.length;
}

function skipTemplateLiteral(source, start) {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\") index += 2;
    else if (source[index] === "`") return index + 1;
    else if (source[index] === "$" && source[index + 1] === "{") {
      const close = skipTemplateExpression(source, index + 2);
      index = close < source.length ? close + 1 : source.length;
    } else index += 1;
  }
  return source.length;
}

function templateExpressionSources(raw) {
  const expressions = [];
  let index = 1;
  while (index < raw.length - 1) {
    if (raw[index] === "\\") index += 2;
    else if (raw[index] === "$" && raw[index + 1] === "{") {
      const start = index + 2;
      const close = skipTemplateExpression(raw, start);
      if (close >= raw.length) break;
      expressions.push(raw.slice(start, close));
      index = close + 1;
    } else index += 1;
  }
  return expressions;
}

function decodeStringToken(raw) {
  const quote = raw[0];
  if ((quote !== "'" && quote !== '"') || raw.at(-1) !== quote) return null;
  let output = "";
  for (let index = 1; index < raw.length - 1; index += 1) {
    const character = raw[index];
    if (character !== "\\") {
      output += character;
      continue;
    }
    index += 1;
    if (index >= raw.length - 1) return null;
    const escaped = raw[index];
    const simple = {
      "0": "\0",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v",
    };
    if (Object.hasOwn(simple, escaped)) output += simple[escaped];
    else if (escaped === "x") {
      const hex = raw.slice(index + 1, index + 3);
      if (!/^[0-9A-Fa-f]{2}$/.test(hex)) return null;
      output += String.fromCodePoint(Number.parseInt(hex, 16));
      index += 2;
    } else if (escaped === "u") {
      const hex = raw.slice(index + 1, index + 5);
      if (!/^[0-9A-Fa-f]{4}$/.test(hex)) return null;
      output += String.fromCodePoint(Number.parseInt(hex, 16));
      index += 4;
    } else if (escaped === "\n") {
      // JavaScript line continuation contributes no character.
    } else output += escaped;
  }
  return output;
}

function decodeIdentifierEscape(source, start) {
  if (source[start] !== "\\" || source[start + 1] !== "u") return null;
  if (source[start + 2] === "{") {
    const close = source.indexOf("}", start + 3);
    if (close === -1) return null;
    const hex = source.slice(start + 3, close);
    if (!/^[0-9A-Fa-f]{1,6}$/.test(hex)) return null;
    const codePoint = Number.parseInt(hex, 16);
    if (codePoint > 0x10ffff) return null;
    return { end: close + 1, value: String.fromCodePoint(codePoint) };
  }
  const hex = source.slice(start + 2, start + 6);
  if (!/^[0-9A-Fa-f]{4}$/.test(hex)) return null;
  return {
    end: start + 6,
    value: String.fromCodePoint(Number.parseInt(hex, 16)),
  };
}

function readIdentifierToken(source, start) {
  let cursor = start;
  let value = "";
  let first = true;
  let escaped = false;
  while (cursor < source.length) {
    const character = source[cursor];
    let decoded = character;
    let next = cursor + 1;
    if (character === "\\") {
      const escape = decodeIdentifierEscape(source, cursor);
      if (escape === null) {
        return {
          end: Math.max(cursor + 1, start + 1),
          raw: source.slice(start, Math.max(cursor + 1, start + 1)),
          start,
          type: "invalid_identifier_escape",
          value: null,
        };
      }
      decoded = escape.value;
      next = escape.end;
      escaped = true;
    }
    const pattern = first ? IDENTIFIER_START : IDENTIFIER_PART;
    if (!pattern.test(decoded)) {
      if (character === "\\") {
        return {
          end: next,
          raw: source.slice(start, next),
          start,
          type: "invalid_identifier_escape",
          value: null,
        };
      }
      break;
    }
    value += decoded;
    cursor = next;
    first = false;
  }
  if (first) return null;
  return {
    end: cursor,
    escaped,
    raw: source.slice(start, cursor),
    start,
    type: "identifier",
    value,
  };
}

function tokenizeSyntax(source) {
  const tokens = [];
  const controlParentheses = [];
  const controlKeywords = new Set([
    "catch",
    "for",
    "if",
    "switch",
    "while",
    "with",
  ]);
  const multiPunctuators = [
    "===",
    "!==",
    ">>>",
    "**=",
    "&&=",
    "||=",
    "??=",
    "=>",
    "?.",
    "??",
    "&&",
    "||",
    "==",
    "!=",
    "<=",
    ">=",
    "++",
    "--",
    "**",
    "<<",
    ">>",
    "+=",
    "-=",
    "*=",
    "/=",
    "%=",
    "&=",
    "|=",
    "^=",
    "...",
  ];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];
    if (/\s/.test(character)) {
      index += 1;
    } else if (
      character === "/" && next === "/" && source[index - 1] !== "\\"
    ) {
      index = skipLineComment(source, index);
    } else if (
      character === "/" && next === "*" && source[index - 1] !== "\\"
    ) {
      index = skipBlockComment(source, index);
    } else if (character === "'" || character === '"') {
      const end = skipQuotedLiteral(source, index, character);
      const raw = source.slice(index, end);
      tokens.push({
        end,
        raw,
        start: index,
        type: "string",
        value: decodeStringToken(raw),
      });
      index = end;
    } else if (character === "`") {
      const end = skipTemplateLiteral(source, index);
      tokens.push({
        end,
        raw: source.slice(index, end),
        start: index,
        type: "template",
      });
      index = end;
    } else if (IDENTIFIER_START.test(character) || character === "\\") {
      const identifier = readIdentifierToken(source, index);
      if (identifier === null) {
        tokens.push({
          end: index + 1,
          raw: character,
          start: index,
          type: "punctuator",
        });
        index += 1;
      } else {
        tokens.push(identifier);
        index = identifier.end;
      }
    } else if (/[0-9]/.test(character)) {
      let end = index + 1;
      while (/[A-Za-z0-9_.]/.test(source[end] ?? "")) end += 1;
      tokens.push({
        end,
        raw: source.slice(index, end),
        start: index,
        type: "number",
      });
      index = end;
    } else if (
      character === "/" &&
      (regexCanStart(tokens.at(-1)) || tokens.at(-1)?.closesControl === true) &&
      next !== "="
    ) {
      const end = skipRegexLiteral(source, index);
      if (end === index + 1) {
        tokens.push({ end, raw: character, start: index, type: "punctuator" });
        index = end;
      } else {
        tokens.push({
          end,
          raw: source.slice(index, end),
          start: index,
          type: "regex",
        });
        index = end;
      }
    } else {
      const raw = multiPunctuators.find((candidate) =>
        source.startsWith(candidate, index)
      ) ?? character;
      const token = {
        end: index + raw.length,
        raw,
        start: index,
        type: "punctuator",
      };
      if (raw === "(") {
        const previous = tokens.at(-1);
        controlParentheses.push(
          previous?.type === "identifier" &&
            controlKeywords.has(previous.value),
        );
      } else if (raw === ")") {
        token.closesControl = controlParentheses.pop() === true;
      }
      tokens.push(token);
      index += raw.length;
    }
  }
  return tokens;
}

function tokenPairs(tokens) {
  const openToClose = new Map();
  const closeToOpen = new Map();
  const stack = [];
  const closes = { ")": "(", "]": "[", "}": "{" };
  for (let index = 0; index < tokens.length; index += 1) {
    const raw = tokens[index].raw;
    if (raw === "(" || raw === "[" || raw === "{") stack.push({ index, raw });
    else if (Object.hasOwn(closes, raw)) {
      const open = stack.at(-1);
      if (open?.raw !== closes[raw]) continue;
      stack.pop();
      openToClose.set(open.index, index);
      closeToOpen.set(index, open.index);
    }
  }
  return { closeToOpen, openToClose };
}

function isGroupingOpen(tokens, open) {
  const previous = tokens[open - 1];
  if (previous === undefined) return true;
  if (previous.type === "identifier") {
    return GROUP_PREFIX_KEYWORDS.has(previous.value);
  }
  return ![")", "]", "}", ".", "?."].includes(previous.raw) &&
    previous.type !== "string" &&
    previous.type !== "template" &&
    previous.type !== "number";
}

function groupingWrappers(tokens, expressionStart) {
  const wrappers = new Set();
  let cursor = expressionStart - 1;
  while (tokens[cursor]?.raw === "(" && isGroupingOpen(tokens, cursor)) {
    wrappers.add(cursor);
    cursor -= 1;
  }
  return wrappers;
}

function consumeGroupingCloses(tokens, index, wrappers, pairs) {
  let cursor = index;
  while (
    tokens[cursor]?.raw === ")" &&
    wrappers.has(pairs.closeToOpen.get(cursor))
  ) cursor += 1;
  return cursor;
}

function readMember(tokens, index, expected = null) {
  let cursor = index;
  if (tokens[cursor]?.raw === "." || tokens[cursor]?.raw === "?.") {
    cursor += 1;
    if (tokens[cursor]?.raw === "[") {
      // Optional bracket access: obj?.["field"].
    } else if (tokens[cursor]?.type === "identifier") {
      const name = tokens[cursor].value;
      return expected === null || name === expected
        ? { name, next: cursor + 1, propertyIndex: cursor }
        : null;
    } else return null;
  }
  if (tokens[cursor]?.raw !== "[") return null;
  const property = tokens[cursor + 1];
  if (
    property?.type !== "string" ||
    tokens[cursor + 2]?.raw !== "]" ||
    property.value === null
  ) return null;
  return expected === null || property.value === expected
    ? { name: property.value, next: cursor + 3, propertyIndex: cursor + 1 }
    : null;
}

function readDirectCall(tokens, index, pairs) {
  let cursor = index;
  if (tokens[cursor]?.raw === "?.") cursor += 1;
  if (tokens[cursor]?.raw !== "(") return null;
  const close = pairs.openToClose.get(cursor);
  return close === undefined ? null : { close, open: cursor, next: close + 1 };
}

function firstCallArgument(source, tokens, call, pairs) {
  const inside = tokens.slice(call.open + 1, call.close);
  let comma = call.close;
  for (let index = call.open + 1; index < call.close; index += 1) {
    const nestedClose = pairs.openToClose.get(index);
    if (nestedClose !== undefined && nestedClose < call.close) {
      index = nestedClose;
      continue;
    }
    if (tokens[index].raw === ",") {
      comma = index;
      break;
    }
  }
  const argumentTokens = tokens.slice(call.open + 1, comma);
  const expression = argumentTokens.length === 0 ? "" : normalizeExpression(
    stripComments(
      source.slice(argumentTokens[0].start, argumentTokens.at(-1).end),
    ),
  );
  const literalToken = argumentTokens.length === 1 &&
      argumentTokens[0].type === "string"
    ? argumentTokens[0]
    : null;
  return {
    expression,
    literalName: literalToken?.value ?? null,
    tokenCount: inside.length,
  };
}

function callArgumentsAt(source, open) {
  let index = open + 1;
  let depth = 1;
  let quote = null;
  while (index < source.length && depth > 0) {
    const character = source[index];
    if (quote !== null) {
      if (character === "\\") index += 2;
      else {
        if (character === quote) quote = null;
        index += 1;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      index += 1;
    } else if (character === "(") {
      depth += 1;
      index += 1;
    } else if (character === ")") {
      depth -= 1;
      index += 1;
    } else index += 1;
  }
  if (depth !== 0) return null;
  return { argumentsSource: source.slice(open + 1, index - 1), end: index };
}

function firstArgumentOf(argumentsSource) {
  let end = argumentsSource.length;
  let depth = 0;
  let quote = null;
  for (let index = 0; index < argumentsSource.length; index += 1) {
    const character = argumentsSource[index];
    if (quote !== null) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if (character === "(" || character === "[" || character === "{") {
      depth += 1;
    } else if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      end = index;
      break;
    }
  }
  return normalizeExpression(argumentsSource.slice(0, end));
}

/**
 * Collect static imports and fail closed on every computed dynamic import.
 * A quote-only relative template literal and a valid second import() argument
 * are static; interpolation, concatenation, conditionals, and variables are
 * not allowed to disappear from the recursive closure.
 */
function importSpecifiers(source) {
  const stripped = stripComments(source);
  const specifiers = new Set();
  const failures = [];
  const staticImport =
    /(?:import|export)\s+(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']/g;
  for (const match of stripped.matchAll(staticImport)) specifiers.add(match[1]);

  const dynamicImport = /\bimport\s*\(/g;
  for (const match of stripped.matchAll(dynamicImport)) {
    const open = (match.index ?? 0) + match[0].lastIndexOf("(");
    const call = callArgumentsAt(stripped, open);
    if (call === null) {
      failures.push("dynamic_import_unterminated");
      continue;
    }
    const firstArgument = firstArgumentOf(call.argumentsSource);
    const literal = /^(["'`])([^"'`\\]*)\1$/.exec(firstArgument);
    if (literal === null || (literal[1] === "`" && literal[2].includes("${"))) {
      failures.push(
        `dynamic_import_not_static:${firstArgument || "<empty>"}`,
      );
      continue;
    }
    specifiers.add(literal[2]);
  }
  return { failures, specifiers: [...specifiers] };
}

function scanDirectEnvReads(source) {
  const tokens = tokenizeSyntax(source);
  const pairs = tokenPairs(tokens);
  const reads = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].type === "invalid_identifier_escape") {
      reads.push({ kind: "unsafe", reason: "invalid_identifier_escape" });
      continue;
    }
    if (tokens[index].type !== "identifier" || tokens[index].value !== "Deno") {
      continue;
    }
    const wrappers = groupingWrappers(tokens, index);
    let cursor = consumeGroupingCloses(tokens, index + 1, wrappers, pairs);
    const member = readMember(tokens, cursor);
    if (member === null) {
      reads.push({ kind: "unsafe", reason: "unrecognized_deno_reference" });
      continue;
    }
    if (member.name !== "env") continue;
    cursor = consumeGroupingCloses(tokens, member.next, wrappers, pairs);
    const getter = readMember(tokens, cursor, "get");
    if (getter === null) {
      reads.push({ kind: "unsafe", reason: "unrecognized_deno_env_access" });
      continue;
    }
    cursor = consumeGroupingCloses(tokens, getter.next, wrappers, pairs);
    const call = readDirectCall(tokens, cursor, pairs);
    if (call === null) {
      reads.push({ kind: "unsafe", reason: "indirect_deno_env_get" });
      continue;
    }
    const argument = firstCallArgument(source, tokens, call, pairs);
    reads.push(
      argument.literalName !== null &&
        /^[A-Za-z0-9_.]+$/.test(argument.literalName)
        ? { kind: "literal", name: argument.literalName }
        : {
          kind: "dynamic",
          expression: argument.expression || "<empty>",
        },
    );
  }
  return reads;
}

/**
 * Extract every Deno environment read without executing source. Equivalent
 * dot/bracket/optional/grouped spellings are normalized by tokens; every env
 * or getter reference that is not an immediate proven call is fail-closed.
 */
export function findEnvReads(source) {
  const reads = scanDirectEnvReads(source);
  for (const token of tokenizeSyntax(source)) {
    if (token.type !== "template") continue;
    for (const expression of templateExpressionSources(token.raw)) {
      reads.push(...findEnvReads(expression));
    }
  }
  return reads;
}

function identifierValue(token) {
  if (token?.type === "identifier") return token.value;
  if (token?.type === "string") return token.value;
  return null;
}

function splitTopLevelTokenRanges(tokens, start, end, pairs) {
  const ranges = [];
  let rangeStart = start;
  for (let index = start; index < end; index += 1) {
    const nestedClose = pairs.openToClose.get(index);
    if (nestedClose !== undefined && nestedClose < end) {
      index = nestedClose;
      continue;
    }
    if (tokens[index].raw === ",") {
      ranges.push([rangeStart, index]);
      rangeStart = index + 1;
    }
  }
  ranges.push([rangeStart, end]);
  return ranges.filter(([left, right]) => left < right);
}

function namedBindingEntries(tokens, open, close, pairs) {
  const entries = [];
  for (
    const [rangeStart, rangeEnd] of splitTopLevelTokenRanges(
      tokens,
      open + 1,
      close,
      pairs,
    )
  ) {
    let cursor = rangeStart;
    if (
      tokens[cursor]?.type === "identifier" &&
      tokens[cursor].value === "type"
    ) cursor += 1;
    const importedToken = tokens[cursor];
    const imported = identifierValue(importedToken);
    if (imported === null) {
      entries.push({ failure: "module_binding_name_invalid" });
      continue;
    }
    cursor += 1;
    let local = imported;
    let localToken = importedToken;
    if (
      tokens[cursor]?.type === "identifier" &&
      tokens[cursor].value === "as"
    ) {
      localToken = tokens[cursor + 1];
      local = identifierValue(localToken);
      if (local === null) {
        entries.push({ failure: "module_binding_alias_invalid" });
        continue;
      }
      cursor += 2;
    }
    if (cursor !== rangeEnd) {
      entries.push({ failure: "module_binding_shape_unsupported" });
      continue;
    }
    entries.push({
      imported,
      importedPosition: importedToken.start,
      local,
      localPosition: localToken.start,
    });
  }
  return entries;
}

function findFromSpecifier(tokens, start) {
  for (let index = start; index < tokens.length; index += 1) {
    if (
      tokens[index].type === "identifier" && tokens[index].value === "from" &&
      tokens[index + 1]?.type === "string"
    ) {
      return {
        from: index,
        source: tokens[index + 1].value,
        sourceIndex: index + 1,
      };
    }
    if (tokens[index].raw === ";") break;
  }
  return null;
}

function parseModuleLinkage(source) {
  const tokens = tokenizeSyntax(source);
  const pairs = tokenPairs(tokens);
  const imports = [];
  const exports = [];
  const declarationPositions = new Set();
  const failures = [];

  const markDeclaration = (start, end) => {
    for (let cursor = start; cursor <= end; cursor += 1) {
      if (tokens[cursor]?.type === "identifier") {
        declarationPositions.add(tokens[cursor].start);
      }
    }
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier") continue;
    if (token.value === "import") {
      if (["(", ".", "?."].includes(tokens[index + 1]?.raw)) continue;
      if (tokens[index + 1]?.type === "string") {
        markDeclaration(index, index + 1);
        continue;
      }
      const from = findFromSpecifier(tokens, index + 1);
      if (from === null || typeof from.source !== "string") {
        failures.push("static_import_shape_unsupported");
        continue;
      }
      markDeclaration(index, from.sourceIndex);
      let cursor = index + 1;
      if (
        tokens[cursor]?.type === "identifier" &&
        tokens[cursor].value === "type"
      ) cursor += 1;
      if (
        tokens[cursor]?.type === "identifier" &&
        !["from", "as"].includes(tokens[cursor].value)
      ) {
        imports.push({
          imported: "default",
          kind: "binding",
          local: tokens[cursor].value,
          localPosition: tokens[cursor].start,
          source: from.source,
        });
        cursor += 1;
        if (tokens[cursor]?.raw === ",") cursor += 1;
      }
      if (tokens[cursor]?.raw === "*") {
        if (
          tokens[cursor + 1]?.type !== "identifier" ||
          tokens[cursor + 1].value !== "as" ||
          tokens[cursor + 2]?.type !== "identifier"
        ) {
          failures.push("namespace_import_shape_unsupported");
        } else {
          imports.push({
            kind: "namespace",
            local: tokens[cursor + 2].value,
            localPosition: tokens[cursor + 2].start,
            source: from.source,
          });
        }
      } else if (tokens[cursor]?.raw === "{") {
        const close = pairs.openToClose.get(cursor);
        if (close === undefined || close > from.from) {
          failures.push("named_import_shape_unsupported");
        } else {
          for (
            const entry of namedBindingEntries(tokens, cursor, close, pairs)
          ) {
            if (entry.failure) failures.push(entry.failure);
            else {
              imports.push({
                imported: entry.imported,
                importedPosition: entry.importedPosition,
                kind: "binding",
                local: entry.local,
                localPosition: entry.localPosition,
                source: from.source,
              });
            }
          }
        }
      } else if (cursor !== from.from) {
        failures.push("static_import_bindings_unsupported");
      }
      continue;
    }

    if (token.value !== "export") continue;
    let cursor = index + 1;
    let isDefault = false;
    if (
      tokens[cursor]?.type === "identifier" &&
      tokens[cursor].value === "default"
    ) {
      isDefault = true;
      cursor += 1;
    }
    if (tokens[cursor]?.raw === "*") {
      const from = findFromSpecifier(tokens, cursor + 1);
      if (from === null || typeof from.source !== "string") {
        failures.push("star_export_shape_unsupported");
        continue;
      }
      markDeclaration(index, from.sourceIndex);
      if (
        tokens[cursor + 1]?.type === "identifier" &&
        tokens[cursor + 1].value === "as" &&
        tokens[cursor + 2]?.type === "identifier"
      ) {
        exports.push({
          exported: tokens[cursor + 2].value,
          kind: "namespace",
          source: from.source,
        });
      } else exports.push({ kind: "star", source: from.source });
      continue;
    }
    if (tokens[cursor]?.raw === "{") {
      const close = pairs.openToClose.get(cursor);
      if (close === undefined) {
        failures.push("named_export_shape_unsupported");
        continue;
      }
      const from = findFromSpecifier(tokens, close + 1);
      const declarationEnd = from?.sourceIndex ?? close;
      markDeclaration(index, declarationEnd);
      for (const entry of namedBindingEntries(tokens, cursor, close, pairs)) {
        if (entry.failure) {
          failures.push(entry.failure);
          continue;
        }
        exports.push(
          from === null
            ? {
              exported: entry.local,
              kind: "local",
              local: entry.imported,
            }
            : {
              exported: entry.local,
              imported: entry.imported,
              kind: "reexport",
              source: from.source,
            },
        );
      }
      continue;
    }
    if (
      tokens[cursor]?.type === "identifier" &&
      ["async", "declare"].includes(tokens[cursor].value)
    ) cursor += 1;
    if (
      tokens[cursor]?.type === "identifier" &&
      ["class", "function"].includes(tokens[cursor].value)
    ) {
      cursor += 1;
      if (tokens[cursor]?.raw === "*") cursor += 1;
      const local = identifierValue(tokens[cursor]);
      if (local !== null) {
        exports.push({
          exported: isDefault ? "default" : local,
          kind: "local",
          local,
        });
        markDeclaration(index, cursor);
      } else if (!isDefault) failures.push("export_declaration_name_missing");
      continue;
    }
    if (
      !isDefault && tokens[cursor]?.type === "identifier" &&
      ["const", "let", "var"].includes(tokens[cursor].value) &&
      tokens[cursor + 1]?.type === "identifier"
    ) {
      exports.push({
        exported: tokens[cursor + 1].value,
        kind: "local",
        local: tokens[cursor + 1].value,
      });
      markDeclaration(index, cursor + 1);
      continue;
    }
    if (isDefault && tokens[cursor]?.type === "identifier") {
      exports.push({
        exported: "default",
        kind: "local",
        local: tokens[cursor].value,
      });
      markDeclaration(index, cursor);
    }
  }
  return { declarationPositions, exports, failures, imports, tokens };
}

function bindingFingerprint(binding) {
  return binding.kind === "callable"
    ? `callable:${binding.canonical}:${binding.origin}`
    : `namespace:${binding.target}`;
}

function setBinding(map, name, binding) {
  const existing = map.get(name);
  if (existing !== undefined) {
    return bindingFingerprint(existing) === bindingFingerprint(binding)
      ? false
      : "conflict";
  }
  map.set(name, binding);
  return true;
}

function resolveModuleSpecifierPath(scan, importerPath, specifier) {
  if (!specifier.startsWith(".")) return null;
  const importer = resolve(scan.repo_root ?? REPO_ROOT, importerPath);
  for (const candidate of sourceCandidates(importer, specifier)) {
    const repoPath = toRepoPath(candidate, scan.repo_root ?? REPO_ROOT);
    if (Object.hasOwn(scan.module_sources, repoPath)) return repoPath;
  }
  return null;
}

function buildGovernedBindingPlan(scan, sourcePaths, identifiers) {
  const paths = [...new Set(sourcePaths)].sort();
  const configured = [...new Set(identifiers)].sort();
  const linkage = new Map();
  const locals = new Map();
  const exported = new Map();
  const failures = [];
  for (const path of paths) {
    const parsed = parseModuleLinkage(scan.module_sources[path]);
    linkage.set(path, parsed);
    failures.push(...parsed.failures.map((failure) => `${path}:${failure}`));
    locals.set(
      path,
      new Map(configured.map((identifier) => [
        identifier,
        {
          canonical: identifier,
          kind: "callable",
          origin: `configured:${identifier}`,
        },
      ])),
    );
    exported.set(path, new Map());
  }

  let changed = true;
  for (let pass = 0; changed && pass <= paths.length * 4 + 4; pass += 1) {
    changed = false;
    for (const path of paths) {
      const parsed = linkage.get(path);
      const localBindings = locals.get(path);
      const exportedBindings = exported.get(path);
      for (const record of parsed.exports) {
        if (record.kind === "local") {
          const binding = localBindings.get(record.local);
          if (binding === undefined) continue;
          const result = setBinding(exportedBindings, record.exported, binding);
          if (result === "conflict") {
            failures.push(`${path}:governed_export_binding_conflict`);
          } else changed ||= result;
          continue;
        }
        const target = resolveModuleSpecifierPath(scan, path, record.source);
        if (target === null || !exported.has(target)) continue;
        if (record.kind === "star") {
          for (const [name, binding] of exported.get(target)) {
            if (name === "default") continue;
            const result = setBinding(exportedBindings, name, binding);
            if (result === "conflict") {
              failures.push(`${path}:governed_star_export_conflict:${name}`);
            } else changed ||= result;
          }
        } else if (record.kind === "namespace") {
          const result = setBinding(exportedBindings, record.exported, {
            kind: "namespace",
            target,
          });
          if (result === "conflict") {
            failures.push(`${path}:governed_namespace_export_conflict`);
          } else changed ||= result;
        } else {
          const binding = exported.get(target).get(record.imported);
          if (binding === undefined) continue;
          const result = setBinding(exportedBindings, record.exported, binding);
          if (result === "conflict") {
            failures.push(`${path}:governed_reexport_binding_conflict`);
          } else changed ||= result;
        }
      }
      for (const record of parsed.imports) {
        const target = resolveModuleSpecifierPath(scan, path, record.source);
        if (record.kind === "namespace") {
          if (target === null || !exported.has(target)) continue;
          const result = setBinding(localBindings, record.local, {
            kind: "namespace",
            target,
          });
          if (result === "conflict") {
            failures.push(`${path}:governed_namespace_import_conflict`);
          } else changed ||= result;
          continue;
        }
        if (target === null || !exported.has(target)) continue;
        const binding = exported.get(target).get(record.imported);
        if (binding === undefined) continue;
        const result = setBinding(localBindings, record.local, binding);
        if (result === "conflict") {
          failures.push(`${path}:governed_import_binding_conflict`);
        } else changed ||= result;
      }
    }
  }

  const plans = new Map();
  for (const path of paths) {
    const memberBindings = new Map();
    for (const [local, binding] of locals.get(path)) {
      if (binding.kind !== "namespace") continue;
      for (
        const [member, exportedBinding] of exported.get(binding.target) ?? []
      ) {
        if (exportedBinding.kind !== "callable") continue;
        memberBindings.set(`${local}.${member}`, exportedBinding);
      }
    }
    plans.set(path, {
      bindings: locals.get(path),
      declarationPositions: linkage.get(path).declarationPositions,
      memberBindings,
    });
  }
  return { failures: [...new Set(failures)].sort(), plans };
}

function isConfiguredIdentifierDeclaration(tokens, index) {
  const previous = tokens[index - 1];
  const beforePrevious = tokens[index - 2];
  if (previous?.type === "identifier" && previous.value === "function") {
    return true;
  }
  if (
    previous?.raw === "*" &&
    beforePrevious?.type === "identifier" &&
    beforePrevious.value === "function"
  ) return true;
  if (
    previous?.type === "identifier" &&
    ["const", "let", "var"].includes(previous.value)
  ) return true;
  return false;
}

function isImportBinding(tokens, index) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (tokens[cursor].raw === ";") return false;
    if (
      tokens[cursor].type === "identifier" &&
      tokens[cursor].value === "import"
    ) return true;
  }
  return false;
}

function isTypeOnlyReference(tokens, index) {
  if (
    tokens[index - 1]?.type !== "identifier" ||
    tokens[index - 1]?.value !== "typeof"
  ) return false;
  for (let cursor = index - 2; cursor >= 0; cursor -= 1) {
    if (tokens[cursor].raw === ";" || tokens[cursor].raw === "}") return false;
    if (
      tokens[cursor].type === "identifier" &&
      tokens[cursor].value === "type"
    ) return true;
  }
  return false;
}

function normalizedTokenSlice(source, tokens) {
  if (tokens.length === 0) return "";
  return normalizeExpression(
    stripComments(source.slice(tokens[0].start, tokens.at(-1).end)),
  );
}

function containingParentheses(tokens, index, pairs) {
  let selected = null;
  for (const [open, close] of pairs.openToClose.entries()) {
    if (
      open < index && index < close &&
      (selected === null || open > selected.open)
    ) {
      selected = { close, open };
    }
  }
  return selected;
}

function containingArgumentTokens(tokens, index, call, pairs) {
  let start = call.open + 1;
  for (let cursor = call.open + 1; cursor < call.close; cursor += 1) {
    const nestedClose = pairs.openToClose.get(cursor);
    if (nestedClose !== undefined && nestedClose < call.close) {
      if (cursor < index && index < nestedClose) {
        return tokens.slice(cursor, nestedClose + 1);
      }
      cursor = nestedClose;
      continue;
    }
    if (tokens[cursor].raw === ",") {
      if (index < cursor) return tokens.slice(start, cursor);
      start = cursor + 1;
    }
  }
  return tokens.slice(start, call.close);
}

function parameterDefaultReceiver(tokens, index, pairs) {
  const container = containingParentheses(tokens, index, pairs);
  if (container === null) return null;
  const callee = tokens[container.open - 1];
  const beforeCallee = tokens[container.open - 2];
  const functionDeclaration = callee?.type === "identifier" &&
    beforeCallee?.type === "identifier" &&
    beforeCallee.value === "function";
  const arrowDeclaration = tokens[container.close + 1]?.raw === "=>";
  if (!functionDeclaration && !arrowDeclaration) return null;
  const argument = containingArgumentTokens(tokens, index, container, pairs);
  const equals = argument.findIndex((token) => token.raw === "=");
  if (equals === -1 || !argument.slice(equals + 1).includes(tokens[index])) {
    return null;
  }
  return argument.slice(0, equals).find((token) =>
    token.type === "identifier"
  ) ?? null;
}

function getterReferenceContext(
  source,
  tokens,
  index,
  pairs,
  bindingName = tokens[index].value,
) {
  const identifier = bindingName;
  const next = tokens[index + 1]?.raw ?? "<eof>";
  if (["=", "+=", "-=", "*=", "/=", "&&=", "||=", "??="].includes(next)) {
    return `assignment:${identifier}${next}`;
  }
  const container = containingParentheses(tokens, index, pairs);
  if (container !== null) {
    const callee = tokens[container.open - 1];
    const beforeCallee = tokens[container.open - 2];
    const argument = containingArgumentTokens(tokens, index, container, pairs);
    const receiver = parameterDefaultReceiver(tokens, index, pairs);
    if (receiver !== null) {
      const parameterName = receiver.value;
      return `parameter_default:${parameterName}=${identifier}`;
    }
    if (callee?.type === "identifier") {
      return `call_argument:${callee.value}:${
        normalizedTokenSlice(source, argument)
      }`;
    }
    return `grouped_reference:${identifier}`;
  }
  if (tokens[index - 1]?.raw === "=") {
    const alias = tokens[index - 2]?.type === "identifier"
      ? tokens[index - 2].value
      : "<unknown>";
    return `alias:${alias}=${identifier}`;
  }
  if (next === "." || next === "?.") {
    const member = tokens[index + 2]?.value ?? tokens[index + 2]?.raw ??
      "<unknown>";
    return `indirect_member:${identifier}.${member}`;
  }
  return `reference:${identifier}`;
}

function inlineGovernedBindingPlan(source, identifiers) {
  const parsed = parseModuleLinkage(source);
  const bindings = new Map(identifiers.map((identifier) => [
    identifier,
    {
      canonical: identifier,
      kind: "callable",
      origin: `configured:${identifier}`,
    },
  ]));
  const configured = new Set(identifiers);
  for (const record of parsed.imports) {
    if (record.kind !== "binding") continue;
    if (!configured.has(record.imported) && !configured.has(record.local)) {
      continue;
    }
    bindings.set(record.local, {
      canonical: configured.has(record.imported)
        ? record.imported
        : record.local,
      kind: "callable",
      origin: `inline-import:${record.source}:${record.imported}`,
    });
  }
  return {
    bindings,
    declarationPositions: parsed.declarationPositions,
    memberBindings: new Map(),
  };
}

function scanCallBoundaryArguments(source, identifiers, options = {}) {
  const tokens = tokenizeSyntax(source);
  const pairs = tokenPairs(tokens);
  const configured = new Set(identifiers);
  const inline = inlineGovernedBindingPlan(source, identifiers);
  const bindings = new Map(options.bindings ?? inline.bindings);
  const memberBindings = new Map(
    options.memberBindings ?? inline.memberBindings,
  );
  const declarationPositions = new Set([
    ...inline.declarationPositions,
    ...(options.declarationPositions ?? []),
  ]);
  const boundaries = [];
  const consumedMemberPositions = new Set();

  let propagated = true;
  while (propagated) {
    propagated = false;
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token.type !== "identifier") continue;
      const binding = bindings.get(token.value);
      if (binding?.kind !== "callable") continue;
      const receiver = parameterDefaultReceiver(tokens, index, pairs);
      if (receiver === null) continue;
      declarationPositions.add(receiver.start);
      const result = setBinding(bindings, receiver.value, {
        ...binding,
        origin: `${binding.origin}->parameter:${receiver.value}`,
      });
      if (result === "conflict") {
        boundaries.push({
          binding: receiver.value,
          expression: "<indirect-reference>",
          identifier: binding.canonical,
          literalName: null,
          position: receiver.start,
          referenceContext: `parameter_binding_conflict:${receiver.value}`,
          unsafeReason: "indirect_or_reassigned",
        });
      } else propagated ||= result;
    }
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier") continue;
    if (consumedMemberPositions.has(token.start)) continue;
    const previous = tokens[index - 1];
    let binding = bindings.get(token.value);
    let bindingName = token.value;
    if (binding?.kind === "namespace") {
      const wrappers = groupingWrappers(tokens, index);
      let cursor = consumeGroupingCloses(
        tokens,
        index + 1,
        wrappers,
        pairs,
      );
      const member = readMember(tokens, cursor);
      if (member === null) {
        const computed = tokens[cursor]?.raw === "[" ||
          (tokens[cursor]?.raw === "?." &&
            tokens[cursor + 1]?.raw === "[");
        if (!computed) continue;
        const governed = [...memberBindings.entries()]
          .filter(([name, candidate]) =>
            name.startsWith(`${token.value}.`) &&
            candidate.kind === "callable"
          )
          .map(([, candidate]) => candidate)
          .sort((left, right) => left.canonical.localeCompare(right.canonical));
        if (governed.length === 0) continue;
        boundaries.push({
          binding: `${token.value}.[computed]`,
          expression: "<indirect-reference>",
          identifier: governed[0].canonical,
          literalName: null,
          position: token.start,
          referenceContext: `computed_namespace_member:${token.value}`,
          unsafeReason: "computed_namespace_member",
        });
        continue;
      }
      bindingName = `${token.value}.${member.name}`;
      binding = memberBindings.get(bindingName);
      if (binding?.kind !== "callable") continue;
      consumedMemberPositions.add(tokens[member.propertyIndex].start);
      cursor = consumeGroupingCloses(
        tokens,
        member.next,
        wrappers,
        pairs,
      );
      const call = readDirectCall(tokens, cursor, pairs);
      if (call === null) {
        boundaries.push({
          binding: bindingName,
          expression: "<indirect-reference>",
          identifier: binding.canonical,
          literalName: null,
          position: token.start,
          referenceContext: `namespace_member_reference:${bindingName}`,
          unsafeReason: "indirect_or_reassigned",
        });
        continue;
      }
      const argument = firstCallArgument(source, tokens, call, pairs);
      if (argument.expression.length === 0) continue;
      const literalName = argument.literalName !== null &&
          /^[A-Za-z_][A-Za-z0-9_.]*$/.test(argument.literalName)
        ? argument.literalName
        : null;
      boundaries.push({
        binding: bindingName,
        expression: argument.expression,
        identifier: binding.canonical,
        literalName,
        position: token.start,
        referenceContext: null,
        unsafeReason: null,
      });
      continue;
    }
    if (previous?.raw === "." || previous?.raw === "?.") {
      const owner = tokens[index - 2];
      if (bindings.get(owner?.value)?.kind === "namespace") continue;
      bindingName = owner?.type === "identifier"
        ? `${owner.value}.${token.value}`
        : `<member>.${token.value}`;
      binding = memberBindings.get(bindingName) ??
        (configured.has(token.value)
          ? {
            canonical: token.value,
            kind: "callable",
            origin: `unproven-member:${bindingName}`,
          }
          : undefined);
    }
    if (binding?.kind !== "callable") continue;
    const identifier = binding.canonical;
    if (declarationPositions.has(token.start)) continue;
    if (isConfiguredIdentifierDeclaration(tokens, index)) continue;
    if (isTypeOnlyReference(tokens, index)) {
      continue;
    }
    if (
      tokens[index + 1]?.raw === ":" ||
      (tokens[index + 1]?.raw === "?" && tokens[index + 2]?.raw === ":")
    ) continue;

    const wrappers = groupingWrappers(tokens, index);
    const cursor = consumeGroupingCloses(tokens, index + 1, wrappers, pairs);
    const call = readDirectCall(tokens, cursor, pairs);
    if (call === null) {
      boundaries.push({
        binding: bindingName,
        expression: "<indirect-reference>",
        identifier,
        literalName: null,
        position: token.start,
        referenceContext: getterReferenceContext(
          source,
          tokens,
          index,
          pairs,
          bindingName,
        ),
        unsafeReason: "indirect_or_reassigned",
      });
      continue;
    }
    const argument = firstCallArgument(source, tokens, call, pairs);
    if (argument.expression.length === 0) continue;
    const literalName = argument.literalName !== null &&
        /^[A-Za-z_][A-Za-z0-9_.]*$/.test(argument.literalName)
      ? argument.literalName
      : null;
    boundaries.push({
      binding: bindingName,
      expression: argument.expression,
      identifier,
      literalName,
      position: token.start,
      referenceContext: null,
      unsafeReason: null,
    });
  }
  return boundaries;
}

/** Extract every configured getter-boundary first argument. */
export function findCallBoundaryArguments(source, identifiers) {
  const boundaries = scanCallBoundaryArguments(source, identifiers);
  for (const token of tokenizeSyntax(source)) {
    if (token.type !== "template") continue;
    for (const expression of templateExpressionSources(token.raw)) {
      boundaries.push(...findCallBoundaryArguments(expression, identifiers));
    }
  }
  return boundaries.sort((left, right) =>
    left.identifier.localeCompare(right.identifier) ||
    (left.binding ?? "").localeCompare(right.binding ?? "") ||
    left.expression.localeCompare(right.expression) ||
    (left.unsafeReason ?? "").localeCompare(right.unsafeReason ?? "") ||
    left.position - right.position
  );
}

/** Extract exact public env/bundle-field literals supplied to getter boundaries. */
export function findLiteralCallNames(source, identifiers) {
  return [
    ...new Set(
      findCallBoundaryArguments(source, identifiers)
        .map((boundary) => boundary.literalName)
        .filter((name) => name !== null),
    ),
  ].sort();
}

function listFunctionEntrypoints(functionsRoot = FUNCTIONS_ROOT) {
  return readdirSync(functionsRoot, { withFileTypes: true })
    .filter((entry) =>
      entry.isDirectory() &&
      !entry.name.startsWith("_") &&
      existsSync(resolve(functionsRoot, entry.name, "index.ts"))
    )
    .map((
      entry,
    ) => [entry.name, resolve(functionsRoot, entry.name, "index.ts")])
    .sort(([left], [right]) => left.localeCompare(right));
}

export function buildImportClosure(entrypoint, repoRoot = REPO_ROOT) {
  const pending = [entrypoint];
  const visited = new Set();
  const failures = [];
  while (pending.length > 0) {
    const current = pending.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    let source;
    try {
      source = readFileSync(current, "utf8");
    } catch {
      failures.push(`${toRepoPath(current, repoRoot)}:source_unreadable`);
      continue;
    }
    const imports = importSpecifiers(source);
    failures.push(
      ...imports.failures.map((failure) =>
        `${toRepoPath(current, repoRoot)}:${failure}`
      ),
    );
    for (const specifier of imports.specifiers) {
      if (!specifier.startsWith(".")) continue;
      const resolved = sourceCandidates(current, specifier).find((candidate) =>
        existsSync(candidate) && statSync(candidate).isFile()
      );
      if (!resolved) {
        failures.push(
          `${
            toRepoPath(current, repoRoot)
          }:relative_import_missing:${specifier}`,
        );
      } else if (isProductionSource(resolved)) pending.push(resolved);
    }
  }
  return { files: [...visited].sort(), failures };
}

export function scanFunctionSources({
  functionsRoot = FUNCTIONS_ROOT,
  repoRoot = REPO_ROOT,
} = {}) {
  const functions = {};
  const moduleReads = {};
  const moduleSources = {};
  const failures = [];
  for (const [name, entrypoint] of listFunctionEntrypoints(functionsRoot)) {
    const closure = buildImportClosure(entrypoint, repoRoot);
    failures.push(...closure.failures.map((failure) => `${name}:${failure}`));
    const literalNames = new Set();
    for (const path of closure.files) {
      const repoPath = toRepoPath(path, repoRoot);
      if (!Object.hasOwn(moduleReads, repoPath)) {
        moduleSources[repoPath] = readFileSync(path, "utf8");
        moduleReads[repoPath] = findEnvReads(moduleSources[repoPath]);
      }
      for (const read of moduleReads[repoPath]) {
        if (read.kind === "literal") literalNames.add(read.name);
        else if (read.kind === "unsafe") {
          failures.push(`${name}:${repoPath}:${read.reason}`);
        }
      }
    }
    functions[name] = {
      closure: closure.files.map((path) => toRepoPath(path, repoRoot)),
      literal_names: [...literalNames].sort(),
    };
  }
  return {
    failures,
    functions,
    module_reads: moduleReads,
    module_sources: moduleSources,
    repo_root: repoRoot,
  };
}

function contractNames(record) {
  return [
    ...record.required_top_level,
    ...record.optional_top_level,
    ...record.migration_fallback_top_level,
    ...Object.keys(record.required_bundle_fields),
  ];
}

function validateBundleFields(record, manifestByName, functionName, failures) {
  if (
    record.required_bundle_fields === null ||
    typeof record.required_bundle_fields !== "object" ||
    Array.isArray(record.required_bundle_fields)
  ) {
    failures.push(`${functionName}:required_bundle_fields_invalid`);
    return;
  }
  const bundleNames = Object.keys(record.required_bundle_fields);
  if (JSON.stringify(bundleNames) !== JSON.stringify([...bundleNames].sort())) {
    failures.push(`${functionName}:required_bundle_names_not_sorted`);
  }
  for (
    const [bundleName, fields] of Object.entries(record.required_bundle_fields)
  ) {
    const manifestRecord = manifestByName.get(bundleName);
    if (!manifestRecord || !Array.isArray(manifestRecord.bundle_fields)) {
      failures.push(`${functionName}:${bundleName}:bundle_manifest_missing`);
      continue;
    }
    if (!isSortedUniqueStrings(fields)) {
      failures.push(`${functionName}:${bundleName}:bundle_fields_invalid`);
      continue;
    }
    const governed = new Set(
      manifestRecord.bundle_fields.map((field) => field.name),
    );
    for (const field of fields) {
      if (!governed.has(field)) {
        failures.push(
          `${functionName}:${bundleName}:${field}:bundle_field_unowned`,
        );
      }
      const combinedReaders = manifestRecord.readers
        .filter((reader) =>
          typeof reader === "string" && existsSync(resolve(REPO_ROOT, reader))
        )
        .flatMap((reader) => {
          const absolute = resolve(REPO_ROOT, reader);
          if (statSync(absolute).isFile()) return [absolute];
          return [];
        })
        .map((reader) => readFileSync(reader, "utf8"))
        .join("\n");
      if (!combinedReaders.includes(field)) {
        failures.push(
          `${functionName}:${bundleName}:${field}:bundle_reader_missing`,
        );
      }
    }
  }
}

export function validateFunctionEnvContract({ contract, manifest, scan }) {
  const failures = [...scan.failures];
  if (!exactKeys(contract, ROOT_KEYS)) {
    return [...failures, "contract:root_keys_invalid"];
  }
  if (contract.schema_version !== 1) {
    failures.push("contract:schema_version_invalid");
  }
  if (!isSortedUniqueStrings(contract.platform_managed, ENV_NAME)) {
    failures.push("contract:platform_managed_invalid");
  }
  if (!isSortedUniqueStrings(contract.non_secret_runtime_config, ENV_NAME)) {
    failures.push("contract:non_secret_runtime_config_invalid");
  }
  if (!exactKeys(contract.remediation, REMEDIATION_KEYS)) {
    failures.push("contract:remediation_invalid");
  } else {
    if (contract.remediation.issue !== 2241) {
      failures.push("contract:remediation_issue");
    }
    if (contract.remediation.production_ref !== PRODUCTION_REF) {
      failures.push("contract:remediation_project");
    }
    if (contract.remediation.expires_after_merge_hours !== 72) {
      failures.push("contract:remediation_expiry");
    }
    if (
      JSON.stringify(contract.remediation.allowed_extra_live_names) !==
        JSON.stringify([...ISSUE_2241_EXTRA_NAMES].sort())
    ) failures.push("contract:remediation_extra_names");
    if (
      JSON.stringify(contract.remediation.selected_functions) !==
        JSON.stringify([...ISSUE_2241_FUNCTIONS].sort())
    ) failures.push("contract:remediation_functions");
  }

  const manifestNames = new Set(manifest.secrets?.map((record) => record.name));
  const manifestByName = new Map(
    manifest.secrets?.map((record) => [record.name, record]) ?? [],
  );
  const platformNames = new Set(contract.platform_managed ?? []);
  const runtimeNames = new Set(contract.non_secret_runtime_config ?? []);
  const scannedFunctions = Object.keys(scan.functions).sort();
  if (
    contract.functions === null ||
    typeof contract.functions !== "object" ||
    Array.isArray(contract.functions) ||
    JSON.stringify(Object.keys(contract.functions).sort()) !==
      JSON.stringify(scannedFunctions)
  ) failures.push("contract:function_set_mismatch");

  for (const functionName of scannedFunctions) {
    const record = contract.functions?.[functionName];
    if (!exactKeys(record, FUNCTION_KEYS)) {
      failures.push(`${functionName}:contract_keys_invalid`);
      continue;
    }
    for (
      const key of [
        "required_top_level",
        "optional_top_level",
        "migration_fallback_top_level",
      ]
    ) {
      if (!isSortedUniqueStrings(record[key], ENV_NAME)) {
        failures.push(`${functionName}:${key}_invalid`);
      }
    }
    const categories = contractNames(record);
    if (new Set(categories).size !== categories.length) {
      failures.push(`${functionName}:classification_overlap`);
    }
    for (const required of record.required_top_level) {
      if (!manifestNames.has(required)) {
        failures.push(`${functionName}:${required}:required_manifest_missing`);
      }
    }
    validateBundleFields(record, manifestByName, functionName, failures);
    const classified = new Set([
      ...categories,
      ...platformNames,
      ...runtimeNames,
    ]);
    for (const name of scan.functions[functionName].literal_names) {
      if (!classified.has(name)) {
        failures.push(`${functionName}:${name}:unclassified_literal`);
      }
    }
  }

  if (
    contract.shared_modules === null ||
    typeof contract.shared_modules !== "object" ||
    Array.isArray(contract.shared_modules)
  ) failures.push("contract:shared_modules_invalid");
  const reachableModules = new Set(
    Object.values(scan.functions).flatMap((record) => record.closure),
  );
  for (const [path, reads] of Object.entries(scan.module_reads)) {
    const dynamic = reads
      .filter((read) => read.kind === "dynamic")
      .map((read) => read.expression)
      .sort();
    if (dynamic.length === 0 || !reachableModules.has(path)) continue;
    const declaration = contract.shared_modules?.[path];
    if (!validSharedModuleKeys(declaration)) {
      failures.push(`${path}:dynamic_getter_contract_missing`);
      continue;
    }
    if (
      !isSortedUniqueStrings(declaration.dynamic_getters) ||
      JSON.stringify(declaration.dynamic_getters) !==
        JSON.stringify([...new Set(dynamic)].sort())
    ) failures.push(`${path}:dynamic_getter_contract_mismatch`);
    if (!isSortedUniqueStrings(declaration.allowed_top_level, ENV_NAME)) {
      failures.push(`${path}:dynamic_getter_allowed_top_level_invalid`);
    }
    for (
      const key of ["closure_call_identifiers", "local_call_identifiers"]
    ) {
      if (!isSortedUniqueStrings(declaration[key], /^[A-Za-z_$][\w$]*$/)) {
        failures.push(`${path}:${key}_invalid`);
      }
    }
    const configuredIdentifiers = new Set([
      ...(declaration.local_call_identifiers ?? []),
      ...(declaration.closure_call_identifiers ?? []),
    ]);
    const allowedCallExpressions = declaration.allowed_call_expressions ?? {};
    if (
      allowedCallExpressions === null ||
      typeof allowedCallExpressions !== "object" ||
      Array.isArray(allowedCallExpressions) ||
      JSON.stringify(Object.keys(allowedCallExpressions)) !==
        JSON.stringify(Object.keys(allowedCallExpressions).sort())
    ) {
      failures.push(`${path}:dynamic_call_expression_contract_invalid`);
      continue;
    }
    for (
      const [identifier, expressions] of Object.entries(allowedCallExpressions)
    ) {
      if (
        !configuredIdentifiers.has(identifier) ||
        !isSortedUniqueStrings(expressions) ||
        expressions.some((expression) =>
          expression !== normalizeExpression(expression)
        )
      ) failures.push(`${path}:${identifier}:dynamic_call_expression_invalid`);
    }
    const allowedIdentifierReferences =
      declaration.allowed_identifier_references ?? {};
    if (
      allowedIdentifierReferences === null ||
      typeof allowedIdentifierReferences !== "object" ||
      Array.isArray(allowedIdentifierReferences) ||
      JSON.stringify(Object.keys(allowedIdentifierReferences)) !==
        JSON.stringify(Object.keys(allowedIdentifierReferences).sort())
    ) {
      failures.push(`${path}:dynamic_getter_reference_contract_invalid`);
      continue;
    }
    for (
      const [identifier, references] of Object.entries(
        allowedIdentifierReferences,
      )
    ) {
      if (
        !configuredIdentifiers.has(identifier) ||
        !isSortedUniqueStrings(references) ||
        references.some((reference) =>
          !IDENTIFIER_REFERENCE_SITE.test(reference)
        ) ||
        references.some((reference) =>
          reference !== normalizeExpression(reference)
        )
      ) failures.push(`${path}:${identifier}:dynamic_getter_reference_invalid`);
    }
    if (
      declaration.allowed_bundle_fields === null ||
      typeof declaration.allowed_bundle_fields !== "object" ||
      Array.isArray(declaration.allowed_bundle_fields) ||
      JSON.stringify(Object.keys(declaration.allowed_bundle_fields)) !==
        JSON.stringify(Object.keys(declaration.allowed_bundle_fields).sort())
    ) {
      failures.push(`${path}:dynamic_getter_bundle_fields_invalid`);
      continue;
    }
    const allowed = new Set(declaration.allowed_top_level ?? []);
    for (
      const [bundleName, fields] of Object.entries(
        declaration.allowed_bundle_fields ?? {},
      )
    ) {
      const manifestRecord = manifestByName.get(bundleName);
      const governed = new Set(
        manifestRecord?.bundle_fields?.map((field) => field.name) ?? [],
      );
      if (!manifestRecord || !isSortedUniqueStrings(fields)) {
        failures.push(`${path}:${bundleName}:dynamic_bundle_invalid`);
        continue;
      }
      for (const field of fields) {
        if (!governed.has(field)) {
          failures.push(`${path}:${bundleName}:${field}:dynamic_field_unowned`);
        }
        allowed.add(field);
      }
    }
    const closurePaths = new Set();
    const boundaryNames = new Set();
    for (const read of reads) {
      if (read.kind !== "dynamic") continue;
      for (
        const literal of read.expression.matchAll(
          /(?:"([A-Z][A-Z0-9_]*|app\.qr_token_pepper)"|'([A-Z][A-Z0-9_]*|app\.qr_token_pepper)')/g,
        )
      ) boundaryNames.add(literal[1] ?? literal[2]);
    }
    for (const functionRecord of Object.values(scan.functions)) {
      if (!functionRecord.closure.includes(path)) continue;
      for (const closurePath of functionRecord.closure) {
        closurePaths.add(closurePath);
      }
    }
    const closureBindingPlan = buildGovernedBindingPlan(
      scan,
      [...closurePaths],
      declaration.closure_call_identifiers ?? [],
    );
    const localBindingPlan = buildGovernedBindingPlan(
      scan,
      [path],
      declaration.local_call_identifiers ?? [],
    );
    failures.push(
      ...closureBindingPlan.failures,
      ...localBindingPlan.failures,
    );
    const scanPlan = new Map();
    for (const closurePath of closurePaths) {
      const closurePlan = closureBindingPlan.plans.get(closurePath);
      if (closurePlan !== undefined) {
        scanPlan.set(closurePath, {
          bindings: new Map(closurePlan.bindings),
          declarationPositions: new Set(closurePlan.declarationPositions),
          identifiers: new Set(declaration.closure_call_identifiers ?? []),
          memberBindings: new Map(closurePlan.memberBindings),
        });
      }
    }
    const localPlan = localBindingPlan.plans.get(path);
    if (localPlan !== undefined) {
      const combined = scanPlan.get(path) ?? {
        bindings: new Map(),
        declarationPositions: new Set(),
        identifiers: new Set(),
        memberBindings: new Map(),
      };
      for (const [name, binding] of localPlan.bindings) {
        const result = setBinding(combined.bindings, name, binding);
        if (result === "conflict") {
          failures.push(`${path}:local_closure_binding_conflict:${name}`);
        }
      }
      for (const [name, binding] of localPlan.memberBindings) {
        const result = setBinding(combined.memberBindings, name, binding);
        if (result === "conflict") {
          failures.push(
            `${path}:local_closure_member_binding_conflict:${name}`,
          );
        }
      }
      for (const position of localPlan.declarationPositions) {
        combined.declarationPositions.add(position);
      }
      for (const identifier of declaration.local_call_identifiers ?? []) {
        combined.identifiers.add(identifier);
      }
      scanPlan.set(path, combined);
    }
    const boundaries = [];
    for (const [sourcePath, plan] of scanPlan) {
      boundaries.push(
        ...scanCallBoundaryArguments(
          scan.module_sources[sourcePath],
          [...plan.identifiers],
          plan,
        ).map((boundary) => ({ ...boundary, sourcePath })),
      );
    }
    const observedExpressions = new Set();
    const observedReferences = [];
    for (const boundary of boundaries) {
      if (boundary.unsafeReason !== null) {
        observedReferences.push(
          `${boundary.identifier}:${boundary.sourcePath}@${boundary.position}:${
            boundary.binding ?? boundary.identifier
          }:${boundary.referenceContext}`,
        );
      } else if (boundary.literalName !== null) {
        boundaryNames.add(boundary.literalName);
      } else {
        observedExpressions.add(
          `${boundary.identifier}:${boundary.expression}`,
        );
      }
    }
    const declaredExpressions = new Set(
      Object.entries(allowedCallExpressions).flatMap((
        [identifier, expressions],
      ) => expressions.map((expression) => `${identifier}:${expression}`)),
    );
    const declaredReferences = (
      Object.entries(allowedIdentifierReferences).flatMap(
        ([identifier, references]) =>
          references.map((reference) => `${identifier}:${reference}`),
      )
    ).sort();
    observedReferences.sort();
    for (const expression of observedExpressions) {
      if (!declaredExpressions.has(expression)) {
        failures.push(
          `${path}:${expression}:dynamic_call_expression_undeclared`,
        );
      }
    }
    for (const expression of declaredExpressions) {
      if (!observedExpressions.has(expression)) {
        failures.push(`${path}:${expression}:dynamic_call_expression_unused`);
      }
    }
    const observedReferenceCounts = new Map();
    const declaredReferenceCounts = new Map();
    for (const reference of observedReferences) {
      observedReferenceCounts.set(
        reference,
        (observedReferenceCounts.get(reference) ?? 0) + 1,
      );
    }
    for (const reference of declaredReferences) {
      declaredReferenceCounts.set(
        reference,
        (declaredReferenceCounts.get(reference) ?? 0) + 1,
      );
    }
    for (const [reference, count] of observedReferenceCounts) {
      const declaredCount = declaredReferenceCounts.get(reference) ?? 0;
      if (count > declaredCount) {
        failures.push(
          `${path}:${reference}:dynamic_getter_reference_undeclared:${
            count - declaredCount
          }`,
        );
      }
    }
    for (const [reference, count] of declaredReferenceCounts) {
      const observedCount = observedReferenceCounts.get(reference) ?? 0;
      if (count > observedCount) {
        failures.push(
          `${path}:${reference}:dynamic_getter_reference_unused:${
            count - observedCount
          }`,
        );
      }
    }
    for (const name of boundaryNames) {
      if (!allowed.has(name)) {
        failures.push(`${path}:${name}:dynamic_getter_name_undeclared`);
      }
    }
  }
  for (const path of Object.keys(contract.shared_modules ?? {})) {
    if (!reachableModules.has(path)) {
      failures.push(`${path}:shared_module_unreachable`);
    }
  }
  return [...new Set(failures)].sort();
}

export function auditFunctionSecretContract({
  contractPath = DEFAULT_CONTRACT,
  manifestPath = DEFAULT_MANIFEST,
  functionsRoot = FUNCTIONS_ROOT,
  repoRoot = REPO_ROOT,
} = {}) {
  const contract = JSON.parse(readFileSync(contractPath, "utf8"));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const scan = scanFunctionSources({ functionsRoot, repoRoot });
  return validateFunctionEnvContract({ contract, manifest, scan });
}

function main() {
  const failures = auditFunctionSecretContract();
  if (failures.length > 0) {
    console.error(`FAIL function-secret-contract (${failures.length})`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("PASS function-secret-contract");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
