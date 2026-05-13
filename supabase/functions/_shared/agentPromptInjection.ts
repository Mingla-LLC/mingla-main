// ORCH-0821 — Direct prompt injection detector.
//
// Returns the list of regex matches found in the user's message. The CALLER
// decides what to do with a flag — current policy is NOT to refuse the
// message, but to inject a stronger security reminder into the system prompt
// for THIS turn and log the attempt. Outright refusal is a worse UX than
// re-anchored continuation because false positives are common.

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:(?:all|previous|prior|above|the)\s+)*(?:instructions|rules|prompts)/i,
  /you\s+are\s+(?:now\s+|a\s+)?(?:admin|root|system|developer|jailbroken)/i,
  /(?:disregard|forget|override)\s+(?:above|previous|prior|system)/i,
  /<system>|<\/system>|<\|im_start\|>|<\|im_end\|>/i,
  /act\s+as\s+(?:a\s+|an\s+)?(?:unrestricted|uncensored|dan|developer\s+mode)/i,
];

export interface InjectionDetection {
  flagged: boolean;
  matches: string[];
}

export function detectPromptInjection(userMessage: string): InjectionDetection {
  if (!userMessage || userMessage.length === 0) {
    return { flagged: false, matches: [] };
  }
  const matches: string[] = [];
  for (const pattern of INJECTION_PATTERNS) {
    const found = userMessage.match(pattern);
    if (found && found[0]) {
      matches.push(found[0]);
    }
  }
  return { flagged: matches.length > 0, matches };
}
