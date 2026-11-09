// #4339 round B (SEO audit, minor) — the search description of each city page,
// 140–155 characters, keyword first ("Things to do in <City> this weekend").
// The long, evidence-backed `directAnswer` in registry.ts stays the page's
// answer and the CollectionPage description; this is only the snippet text
// (meta description, og:description and the route contract).

export const CITY_META_DESCRIPTIONS: Readonly<Record<string, string>> = {
  lagos:
    'Things to do in Lagos this weekend: events, culture stops, food, music nights and waterside days, with area, timing and journey checked. Plan it on Mingla.',
  'durham-nc':
    'Things to do in Durham, NC this weekend: performances, sport, campus culture, public art and parks, with the event and journey checked. Plan it on Mingla.',
  'cary-nc':
    'Things to do in Cary, NC this weekend: downtown park events, arts spaces, greenways, classes and concerts, at an easy pace. Plan it with friends on Mingla.',
  'raleigh-nc':
    'Things to do in Raleigh, NC this weekend: galleries, museums, greenways, parks and live shows, with the exact place and journey. Plan it with Mingla.',
  'new-york-city':
    'Things to do in New York City this weekend: events, shows and outings across the five boroughs, with venue and MTA journey checked. Plan it on Mingla.',
  brussels:
    'Things to do in Brussels this weekend: events, exhibitions and outings by municipality, with the venue, local name and transport stop. Plan it on Mingla.',
  paris:
    'Things to do in Paris this weekend: exhibitions, classes, shows and outings by arrondissement, with meeting point and last journey. Plan it on Mingla.',
  london:
    'Things to do in London this weekend: events, shows, food and outings by borough, with the actual venue and TfL journey checked. Plan it on Mingla.',
  'fort-lauderdale':
    'Things to do in Fort Lauderdale this weekend: waterfront events, food and outings, with location, parking and road changes checked. Plan it with Mingla.',
  'washington-dc':
    'Things to do in Washington, DC this weekend: museums, shows, tours and events by neighbourhood, with entry details and the journey. Plan it on Mingla.',
}

/** The city page's search description (falls back to its direct answer). */
export function cityMetaDescription(slug: string, fallback: string): string {
  return CITY_META_DESCRIPTIONS[slug] ?? fallback
}
