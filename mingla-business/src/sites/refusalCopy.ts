/**
 * #4453 Website workspace — the owner's sentence for a refused change.
 *
 * Core relays what Studio said about a refusal: which limit (`max`, `min`)
 * and, for a change that did not pass its checks, the `problems` it found.
 * This turns that into one plain sentence. A problem is shown only when it
 * already reads as plain words; anything that names a field of the request
 * (`list_ops[0].values`, `media_id`) is for engineers and never shown.
 */
export type RefusalDetail = {
  max?: number;
  min?: number;
  problems?: readonly string[];
};

const PROBLEM_MAX = 160;
// Request field names, indexes and code: not an owner's words.
const NOT_PLAIN = /[_[\]{}<>`=\\|]|\b[a-z]+\.[a-z0-9]+\b|\b(?:blocks?|variants?|tokens?|revisions?|uuid|op)\b/i;

const count = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10_000 ? value : null);

/** The detail Core sent with a refusal, bounded and typed (null: none). */
export function refusalDetailFrom(raw: unknown): RefusalDetail | null {
  if (!raw || typeof raw !== "object") return null;
  const error = raw as Record<string, unknown>;
  const detail: { max?: number; min?: number; problems?: string[] } = {};
  const max = count(error.max);
  const min = count(error.min);
  if (max !== null) detail.max = max;
  if (min !== null) detail.min = min;
  if (Array.isArray(error.problems)) {
    const problems = error.problems.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean).slice(0, 8);
    if (problems.length) detail.problems = problems;
  }
  return Object.keys(detail).length ? detail : null;
}

/** A problem as a sentence the owner can read, or null when it is not plain words. */
export function plainProblem(problem: string): string | null {
  const text = problem.trim().replace(/\s+/g, " ");
  if (text.length < 8 || text.length > PROBLEM_MAX || !text.includes(" ") || NOT_PLAIN.test(text)) return null;
  const sentence = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

const rows = (n: number) => (n === 1 ? "1 row" : `${n} rows`);

/**
 * The sentence for a refusal code: the code's own sentence (`base`), made
 * exact where Core said how much is allowed, or what was wrong.
 */
export function refusalSentence(code: string, base: string, detail: RefusalDetail | null): string {
  if (!detail) return base;
  switch (code) {
    case "VALUE_TOO_LONG":
      return detail.max !== undefined ? `That is too long for this spot. Keep it to ${detail.max} characters.` : base;
    case "LIST_LIMIT_REACHED":
      return detail.max !== undefined ? `That list holds ${rows(detail.max)} at most. Remove a row before adding another.` : base;
    case "LIST_ROW_REQUIRED":
      return detail.min !== undefined ? `That list needs at least ${rows(detail.min)}, so this one stays.` : base;
    case "SECTION_LIMIT_REACHED":
      return detail.max !== undefined ? `This page holds ${detail.max} sections at most. Remove one first.` : base;
    case "VALIDATION_FAILED":
    case "SECTION_CANNOT_BE_REMOVED": {
      const plain = (detail.problems ?? []).map(plainProblem).filter((entry): entry is string => entry !== null).slice(0, 2);
      if (!plain.length) return base;
      return code === "VALIDATION_FAILED" ? `That change wasn’t made. ${plain.join(" ")}` : `${base} ${plain.join(" ")}`;
    }
    default:
      return base;
  }
}
