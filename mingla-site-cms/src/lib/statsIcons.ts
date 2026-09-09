/**
 * #3149 wave 4 — the drawings a figure may name.
 *
 * ONE OWNER, ENFORCED BY A TEST. The list itself belongs to
 * `mingla-sites/src/contracts/artifact.ts` (`STATS_ICONS`), which is what
 * refuses a publish carrying anything else, and `statsIcons.issue3149` fails
 * if this copy ever names a different set.
 *
 * It is a copy rather than an import for the reason `fontPairings.ts` is: the
 * two apps deploy as separate Vercel projects with their own root directories,
 * so a `../../mingla-sites/...` import typechecks locally and breaks the CMS
 * build.
 *
 * The labels are the editor's, not the contract's — they describe what the
 * drawing is FOR, because "record-vinyl" means nothing to somebody choosing an
 * icon for a Friday night.
 */
export const STATS_ICON_KEYS = [
  "clock",
  "bowl",
  "music",
  "card",
  "pin",
  "phone",
] as const;

export type StatsIconKey = (typeof STATS_ICON_KEYS)[number];

export const STATS_ICON_LABELS: Record<StatsIconKey, string> = {
  clock: "Clock — hours, opening times",
  bowl: "Bowl — food, the kitchen",
  music: "Music — a night, a DJ, an event",
  card: "Card — paying, prices",
  pin: "Pin — where you are",
  phone: "Phone — getting in touch",
};

export const statsIconOptions = STATS_ICON_KEYS.map((value) => ({
  value,
  label: STATS_ICON_LABELS[value],
}));
