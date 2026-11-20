/**
 * #4490 Explorer W1 — an emailed /visit/<id>#t=<token> link must open the
 * booking. The route's first render can carry the placeholder id; adopting
 * the fragment then filed the token under the wrong id and scrubbed it.
 * FAILS-ON-REVERT: remove the addressNamesGroup guard and F-2 fails.
 */
import { adoptFragmentToken, addressNamesGroup, readVenueOfferBookingToken } from "../venueOfferBookingTokens";

const ID = "6262c19a-6cec-400f-a1b0-ce6fe6dfabf2";
const PLACEHOLDER = "00000000-0000-4000-8000-000000000000";
const TOKEN = `l4490.${"A".repeat(43)}`;

function fakeWindow(pathname: string, hash: string): { hash: string; pathname: string } {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  const location = { pathname, hash, search: "" };
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = {
    location,
    sessionStorage: storage,
    localStorage: storage,
    history: { state: null, replaceState: (_s: unknown, _t: string, url: string) => { location.hash = url.includes("#") ? url.slice(url.indexOf("#")) : ""; } },
    setTimeout,
  };
  return location;
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).window;
});

test("F-1 the booking page takes its own fragment", () => {
  fakeWindow(`/visit/${ID}`, `#t=${TOKEN}`);
  expect(adoptFragmentToken(ID)).toBe(TOKEN);
  expect(readVenueOfferBookingToken(ID)).toBe(TOKEN);
});

test("F-2 a render with the placeholder id leaves the fragment for the real render", () => {
  const location = fakeWindow(`/visit/${ID}`, `#t=${TOKEN}`);
  expect(adoptFragmentToken(PLACEHOLDER)).toBeNull();
  expect(location.hash).toBe(`#t=${TOKEN}`);
  expect(adoptFragmentToken(ID)).toBe(TOKEN);
});

test("F-3 the plan page path counts; other paths do not", () => {
  expect(addressNamesGroup(`/visit/plan/${ID}`, ID)).toBe(true);
  expect(addressNamesGroup(`/visit/${ID.toUpperCase()}`, ID)).toBe(true);
  expect(addressNamesGroup(`/visit/waitlist/${ID}`, ID)).toBe(false);
  expect(addressNamesGroup(`/b/x/v/y`, ID)).toBe(false);
});
