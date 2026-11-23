// #4572 item 6 (D6) — Discover's "Event type" filter in the same two groups,
// and the same order, as the Host wizard: "Parties" and "Culture & learning".
// Each group shows its first EVENT_TYPE_GROUP_PREVIEW options until expanded.
//
// Pure module (type-only imports) so the deno2-discovered lane runs it as-is.
import type { DiscoverFacetOption } from "../../types/discoverFeed";

export type EventTypeGroupId = "party" | "culture";

export interface EventTypeGroup {
  id: EventTypeGroupId;
  options: DiscoverFacetOption[];
}

export const EVENT_TYPE_GROUP_PREVIEW = 6;

export function groupEventTypeOptions(
  options: readonly DiscoverFacetOption[],
  canonical: readonly { slug: string; group: EventTypeGroupId }[],
): EventTypeGroup[] {
  const order = new Map(canonical.map((entry, index) => [entry.slug, index] as const));
  const groupOf = new Map(canonical.map((entry) => [entry.slug, entry.group] as const));
  const rank = (id: string): number => order.get(id) ?? Number.MAX_SAFE_INTEGER;
  const groups: EventTypeGroup[] = [
    { id: "party", options: [] },
    { id: "culture", options: [] },
  ];
  for (const option of options) {
    // A slug the app does not know yet (newer server) lands in the last group.
    const target = groupOf.get(option.id) === "party" ? groups[0] : groups[1];
    target.options.push(option);
  }
  for (const group of groups) {
    group.options.sort((a, b) => rank(a.id) - rank(b.id));
  }
  return groups.filter((group) => group.options.length > 0);
}

/**
 * The options a group shows: the first EVENT_TYPE_GROUP_PREVIEW, plus any
 * selected one further down (a picked chip never hides), unless expanded.
 */
export function visibleEventTypeOptions(
  group: EventTypeGroup,
  expanded: boolean,
  selected: readonly string[],
): DiscoverFacetOption[] {
  if (expanded || group.options.length <= EVENT_TYPE_GROUP_PREVIEW) return group.options;
  return group.options.filter(
    (option, index) => index < EVENT_TYPE_GROUP_PREVIEW || selected.includes(option.id),
  );
}

/**
 * #4572 QA P2-2 — a filter chip's words. When the app has no translation for
 * an option the server sends (a newer event type than this build knows), i18n
 * hands back the key itself; show the slug in plain words ("book-club" →
 * "Book club") instead of a raw `taxonomy.party.*` key.
 * INVARIANT discover-chip-never-shows-raw-key: a Discover filter chip never renders an untranslated i18n key
 */
export function humanizeOptionId(id: string): string {
  const words = id.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : id;
}

export function discoverOptionLabel(
  t: (key: string) => string,
  key: string | null,
  id: string,
): string {
  if (!key) return id;
  const text = t(key);
  return typeof text === "string" && text.trim() && text !== key ? text : humanizeOptionId(id);
}
