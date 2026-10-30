// Issue #3355 — deterministic truth/safety lint applied after every model
// response. The model may repair once; a still-unsafe answer is reduced to an
// honest fallback rather than emitted as a claim.

export type AriCopyLintCode =
  | "BANK_DIGITS"
  | "CREDENTIAL"
  | "UNVERIFIED_SUCCESS"
  | "UNVERIFIED_BUYER_NOTICE"
  | "UNSOURCED_RESEARCH"
  | "RAW_MARKUP";

export interface AriCopyLintResult {
  ok: boolean;
  violations: AriCopyLintCode[];
}

const RULES: ReadonlyArray<[AriCopyLintCode, RegExp]> = [
  ["BANK_DIGITS", /\b(?:account|bank|routing|sort code)[^\n]{0,24}\d{6,}\b/i],
  [
    "CREDENTIAL",
    /\b(?:password|passcode|api key|secret|authorization)\s*[:=]\s*\S+/i,
  ],
  [
    "UNVERIFIED_SUCCESS",
    /\b(?:successfully|completed|published|sent|created)\b[^\n]{0,50}\b(?:for you|now live|to everyone)\b/i,
  ],
  [
    "UNVERIFIED_BUYER_NOTICE",
    /\bbuyers? (?:were|have been) (?:emailed|notified)\b/i,
  ],
  ["RAW_MARKUP", /(^|\n)\s{0,3}(?:#{1,6}\s|```|\*\*\*)/m],
];

export function lintAriCopy(
  text: string,
  options: { researchExpected?: boolean; hasSources?: boolean } = {},
): AriCopyLintResult {
  const violations = RULES.filter(([, pattern]) => pattern.test(text)).map((
    [code],
  ) => code);
  const disclosesResearchGap =
    /\b(?:could(?:n't| not)|unable to|no usable|no verified|without usable)\b[^\n]{0,80}\b(?:public )?sources?\b|\bpublic research\b[^\n]{0,60}\b(?:unavailable|could(?:n't| not)|failed)\b/i
      .test(text);
  if (
    options.researchExpected && !options.hasSources &&
    !disclosesResearchGap
  ) {
    violations.push("UNSOURCED_RESEARCH");
  }
  return { ok: violations.length === 0, violations: [...new Set(violations)] };
}

export function safeAriCopyFallback(
  violations: readonly AriCopyLintCode[],
): string {
  if (violations.includes("BANK_DIGITS") || violations.includes("CREDENTIAL")) {
    return "I removed sensitive information from that response. Open the secure Mingla step to continue.";
  }
  if (
    violations.includes("UNVERIFIED_SUCCESS") ||
    violations.includes("UNVERIFIED_BUYER_NOTICE")
  ) {
    return "I couldn't verify the final result yet. Nothing should be treated as completed until I read it back from Mingla.";
  }
  if (violations.includes("UNSOURCED_RESEARCH")) {
    return "I couldn't verify that research with usable public sources. Try again or give me a specific public page to inspect.";
  }
  return "I couldn't format that answer safely. Try again and I'll give you a simpler response.";
}
