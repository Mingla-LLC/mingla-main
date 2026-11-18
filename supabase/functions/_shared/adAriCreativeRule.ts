/**
 * #4238 item 8c (W5) — Ari's creative rule: real people and venues only, from
 * the event's own record and the brand's own media. Checked by ad-plan
 * create_version when `client_kind = 'ari'`; Host-typed copy is never checked.
 *
 *   - A creative marked AI-generated (the library row or the plan's media
 *     rights) is refused: `ari_creative_ai_generated`.
 *   - Each capitalised multi-word name in the ad words must appear in the
 *     event's title, description or place, or the brand's name:
 *     `ari_copy_unverified_name:<name>`. A capital at the start of a sentence
 *     is not a name, and common ad words (days, months, "Tickets", "Live")
 *     never make a name on their own.
 *
 * MINGLA-INVARIANT: I-4238-ARI-REAL-ONLY | issue #4238 | ad-plan create_version refuses an Ari plan whose creative is AI-generated (ari_creative_ai_generated) or whose ad words name a person or venue absent from the event record and brand name (ari_copy_unverified_name:<name>); the same creative or words from the Host pass.
 */

/** Capitalised words that are ad vocabulary, never a person or a venue. */
const AD_WORDS = new Set(
  [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
    "mingla",
    "tickets",
    "ticket",
    "free",
    "live",
    "night",
    "nights",
    "party",
    "event",
    "events",
    "tonight",
    "today",
    "tomorrow",
    "weekend",
    "book",
    "now",
    "join",
    "rsvp",
    "vip",
    "new",
    "last",
    "early",
    "bird",
    "sale",
    "sales",
    "get",
    "your",
    "our",
    "the",
    "and",
    "with",
    "this",
    "don't",
    "dont",
    "sign",
    "up",
    "limited",
    "only",
    "music",
    "show",
    "edition",
    "season",
    "special",
    "guest",
    "guests",
    "dj",
    "mc",
    "am",
    "pm",
    "i",
    "a",
    "an",
    "at",
    "on",
    "in",
    "of",
    "to",
    "for",
    "&",
  ],
);

const SENTENCE_END = /[.!?…:]["')\]]*$/;

function isCapitalised(word: string): boolean {
  const first = word.replace(/^[^\p{L}\p{N}]+/u, "").charAt(0);
  return first !== "" && first === first.toUpperCase() &&
    first !== first.toLowerCase();
}

function bare(word: string): string {
  return word.replace(/^[^\p{L}\p{N}&']+|[^\p{L}\p{N}&']+$/gu, "");
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}&']+/gu, " ").trim();
}

/** Capitalised multi-word names in one piece of ad copy. */
export function capitalisedNames(text: string): string[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  const names: string[] = [];
  let run: string[] = [];
  let sentenceStart = true;
  const flush = () => {
    // Two or more capitalised words with at least one that is not ad
    // vocabulary: "The Shrine", "Burna Boy" (never "Friday Night").
    const real = run.filter((word) => !AD_WORDS.has(word.toLowerCase()));
    if (run.length >= 2 && real.length >= 1) names.push(run.join(" "));
    run = [];
  };
  for (const token of tokens) {
    const word = bare(token);
    if (!word) {
      flush();
      sentenceStart = SENTENCE_END.test(token) || sentenceStart;
      continue;
    }
    if (isCapitalised(word) && !sentenceStart) {
      run.push(word);
    } else {
      flush();
    }
    // A trailing comma or full stop ends the name.
    if (/[,;.!?…:()"]$/.test(token)) flush();
    sentenceStart = SENTENCE_END.test(token);
  }
  flush();
  return names;
}

/** The first ad-copy name not in the event record, or null. */
export function ariUnverifiedName(
  copy: Record<string, unknown>,
  record: readonly (string | null | undefined)[],
): string | null {
  const haystack = ` ${
    record.filter((part): part is string => typeof part === "string")
      .map(normalise).join(" ")
  } `;
  const texts: string[] = [];
  const collect = (value: unknown) => {
    if (typeof value === "string") texts.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(collect);
    }
  };
  collect(copy);
  for (const text of texts) {
    for (const name of capitalisedNames(text)) {
      const words = normalise(name).split(" ").filter((word) =>
        !AD_WORDS.has(word)
      );
      if (words.length < 1) continue;
      if (!haystack.includes(` ${words.join(" ")} `)) return name.slice(0, 80);
    }
  }
  return null;
}

/** `ari_creative_ai_generated` when any chosen creative is AI-made. */
export function ariCreativeAiGenerated(input: {
  creatives: readonly { ai_generated?: unknown }[];
  mediaRights: { ai_generated?: unknown } | null;
}): boolean {
  return input.mediaRights?.ai_generated === true ||
    input.creatives.some((row) => row.ai_generated === true);
}
