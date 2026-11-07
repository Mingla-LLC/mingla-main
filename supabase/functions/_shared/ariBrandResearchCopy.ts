/**
 * Issue #2830 — the words and field list for Ari's public research, apart from
 * the search itself. The flow runs in functions that never search (and so never
 * hold the search key); only agent-chat and agent-confirm-action load
 * ariBrandResearch.ts and pass it in.
 */

export const RESEARCH_FIELD_KEYS = [
  "city_country",
  "contact_email",
  "contact_phone",
  "address",
  "social_links",
] as const;
export type ResearchFieldKey = (typeof RESEARCH_FIELD_KEYS)[number];
const RESEARCH_FIELDS: ReadonlySet<string> = new Set(RESEARCH_FIELD_KEYS);

export function isResearchField(key: string): key is ResearchFieldKey {
  return RESEARCH_FIELDS.has(key);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** "From lanternroom.example, checked today": what the card says about a value. */
export function researchSourceLine(
  candidate: { source_url?: unknown; observed_at?: unknown },
  now: Date = new Date(),
): string {
  const host = typeof candidate.source_url === "string"
    ? hostOf(candidate.source_url)
    : null;
  const when = typeof candidate.observed_at === "string"
    ? new Date(candidate.observed_at)
    : null;
  const valid = when && !Number.isNaN(when.getTime());
  const day = !valid
    ? null
    : when.toDateString() === now.toDateString()
    ? "today"
    : `on ${
      new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(when)
    }`;
  return `From ${host ?? "a public page"}${day ? `, checked ${day}` : ""}`;
}
