// Issue #4275 T-C7 — a cold open fetches the deck once.
//
// invariant: I-FEED-ONE-SET-PER-LOAD — the auth hook's deck prefetch wrote under
// a key nothing reads, so every cold open fetched the whole deck twice.
//
// FAILS-ON-REVERT: put deckService.fetchDeck back in useAuthSimple and this fails.

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

Deno.test("T-C7 useAuthSimple fetches no deck and still pre-seeds preferences", () => {
  const source = strip(Deno.readTextFileSync(new URL("../useAuthSimple.ts", import.meta.url)));
  assert(!/fetchDeck\(/.test(source), "no deck fetch");
  assert(!/deckService/.test(source), "no deck service");
  assert(!/buildDeckQueryKey/.test(source), "no deck key");
  assert(!/setQueryData\(deckQueryKey/.test(source), "no deck write");
  assert(/PreferencesService\.getUserPreferences\(session\.user\.id\)/.test(source), "preferences read stays");
  assert(/queryClient\.setQueryData\(\['userPreferences', session\.user\.id\], prefs\)/.test(source), "preferences pre-seed stays");
  assert(/import\('expo-location'\)/.test(source), "the map location seed is separate and stays");
  assert(/update-map-location/.test(source), "the map location seed is separate and stays");
});
