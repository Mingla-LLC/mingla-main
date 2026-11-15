/** #4430 (rule 4): the one source for every `['local', …]` key. Pure, so suites import it directly. */
export const localKeys = {
  all: ['local'] as const,
  landing: ['local', 'landing'] as const,
  home: ['local', 'home'] as const,
  review: (monthId: string) => ['local', 'review', monthId] as const,
  /** Filtered, deduped and sorted: a restored list and a live one share one key. */
  placeNames: (ids: ReadonlyArray<string | null | undefined>) =>
    ['local', 'place-names', Array.from(new Set(ids.filter((id): id is string => Boolean(id)))).sort().join(',')] as const,
  places: (term: string) => ['local', 'places', term] as const,
};
