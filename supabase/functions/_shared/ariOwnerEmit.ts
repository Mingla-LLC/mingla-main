/**
 * Issue #4637 — the final boundary for every string an Ari owner can see.
 *
 * Model prose is reduced sentence-by-sentence when it imitates a tool call,
 * engine diagnostics or JSON. Server labels fail closed: a bad card label is
 * dropped instead of exposing the backing field name.
 */
import {
  lintAriCopy,
  safeAriCopyFallback,
  softenAriHeadings,
} from "./agentCopyLint.ts";
import { isPseudoToolCallText } from "./agentGeminiContents.ts";
import {
  gateOwnerProse,
  isOwnerSafe,
  isOwnerSafeValue,
  OWNER_PROSE_FALLBACK,
} from "./ariOwnerCopy.ts";

export type AriOwnerTextKind =
  | "reply"
  | "stream_chunk"
  | "activity_label"
  | "card_label"
  | "card_value"
  | "failure"
  | "suggestion"
  | "work_trail";

const ENGINE_PREFIX =
  /^\s*(?:Truth|Check|Scope kind|Value type|Dest|Targets)\s*:/i;
const JSON_SPAN = /(?:^|[\s(])\{\s*"[^"\n]+"\s*:|\[\s*\{\s*"/;
const UPPER_SNAKE = /\b[A-Z]{2,}(?:_[A-Z0-9]{2,})+\b/;

export function ownerEmissionViolation(text: string): boolean {
  return isPseudoToolCallText(text) || ENGINE_PREFIX.test(text) ||
    JSON_SPAN.test(text) || UPPER_SNAKE.test(text);
}

function safeSentences(text: string): string {
  return text.split("\n").flatMap((line) => {
    if (!line.trim()) return [""];
    return line.split(/(?<=[.!?])\s+(?=\S)/).filter((sentence) =>
      !ownerEmissionViolation(sentence)
    );
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function ownerSafeFallback(
  kind: AriOwnerTextKind,
  candidate: string | undefined,
): string {
  const value = String(candidate ?? "").trim();
  if (!value || ownerEmissionViolation(value)) {
    return kind === "card_label" || kind === "activity_label"
      ? ""
      : OWNER_PROSE_FALLBACK;
  }
  if (kind === "card_label" || kind === "activity_label") {
    return isOwnerSafe(value, "label") ? value : "";
  }
  if (!isOwnerSafe(value, "prose")) return OWNER_PROSE_FALLBACK;
  return gateOwnerProse(value, {
    fallback: OWNER_PROSE_FALLBACK,
    surface: "owner_safe_fallback",
  });
}

export function emitOwnerText(
  kind: AriOwnerTextKind,
  text: string,
  options: {
    fallback?: string;
    surface?: string;
    researchExpected?: boolean;
    hasSources?: boolean;
  } = {},
): string {
  const input = String(text ?? "").trim();
  const surface = options.surface ?? kind;
  const fallback = ownerSafeFallback(kind, options.fallback);
  if (kind === "card_value") {
    return input && !ownerEmissionViolation(input) &&
        isOwnerSafe(input, "prose") && isOwnerSafeValue(input)
      ? input
      : "";
  }
  if (kind === "card_label" || kind === "activity_label") {
    return input && !ownerEmissionViolation(input) &&
        isOwnerSafe(input, "label")
      ? input
      : fallback;
  }

  const reduced = safeSentences(softenAriHeadings(input));
  if (!reduced) return fallback;
  const lint = lintAriCopy(reduced, {
    researchExpected: options.researchExpected,
    hasSources: options.hasSources,
  });
  const linted = lint.ok ? reduced : safeAriCopyFallback(lint.violations);
  return gateOwnerProse(linted, {
    fallback,
    surface,
  });
}
