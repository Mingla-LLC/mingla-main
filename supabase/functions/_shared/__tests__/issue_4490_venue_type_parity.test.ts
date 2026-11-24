// MINGLA-INVARIANT: I-VENUE-TYPE-KEY-PARITY | issue #4490 | the venue_category CHECK, the SQL chip list (issue_4490_venue_type_chip_keys), the Discover edge validation (VENUE_TYPE_CHIP_KEYS), the deck chip map (VENUE_TYPE_CHIPS) and the shared VENUE_TYPE_LABELS agree: the chips are every venue type except stay, in one order, each with one label.
//
// FAILS-ON-REVERT: drop or rename a key in any one list and this suite fails.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { VENUE_TYPE_CHIP_KEYS as EDGE_KEYS } from "../../discover-merged-events/_v2_types.ts";
import { VENUE_TYPE_CHIPS } from "../../discover-cards/venueTypeChips.ts";
import {
  VENUE_TYPE_CHIP_KEYS as SHARED_KEYS,
  VENUE_TYPE_LABELS,
} from "../../../../packages/brand-rendering/venueTypeLabels.ts";

const root = new URL("../../../../", import.meta.url);
const read = (p: string) => Deno.readTextFileSync(new URL(p, root));
const quoted = (text: string) => [...text.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

Deno.test("I-VENUE-TYPE-KEY-PARITY: SQL CHECK, SQL chips, edge, shared labels", () => {
  const p1 = read("supabase/migrations/20281203004490_issue_4490_p1_spaces_features.sql");
  const at = p1.indexOf("ADD CONSTRAINT venue_listings_venue_category_check");
  const check = quoted(p1.slice(at, p1.indexOf("));", at)));
  assertEquals(check.length, 9, "nine venue types in the CHECK");

  const w6a = read("supabase/migrations/20281203464490_issue_4490_explorer_w6a_discover_venues.sql");
  const fnAt = w6a.indexOf("FUNCTION public.issue_4490_venue_type_chip_keys()");
  const sqlChips = quoted(w6a.slice(w6a.indexOf("SELECT ARRAY[", fnAt), w6a.indexOf("]::text[]", fnAt)));

  const expected = check.filter((k) => k !== "stay");
  assertEquals([...sqlChips].sort(), [...expected].sort(), "SQL chips = the CHECK without stay");
  assertEquals([...EDGE_KEYS], sqlChips, "edge chips = SQL chips, same order");
  assertEquals([...SHARED_KEYS], sqlChips, "shared chips = SQL chips, same order");
  assertEquals(Object.keys(VENUE_TYPE_LABELS).sort(), [...check].sort(), "a label for every CHECK value");
  for (const key of check) assert(VENUE_TYPE_LABELS[key as keyof typeof VENUE_TYPE_LABELS].length > 0);

  // The deck's chip map: one chip per SQL chip key, labelled with the shared words.
  assertEquals(Object.keys(VENUE_TYPE_CHIPS), sqlChips.map((k) => `venue_type:${k}`), "deck chips = SQL chips, same order");
  for (const k of sqlChips) {
    assertEquals(VENUE_TYPE_CHIPS[`venue_type:${k}`].venueType, k);
    assertEquals(VENUE_TYPE_CHIPS[`venue_type:${k}`].displayCategory, VENUE_TYPE_LABELS[k as keyof typeof VENUE_TYPE_LABELS]);
  }

  // Host reads its labels from the shared owner (no second copy of the words).
  const host = read("mingla-business/src/types/venueFeatures.ts");
  for (const key of check) assert(host.includes(`label: VENUE_TYPE_LABELS.${key},`), `Host ${key} label from the shared owner`);
});
