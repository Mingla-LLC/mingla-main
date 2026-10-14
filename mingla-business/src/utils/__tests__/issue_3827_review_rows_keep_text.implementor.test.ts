/**
 * issue #3827 — the "Review changes" sheet keeps ordinary text visible.
 *
 * #3861 added `looksLikeSerializedData` so a stray JSON value never paints. Its
 * truncated-JSON check matched any value opening with "[<digit>", "[\"" or
 * "{\"", so a host who renamed an event "[21+] Rooftop night" or
 * "[2026] NYE party" saw "Changed" instead of old → new.
 *
 * WHAT THIS FILE PINS
 *   KEEP-*  real text that starts with a bracket always shows, including text
 *           the formatter cut short with "…", and text that has a comma right
 *           after a first number or quote ("[1, 2, 3] reasons to come").
 *   DATA-*  serialized data is still caught: whole JSON objects and lists, and
 *           truncated ones that open the way only data does
 *           (`{"key":`, `[{"`, `["x",`, `[1,2`, `[[`) and end with "…".
 *
 * FAILS-ON-REVERT: restore changeSummaryRows.ts from 665d33b85 and KEEP-1 /
 * KEEP-2 go red. Drop the "ends with …" requirement and KEEP-3 goes red.
 */

import { describe, expect, test } from "@jest/globals";

import {
  changeSummaryRows,
  DIFF_CHANGED_SUMMARY,
  looksLikeSerializedData,
  type ChangeSummaryRow,
} from "../changeSummaryRows";

const row = (oldValue: string, newValue: string): ChangeSummaryRow => ({
  fieldKey: "name",
  oldValue,
  newValue,
});

describe("issue #3827 — ordinary text in Review changes stays visible", () => {
  test.each([
    "[21+] Rooftop night",
    "[2026] NYE party",
    "[1] Doors at eight",
    "[1] Doors at eight. [2] Bring ID.",
    '{"Best"} night in town',
    '["Best"] night in town',
    "[-] Sold out",
    "[true story] Rooftop night",
    "[null] set",
    "{curly} name",
    "[Updated] Rooftop night",
  ])("KEEP-1: %s is text, not data", (value) => {
    expect(looksLikeSerializedData(value)).toBe(false);
    const [shown] = changeSummaryRows([row("Rooftop night", value)]);
    expect(shown?.summary).toBeUndefined();
    expect(shown?.newValue).toBe(value);
  });

  test.each([
    `[21+] Rooftop night with the whole crew, a DJ, two bars and a view of the bridg…`,
    `[1] Doors at eight. [2] Bring ID. [3] No re-entry after eleven, sorry about th…`,
    `{"Best"} night in town, with a rooftop, two bars and a DJ until late, come ear…`,
  ])("KEEP-2: long text the formatter cut short still shows (%s)", (value) => {
    expect(looksLikeSerializedData(value)).toBe(false);
    const [shown] = changeSummaryRows([row(value, "Rooftop night")]);
    expect(shown?.summary).toBeUndefined();
    expect(shown?.oldValue).toBe(value);
  });

  test.each([
    "[1, 2, 3] reasons to come",
    '["Rooftop", "Bar"], two floors',
    '{"Venue": the roof} night',
  ])("KEEP-3: text that was NOT cut short is never read as data (%s)", (value) => {
    expect(looksLikeSerializedData(value)).toBe(false);
    expect(changeSummaryRows([row("x", value)])[0]?.summary).toBeUndefined();
  });

  test.each([
    '{"lng":-73.96,"lat":40.71}',
    '["rooftop","house"]',
    "[1,2,3]",
    '[{"id":"a"}]',
    "{}",
    "[]",
    '{"lat":40.6912345,"lng":-73.98510…',
    '{ "lat" : 40.69…',
    '[{"id":"tier-1","name":"General admission","price":2500},{"id":"tier-2","n…',
    '["rooftop","house","techno","afro…',
    "[1,2,3,4,5,6…",
    "[-73.98, 40.69, 12…",
    "[[1,2],[3,4…",
    '[true,false,tr…',
  ])("DATA-1: %s is data and reads 'Changed'", (value) => {
    expect(looksLikeSerializedData(value)).toBe(true);
    expect(changeSummaryRows([row("Rooftop night", value)])[0]?.summary).toBe(
      DIFF_CHANGED_SUMMARY,
    );
  });
});
