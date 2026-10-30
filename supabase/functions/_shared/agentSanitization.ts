// Issue #3355 — one sanitisation boundary for Ari training, quality cases and
// browser research. The improvement archive receives only this output; raw
// customer messages remain in the owner-scoped conversation tables.

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?<![A-Za-z0-9])\+?\d[\d\s().-]{7,}\d(?![A-Za-z0-9])/g;
const LONG_DIGITS = /\b\d{9,19}\b/g;
const UUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const JWT =
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const SECRET_ASSIGNMENT =
  /\b(api[_-]?key|secret|password|passcode|token|authorization)\s*[:=]\s*[^\s,;]+/gi;
const PRIVATE_QUERY = /([?&](?:token|key|secret|signature|code)=)[^&#\s]+/gi;
const MAX_TEXT = 12_000;
const MAX_ARRAY = 80;
const MAX_DEPTH = 7;

const USER_FACING_DIAGNOSTIC_COPY: Readonly<Record<string, string>> = {
  RESEARCH_NOT_CONFIGURED: "Public research is temporarily unavailable",
  RESEARCH_UNGROUNDED: "No reliable public sources were found",
  TOOL_TIMEOUT: "This step took too long to finish",
  TOOL_UNAVAILABLE: "This capability is temporarily unavailable",
  TOOL_FAILED: "This step could not be completed",
  PERMISSION_DENIED: "Your current access does not allow this step",
  INVALID_ARGS: "This step needs different or additional information",
  UNAUTHENTICATED: "Your session needs to be refreshed",
  TURN_STOPPED: "This step was stopped",
};

const INTERNAL_DIAGNOSTIC_SLUG =
  /\b(?:[A-Z0-9]+_)+(?:ERROR|FAILED|UNAVAILABLE|NOT_CONFIGURED|DENIED|TIMEOUT|INVALID_ARGS|REQUIRED|STOPPED|UNAUTHENTICATED)(?:_[A-Z0-9]+)*\b/g;
const INTERNAL_CODE_SLUG = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

export type SanitizationFinding =
  | "email"
  | "phone"
  | "long_digits"
  | "uuid"
  | "credential"
  | "private_query"
  | "truncated";

export interface SanitizedText {
  text: string;
  findings: SanitizationFinding[];
}

function apply(
  value: string,
  pattern: RegExp,
  replacement: string,
  finding: SanitizationFinding,
  findings: Set<SanitizationFinding>,
): string {
  pattern.lastIndex = 0;
  if (!pattern.test(value)) return value;
  findings.add(finding);
  pattern.lastIndex = 0;
  return value.replace(pattern, replacement);
}

function applyPhoneRedaction(
  value: string,
  findings: Set<SanitizationFinding>,
): string {
  const protectedDates = new Map<string, string>();
  const withProtectedDates = value.replace(
    /\b\d{4}-\d{2}-\d{2}\b/g,
    (date) => {
      // The private-use delimiters and letter-only key cannot be consumed by
      // the phone matcher. Repeating the letter keeps every token unique
      // without introducing digits that could look like another phone.
      const token = `\uE000${"D".repeat(protectedDates.size + 1)}\uE001`;
      protectedDates.set(token, date);
      return token;
    },
  );
  PHONE.lastIndex = 0;
  let redacted = false;
  let text = withProtectedDates.replace(PHONE, () => {
    redacted = true;
    return "[phone removed]";
  });
  for (const [token, date] of protectedDates) {
    text = text.replaceAll(token, date);
  }
  if (redacted) findings.add("phone");
  return text;
}

export function sanitizeAriText(input: unknown): SanitizedText {
  const findings = new Set<SanitizationFinding>();
  let text = typeof input === "string"
    ? input
    : input == null
    ? ""
    : String(input);
  text = apply(text, JWT, "[credential removed]", "credential", findings);
  text = apply(text, SECRET_ASSIGNMENT, "$1=[removed]", "credential", findings);
  text = apply(text, PRIVATE_QUERY, "$1[removed]", "private_query", findings);
  text = apply(text, EMAIL, "[email removed]", "email", findings);
  text = applyPhoneRedaction(text, findings);
  text = apply(text, UUID, "[identifier removed]", "uuid", findings);
  text = apply(text, LONG_DIGITS, "[number removed]", "long_digits", findings);
  if (text.length > MAX_TEXT) {
    text = `${text.slice(0, MAX_TEXT)}\n[content truncated]`;
    findings.add("truncated");
  }
  return { text, findings: [...findings] };
}

/**
 * Public research may legitimately contain public contact details, dates and
 * identifiers that Ari needs to compare with supplied materials. Keep those
 * facts in the live, caller-scoped turn while still removing credentials and
 * private query tokens. The training archive uses the stricter boundary above.
 */
export function sanitizeAriPublicText(input: unknown): SanitizedText {
  const findings = new Set<SanitizationFinding>();
  let text = typeof input === "string"
    ? input
    : input == null
    ? ""
    : String(input);
  text = apply(
    text,
    JWT,
    "[credential removed]",
    "credential",
    findings,
  );
  text = apply(
    text,
    SECRET_ASSIGNMENT,
    "$1=[removed]",
    "credential",
    findings,
  );
  text = apply(
    text,
    PRIVATE_QUERY,
    "$1[removed]",
    "private_query",
    findings,
  );
  if (text.length > 48_000) {
    text = `${text.slice(0, 48_000)}\n[content truncated]`;
    findings.add("truncated");
  }
  return { text, findings: [...findings] };
}

/**
 * Error identifiers are useful in the Improvement Lab and trace payloads, but
 * never in Ari's host-facing prose. This final response-boundary sanitizer is
 * deliberately independent of the model and rendition chosen for the turn.
 */
export function sanitizeAriUserFacingDiagnostics(input: unknown): string {
  let text = sanitizeAriPublicText(input).text;
  // Models sometimes echo implementation vocabulary from tool descriptions.
  // Hosts should see the capability and destination, never the function name,
  // UUID route, or configuration slug that powers it.
  text = text
    .replace(
      /\b(?:using|with)\s+the\s+tool\s+`?create_site_draft`?/gi,
      "by preparing a website draft",
    )
    .replace(/`?create_site_draft`?/gi, "prepare a website draft")
    .replace(
      /`?\/brand\/[0-9a-f-]{36}\/website`?/gi,
      "the Website screen",
    )
    .replace(
      /`?\/brand\/[0-9a-f-]{36}(?:\/[a-z0-9/_-]+)?`?/gi,
      "the relevant brand screen",
    );
  text = text.replace(/\s*\(([A-Z0-9_]+)\)/g, (match, code: string) => {
    INTERNAL_DIAGNOSTIC_SLUG.lastIndex = 0;
    return USER_FACING_DIAGNOSTIC_COPY[code] ||
        INTERNAL_DIAGNOSTIC_SLUG.test(code)
      ? ""
      : match;
  });
  for (const [code, copy] of Object.entries(USER_FACING_DIAGNOSTIC_COPY)) {
    text = text.replace(new RegExp(`\\b${code}\\b`, "g"), copy);
  }
  INTERNAL_DIAGNOSTIC_SLUG.lastIndex = 0;
  text = text.replace(
    INTERNAL_DIAGNOSTIC_SLUG,
    (code) => USER_FACING_DIAGNOSTIC_COPY[code] ?? "This step needs attention",
  );
  // An ALL_CAPS_WITH_UNDERSCORES token is an implementation identifier, not
  // product copy. The allowlist above preserves the most useful explanation;
  // every unknown code still fails closed to calm, user-facing language.
  text = text.replace(
    INTERNAL_CODE_SLUG,
    (code) => USER_FACING_DIAGNOSTIC_COPY[code] ?? "This step needs attention",
  );
  text = text.replace(
    /`?\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b`?/g,
    (slug) => slug.replace(/`/g, "").split("_").join(" "),
  );
  return text
    .replace(/[^\S\r\n]{2,}/g, " ")
    .replace(/\s+([.,:;!?])/g, "$1")
    .trim();
}

export function sanitizeAriValue(
  input: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (
    input == null || typeof input === "boolean" || typeof input === "number"
  ) return input;
  if (typeof input === "string") return sanitizeAriText(input).text;
  if (depth >= MAX_DEPTH) return "[nested content removed]";
  if (typeof input !== "object") return sanitizeAriText(input).text;
  if (seen.has(input)) return "[circular content removed]";
  seen.add(input);
  if (Array.isArray(input)) {
    return input.slice(0, MAX_ARRAY).map((entry) =>
      sanitizeAriValue(entry, depth + 1, seen)
    );
  }
  const output: Record<string, unknown> = {};
  for (
    const [key, value] of Object.entries(input as Record<string, unknown>)
      .slice(0, MAX_ARRAY)
  ) {
    if (
      /^(authorization|cookie|password|passcode|secret|token|bank|account_number|card_number)$/i
        .test(key)
    ) {
      output[key] = "[removed]";
      continue;
    }
    output[key] = sanitizeAriValue(value, depth + 1, seen);
  }
  return output;
}

export function containsSensitiveAriMaterial(input: unknown): boolean {
  const serialized = typeof input === "string"
    ? input
    : JSON.stringify(input ?? "");
  return sanitizeAriText(serialized).findings.some((finding) =>
    finding !== "truncated"
  );
}
