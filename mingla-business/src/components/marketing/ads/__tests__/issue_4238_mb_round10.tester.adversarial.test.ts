/**
 * #4238 media-buyer, tester round 10 — adversarial checks on the r9 P3 fixes,
 * from a different angle than issue_4238_mb_round9.implementor.test.ts:
 *
 *   X1  A pin whose address ends in its country, in any case or as the code,
 *       even twice, is looked up by the place before it and shown with the
 *       country once. A one-part pin is never emptied, and a city or region
 *       keeps its own name.
 *   X2  "keeps its" / "keep their" follows the number of apps for one, two
 *       and three apps; nothing is said when every app took the change.
 */
jest.mock("../../../../services/supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));
jest.mock("../../../ui/Input", () => ({ Input: () => null }));
jest.mock("../../../ui/DateField", () => ({ DateField: () => null }));
jest.mock("../../../ui/Button", () => ({ Button: () => null }));

// eslint-disable-next-line import/first
import { hostAdLookupQuery, hostAdPinParts, hostAdPlaceDisplayName } from "../hostAdTargeting";
// eslint-disable-next-line import/first
import { hostAdLiveEditDoneNote } from "../HostAdLiveEditCard";

type Kind = "pin" | "city" | "region";
const place = (name: string, countryCode: string, kind: Kind = "pin") =>
  ({ name, countryCode, kind }) as unknown as Parameters<typeof hostAdPlaceDisplayName>[0] & {
    countryCode: string;
  };

describe("X1 a pin ending in its country", () => {
  it.each([
    ["Eko Atlantic, Victoria Island, Lagos, Nigeria", "Lagos"],
    ["Eko Atlantic, Victoria Island, Lagos, nigeria ", "Lagos"],
    ["Landmark Beach, Oniru, Lekki, NG", "Lekki"],
    ["Landmark Beach, Oniru, Lekki, ng", "Lekki"],
    ["Lagos, Nigeria, Nigeria", "Lagos"],
    ["Ikoyi,Lagos,Nigeria", "Lagos"],
  ])("%s is looked up as %s and shows Nigeria once", (name, query) => {
    const p = place(name, "NG");
    expect(hostAdLookupQuery(p)).toBe(query);
    const shown = hostAdPlaceDisplayName(p);
    expect(shown.match(/nigeria/gi)).toHaveLength(1);
    expect(shown.endsWith(", Nigeria")).toBe(true);
    expect(shown).not.toMatch(/, NG,|, ng,/);
  });

  it("never empties a one-part pin", () => {
    expect(hostAdPinParts(place("Nigeria", "NG"))).toEqual(["Nigeria"]);
    expect(hostAdLookupQuery(place("Nigeria", "NG"))).toBe("Nigeria");
  });

  it("keeps a different country's name (it is not this pin's country)", () => {
    expect(hostAdLookupQuery(place("Accra Mall, Accra, Ghana", "NG"))).toBe("Ghana");
  });

  it("works for other countries' names", () => {
    expect(hostAdLookupQuery(place("Shoreditch, London, United Kingdom", "GB"))).toBe("London");
    expect(hostAdLookupQuery(place("Osu, Accra, Ghana", "GH"))).toBe("Accra");
  });

  it("leaves a city or region name alone", () => {
    expect(hostAdLookupQuery(place("Lagos", "NG", "city"))).toBe("Lagos");
    expect(hostAdPlaceDisplayName(place("Lagos", "NG", "city"))).toBe("Lagos, Nigeria");
    expect(hostAdPlaceDisplayName(place("Lagos State", "NG", "region"))).toBe("Lagos State, Nigeria");
  });

  it("does not crash without a country code on a lookup", () => {
    expect(hostAdLookupQuery({ name: "Eko Atlantic, Lagos", kind: "pin" } as never)).toBe("Lagos");
  });
});

describe("X2 one app vs several", () => {
  const note = (apps: string[]) =>
    hostAdLiveEditDoneNote({ daily_not_pushed: apps, end_not_pushed: [] } as never);
  it("one app", () => {
    expect(note(["google"])).toContain("Google keeps its daily amount; Mingla stops it at your new total.");
  });
  it("two apps", () => {
    expect(note(["google", "reddit"])).toMatch(/Google and Reddit keep their daily amount; Mingla stops them at your new total\./);
  });
  it("three apps", () => {
    const text = note(["google", "reddit", "tiktok"]);
    expect(text).toMatch(/keep their daily amount; Mingla stops them/);
    expect(text).not.toMatch(/keeps its/);
  });
  it("none", () => {
    expect(note([])).toBe("Your ad is updated.");
  });
});
