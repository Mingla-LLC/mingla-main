/**
 * ISSUE-864 WP4 [Campaign Builder] — A4.d: the policy pre-check panel logic
 * (blueprint §1.7b). Four controls:
 *
 *  1. Personal-attributes linter — WARN-ONLY, never hard-block (false
 *     positives on a social product are guaranteed). The 4 patterns, with
 *     Meta's rejected→compliant examples shipped INLINE in the panel.
 *  2. Reddit DATING lexicon — Mingla's "not a dating app" positioning is a
 *     DELIVERY rule on Reddit (rejection_reason DATING + 4 variants):
 *     say "plan the night", never "meet someone."
 *  3. Alcohol-adjacency warning — Reddit has 7 ALCOHOL* rejection reasons and
 *     ALCOHOL_AGE_TARGETING forces age targeting Reddit's API cannot express;
 *     Google and Snap restrict alcohol too.
 *  4. special_ad_categories — collected and validated, NEVER hardcoded [].
 *     CREDIT is REJECTED with the migration message (retired 2025-01-14 →
 *     FINANCIAL_PRODUCTS_SERVICES). Selecting a category renders the
 *     restriction-cascade preview BEFORE the Meta call.
 */

// ── 1. Personal-attributes linter (the 4 patterns — warn-only) ────────────────
const PROTECTED_ATTRIBUTE_TERMS = [
  "race", "ethnic", "religio", "christian", "muslim", "jewish", "hindu",
  "age", "old", "young", "senior", "teen",
  "gay", "lesbian", "queer", "straight", "sexual",
  "trans", "gender", "nonbinary", "non-binary",
  "disab", "depress", "anxiety", "anxious", "diagnos", "illness", "health",
  "broke", "debt", "poor", "bankrupt",
  "vote", "voting", "voter",
  "union",
  "criminal", "convict", "felony",
  "single", "divorced", "widowed",
];

const PRESUMED_STATE_PHRASES = [
  /\btired of\b/i,
  /\bstruggling with\b/i,
  /\bstill single\b/i,
  /\bgetting you down\b/i,
  /\bfeeling (lonely|alone|down|stuck)\b/i,
  /\bsick of\b/i,
];

const NAME_INSERTION_PATTERNS = [
  /\{\{?\s*(first_?name|name)\s*\}?\}/i, // template tokens {name} {{first_name}}
  /\[(first_?name|name)\]/i,
];

function tokens(text) {
  return (text ?? "").toLowerCase().split(/[^a-z'-]+/).filter(Boolean);
}

/**
 * Run the 4-pattern linter over the combined copy. Returns warn-only findings
 * [{ pattern: 1|2|3|4, message, excerpt }]. NEVER a hard block (A4.d.1).
 */
export function lintPersonalAttributes(text) {
  const findings = [];
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
  const youIdx = toks.reduce((acc, t, i) => {
    if (t === "you" || t === "your" || t === "you're" || t === "youre") acc.push(i);
    return acc;
  }, []);
  outer: for (const i of youIdx) {
    for (let j = Math.max(0, i - N); j <= Math.min(toks.length - 1, i + N); j++) {
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
  { rejected: "Are you single? Meet people tonight.", compliant: "The best Tuesday plans in the city." },
  { rejected: "Tired of being alone?", compliant: "A room full of people who showed up for the same night." },
  { rejected: "Do you struggle to make friends?", compliant: "Plans made easy — pick a night, bring whoever." },
  { rejected: "Billy, get this t-shirt with your name in print!", compliant: "T-shirts with custom prints, made to order." },
];

// ── 2. Reddit DATING lexicon (warn, channel-scoped) ───────────────────────────
const DATING_PHRASES = [
  /\bmeet (someone|people|singles|new people|somebody)\b/i,
  /\bsingles?\b/i,
  /\bdating\b/i,
  /\bfind (love|a date|your match)\b/i,
  /\bmatch(making|maker)\b/i,
  /\bhook ?up\b/i,
];

export const DATING_GUIDANCE =
  "Say \"plan the night\", never \"meet someone.\" On Reddit that's not a brand preference — it's the difference between running and being rejected under DATING.";

export function lintRedditDating(text) {
  if (!text) return null;
  for (const re of DATING_PHRASES) {
    const m = re.exec(text);
    if (m) {
      return {
        excerpt: m[0],
        message:
          `"${m[0]}" reads like a dating ad to Reddit's reviewers (rejection_reason DATING + 4 variants). ${DATING_GUIDANCE}`,
      };
    }
  }
  return null;
}

// ── 3. Alcohol adjacency (warn) ───────────────────────────────────────────────
const ALCOHOL_TERMS = [
  /\b(drinks?|cocktails?|beer|wine|shots?|booze|alcohol|happy hour|open bar|byob|bottomless|prosecco|champagne|tequila|whisk(e)?y|vodka|gin|rum)\b/i,
];

export const ALCOHOL_WARNING =
  "This reads as alcohol-adjacent. Reddit can reject it for that and then require age targeting it doesn't support. Google and Snapchat both restrict alcohol too. Consider leading with the room and the music, not the drinks.";

export function lintAlcohol(text) {
  if (!text) return null;
  for (const re of ALCOHOL_TERMS) {
    const m = re.exec(text);
    if (m) return { excerpt: m[0], message: ALCOHOL_WARNING };
  }
  return null;
}

// ── 4. special_ad_categories (validated, never hardcoded []) ──────────────────
export const SPECIAL_AD_CATEGORIES = [
  { value: "NONE", label: "None — event / venue traffic" },
  { value: "HOUSING", label: "Housing" },
  { value: "EMPLOYMENT", label: "Employment" },
  { value: "FINANCIAL_PRODUCTS_SERVICES", label: "Financial products & services" },
  { value: "ISSUES_ELECTIONS_POLITICS", label: "Issues, elections or politics" },
];

export const CREDIT_MIGRATION_MESSAGE =
  "CREDIT was retired on 2025-01-14 — use FINANCIAL_PRODUCTS_SERVICES instead. Any validator still whitelisting CREDIT is stale.";

/** Mirrors the server's validateSpecialAdCategories — client UX only, server re-checks. */
export function validateSpecialAdCategory(value) {
  if (value === "CREDIT") return { ok: false, message: CREDIT_MIGRATION_MESSAGE };
  if (!SPECIAL_AD_CATEGORIES.some((c) => c.value === value)) {
    return { ok: false, message: `"${value}" is not a valid special ad category.` };
  }
  return { ok: true };
}

/** The restriction-cascade preview rendered BEFORE the Meta call (A4.d.4). */
export const SPECIAL_CATEGORY_CASCADE = [
  "Age is forced to 18–65 (your age range is overridden).",
  "Gender targeting becomes unavailable.",
  "Location radius minimum becomes 15 mi / 25 km; location exclusion is not supported at all.",
  "ZIP/postal, neighbourhood and metro targeting are prohibited.",
  "Behaviour and demographic targeting are removed; lookalike audiences are unavailable entirely.",
  "special_ad_category_country is required (we send your targeted countries).",
];

/**
 * The whole panel in one call. `channelSet` scopes the Reddit rule; the
 * personal-attributes + alcohol linters always run (Meta is always in play).
 */
export function runPolicyPrecheck({ copyText, channelSet = [] }) {
  const personalAttributes = lintPersonalAttributes(copyText);
  const dating = channelSet.includes("reddit") ? lintRedditDating(copyText) : null;
  const alcohol = lintAlcohol(copyText);
  return { personalAttributes, dating, alcohol };
}
