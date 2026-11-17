/**
 * #4238 T-5 (amendment A): the ONE pre-launch copy checker for Admin, Host
 * and Ari. Ported unchanged from mingla-admin/src/lib/adBuilder/policyLinter.js
 * (patterns, messages, scoping); Admin keeps that file as its browser copy and
 * the parity test (_shared/__tests__/issue_4238_copy_policy_parity.test.ts +
 * Admin node:test) runs _shared/__tests__/fixtures/ad_copy_policy_cases.json
 * through both and fails on any difference. special_ad_categories stays
 * Admin-only.
 *
 * WARN-ONLY (decision 6): findings never block a plan, a version or a launch.
 *
 * MINGLA-INVARIANT: I-4238-COPY-CHECK-WARN-ONLY | issue #4238 | The shared copy checker (adCopyPolicy.ts) only ever returns warnings: ad-plan returns them as copy_warnings[] and never refuses a plan for them; Admin policyLinter.js and this file give identical findings on the shared fixture table.
 */

export type PersonalAttributeFinding = {
  pattern: 1 | 2 | 3 | 4;
  excerpt: string;
  message: string;
};

export type CopyFinding = { excerpt: string; message: string };

// ── 1. Personal-attributes linter (the 4 patterns — warn-only) ────────────────
const PROTECTED_ATTRIBUTE_TERMS: readonly string[] = [
  "race",
  "ethnic",
  "religio",
  "christian",
  "muslim",
  "jewish",
  "hindu",
  "age",
  "old",
  "young",
  "senior",
  "teen",
  "gay",
  "lesbian",
  "queer",
  "straight",
  "sexual",
  "trans",
  "gender",
  "nonbinary",
  "non-binary",
  "disab",
  "depress",
  "anxiety",
  "anxious",
  "diagnos",
  "illness",
  "health",
  "broke",
  "debt",
  "poor",
  "bankrupt",
  "vote",
  "voting",
  "voter",
  "union",
  "criminal",
  "convict",
  "felony",
  "single",
  "divorced",
  "widowed",
];

const PRESUMED_STATE_PHRASES: readonly RegExp[] = [
  /\btired of\b/i,
  /\bstruggling with\b/i,
  /\bstill single\b/i,
  /\bgetting you down\b/i,
  /\bfeeling (lonely|alone|down|stuck)\b/i,
  /\bsick of\b/i,
];

const NAME_INSERTION_PATTERNS: readonly RegExp[] = [
  /\{\{?\s*(first_?name|name)\s*\}?\}/i, // template tokens {name} {{first_name}}
  /\[(first_?name|name)\]/i,
];

function tokens(text: string | null | undefined): string[] {
  return (text ?? "").toLowerCase().split(/[^a-z'-]+/).filter(Boolean);
}

/**
 * Run the 4-pattern linter over the combined copy. Returns warn-only findings
 * [{ pattern: 1|2|3|4, message, excerpt }]. NEVER a hard block (A4.d.1).
 */
export function lintPersonalAttributes(
  text: string | null | undefined,
): PersonalAttributeFinding[] {
  const findings: PersonalAttributeFinding[] = [];
  if (!text || !text.trim()) return findings;

  // Pattern 1 — the interrogative second person (Meta's most-cited pattern).
  const interrogative = /\b(are|do|did|have|has|is)\s+(you|your)\b/i.exec(text);
  if (interrogative) {
    findings.push({
      pattern: 1,
      excerpt: interrogative[0],
      message:
        "'Are you…?' phrasing is the pattern Meta rejects most. It reads as though we know something about the person. Try stating it instead of asking it.",
    });
  }

  // Pattern 2 — you/your within N tokens of a protected-attribute term.
  const N = 5;
  const toks = tokens(text);
  const youIdx = toks.reduce((acc: number[], t, i) => {
    if (t === "you" || t === "your" || t === "you're" || t === "youre") {
      acc.push(i);
    }
    return acc;
  }, []);
  outer: for (const i of youIdx) {
    for (
      let j = Math.max(0, i - N);
      j <= Math.min(toks.length - 1, i + N);
      j++
    ) {
      const t = toks[j];
      if (PROTECTED_ATTRIBUTE_TERMS.some((term) => t.startsWith(term))) {
        findings.push({
          pattern: 2,
          excerpt: toks.slice(Math.max(0, i - N), i + N + 1).join(" "),
          message:
            "This line points a personal attribute at the reader. Meta rejects that even when the targeting is fine.",
        });
        break outer;
      }
    }
  }

  // Pattern 3 — presumed-state phrasings.
  for (const re of PRESUMED_STATE_PHRASES) {
    const m = re.exec(text);
    if (m) {
      findings.push({
        pattern: 3,
        excerpt: m[0],
        message:
          "This assumes something about how the reader feels. Meta treats that as a personal attribute.",
      });
      break;
    }
  }

  // Pattern 4 — name insertion.
  for (const re of NAME_INSERTION_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      findings.push({
        pattern: 4,
        excerpt: m[0],
        message:
          "Never put a person's name in ad copy — Meta's example rejection is literally 'Billy Taylor, get this t-shirt with your name in print!'",
      });
      break;
    }
  }

  return findings;
}

/** Meta's rejected→compliant examples — shipped INLINE in the panel (A4.d.1). */
export const PERSONAL_ATTRIBUTES_EXAMPLES = [
  {
    rejected: "Are you single? Meet people tonight.",
    compliant: "The best Tuesday plans in the city.",
  },
  {
    rejected: "Tired of being alone?",
    compliant: "A room full of people who showed up for the same night.",
  },
  {
    rejected: "Do you struggle to make friends?",
    compliant: "Plans made easy — pick a night, bring whoever.",
  },
  {
    rejected: "Billy, get this t-shirt with your name in print!",
    compliant: "T-shirts with custom prints, made to order.",
  },
];

// ── 2. Reddit DATING lexicon (warn, channel-scoped) ───────────────────────────
const DATING_PHRASES: readonly RegExp[] = [
  /\bmeet (someone|people|singles|new people|somebody)\b/i,
  /\bsingles?\b/i,
  /\bdating\b/i,
  /\bfind (love|a date|your match)\b/i,
  /\bmatch(making|maker)\b/i,
  /\bhook ?up\b/i,
];

export const DATING_GUIDANCE =
  'Say "plan the night", never "meet someone." On Reddit that\'s not a brand preference — it\'s the difference between running and being rejected under DATING.';

export function lintRedditDating(
  text: string | null | undefined,
): CopyFinding | null {
  if (!text) return null;
  for (const re of DATING_PHRASES) {
    const m = re.exec(text);
    if (m) {
      return {
        excerpt: m[0],
        message: `"${
          m[0]
        }" reads like a dating ad to Reddit's reviewers (rejection_reason DATING + 4 variants). ${DATING_GUIDANCE}`,
      };
    }
  }
  return null;
}

// ── 3. Alcohol adjacency (warn) ───────────────────────────────────────────────
const ALCOHOL_TERMS: readonly RegExp[] = [
  /\b(drinks?|cocktails?|beers?|wines?|shots?|booze|alcohol|happy hours?|open bars?|byob|bottomless|proseccos?|champagnes?|tequilas?|whisk(e)?ys?|whiskies|vodkas?|gins?|rums?|pints?|ciders?|lagers?)\b/i,
];

export const ALCOHOL_WARNING =
  "This reads as alcohol-adjacent. Reddit can reject it for that and then require age targeting it doesn't support. Google and Snapchat both restrict alcohol too. Consider leading with the room and the music, not the drinks.";

export function lintAlcohol(
  text: string | null | undefined,
): CopyFinding | null {
  if (!text) return null;
  for (const re of ALCOHOL_TERMS) {
    const m = re.exec(text);
    if (m) return { excerpt: m[0], message: ALCOHOL_WARNING };
  }
  return null;
}

/**
 * The whole panel in one call. `channelSet` scopes the Reddit rule; the
 * personal-attributes + alcohol linters always run (Meta is always in play).
 */
export function runPolicyPrecheck(
  { copyText, channelSet = [] }: {
    copyText: string | null | undefined;
    channelSet?: readonly string[];
  },
): {
  personalAttributes: PersonalAttributeFinding[];
  dating: CopyFinding | null;
  alcohol: CopyFinding | null;
} {
  const personalAttributes = lintPersonalAttributes(copyText);
  const dating = channelSet.includes("reddit")
    ? lintRedditDating(copyText)
    : null;
  const alcohol = lintAlcohol(copyText);
  return { personalAttributes, dating, alcohol };
}

/** One warning the Host builder, Ari and Admin show (never a block). */
export type CopyWarning = {
  kind: "personal_attributes" | "dating" | "alcohol";
  pattern?: 1 | 2 | 3 | 4;
  platforms: string[];
  excerpt: string;
  message: string;
};

/** The ad words a Host plan carries, joined the way Admin joins them. */
export function hostCopyText(
  copy: Record<string, unknown> | null | undefined,
): string {
  const c = copy ?? {};
  return ["headline", "primary", "description", "last_tickets"]
    .map((key) => c[key])
    .filter((value): value is string =>
      typeof value === "string" && value.trim() !== ""
    )
    .join("\n");
}

/**
 * #4238 T-5: the copy_warnings[] ad-plan returns at create_version (and the
 * Host builder and Ari read). The findings are exactly Admin's
 * runPolicyPrecheck (personal attributes and alcohol always, dating when
 * Reddit is chosen); `platforms` names the chosen apps whose review rule the
 * finding comes from (personal attributes: Meta; dating: Reddit; alcohol:
 * Reddit, Google, Snapchat), empty when none of them is chosen.
 */
export function hostCopyWarnings(
  copy: Record<string, unknown> | null | undefined,
  platforms: readonly string[],
): CopyWarning[] {
  const text = hostCopyText(copy);
  const result = runPolicyPrecheck({ copyText: text, channelSet: platforms });
  const pick = (apps: readonly string[]) =>
    platforms.filter((platform) => apps.includes(platform));
  const out: CopyWarning[] = result.personalAttributes.map((finding) => ({
    kind: "personal_attributes",
    pattern: finding.pattern,
    platforms: pick(["meta"]),
    excerpt: finding.excerpt,
    message: finding.message,
  }));
  if (result.dating) {
    out.push({ kind: "dating", platforms: ["reddit"], ...result.dating });
  }
  if (result.alcohol) {
    out.push({
      kind: "alcohol",
      platforms: pick(["reddit", "google", "snapchat"]),
      ...result.alcohol,
    });
  }
  return out;
}
