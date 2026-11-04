/**
 * #4238 media-buyer, rework after tester round 8 (implementor):
 *
 *   P1-4  A dropped pin whose address has commas (or any separator) still
 *         gets every app's lookup: the pending lookups travel as JSON.
 *   P1-2  One idempotency key per edit attempt: a second tap or a retry of
 *         the same change reuses it; a different change gets a new one; the
 *         detail screen holds one save in flight.
 *   P2-1  A failed undo names the app and never says "Nothing was changed".
 *   P2-2  An app minimum is named with its amount; TikTok's copy no longer
 *         blames a "third" rule for a floor or a lower.
 *   P3    The wait line is in the page's own zone and Mingla's date style;
 *         the apps Mingla stops at the end date are named.
 */
import * as fs from "fs";
import * as path from "path";

jest.mock("../../../../services/supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));

// eslint-disable-next-line import/first
import {
  hostAdInterestKey,
  hostAdLookupQuery,
  hostAdPlaceDisplayName,
  hostAdPendingLookups,
  hostAdPendingLookupSignature,
  hostAdPlaceKey,
} from "../hostAdTargeting";
// eslint-disable-next-line import/first
import {
  hostAdLiveEditAttempt,
  hostAdLiveEditDoneNote,
  hostAdLiveEditError,
  hostAdLiveEditWhen,
} from "../HostAdLiveEditCard";

jest.mock("../../../ui/Input", () => ({ Input: () => null }));
jest.mock("../../../ui/DateField", () => ({ DateField: () => null }));
jest.mock("../../../ui/Button", () => ({ Button: () => null }));

describe("#4238 r9 P1-4 — pending lookups survive any place name", () => {
  it("round-trips a pin with commas and a name with a pipe on every app", () => {
    const pin = { name: "Landmark Beach, Oniru, Lekki", countryCode: "NG", kind: "pin" as const };
    const odd = { name: "Bar | Grill, V.I.", countryCode: "NG", kind: "city" as const };
    const items = (["meta", "tiktok", "snapchat", "google", "reddit"] as const).flatMap((app) => [
      { list: "include" as const, key: hostAdPlaceKey(pin), app },
      { list: "exclude" as const, key: hostAdPlaceKey(odd), app },
      { list: "interest" as const, key: hostAdInterestKey("Afrobeats, live"), app },
    ]);
    const signature = hostAdPendingLookupSignature(items);
    expect(hostAdPendingLookups(signature)).toEqual(items);
    expect(hostAdPendingLookups(signature).filter((item) => item.app === "tiktok")[0].key)
      .toBe(hostAdPlaceKey(pin));
  });
  it("is empty for nothing pending, and drops malformed rows", () => {
    expect(hostAdPendingLookupSignature([])).toBe("");
    expect(hostAdPendingLookups("")).toEqual([]);
    expect(hostAdPendingLookups(JSON.stringify([["include", "k"], ["bogus", "k", "meta"], ["include", "NG:lagos", "meta"]])))
      .toEqual([{ list: "include", key: "NG:lagos", app: "meta" }]);
  });
  it("the builder never joins or splits the pending lookups on a separator", () => {
    const screen = fs.readFileSync(
      path.join(__dirname, "../../../../screens/hostAds/HostAdCreateScreen.tsx"),
      "utf8",
    );
    expect(screen).toContain("hostAdPendingLookupSignature(");
    expect(screen).toContain("hostAdPendingLookups(unresolvedSignature)");
    expect(screen).not.toMatch(/unresolvedSignature\.split\(/);
  });
});

describe("#4238 r9 P1-2 — one key per edit attempt", () => {
  it("reuses the key for the same change and mints one for a different change", () => {
    let n = 0;
    const mint = () => `key-${++n}`;
    const first = hostAdLiveEditAttempt(null, { planId: "p", newBudgetCents: 100_00, newEndsAt: null }, mint);
    const again = hostAdLiveEditAttempt(first, { planId: "p", newBudgetCents: 100_00, newEndsAt: null }, mint);
    expect(again.key).toBe(first.key);
    const other = hostAdLiveEditAttempt(again, { planId: "p", newBudgetCents: 120_00, newEndsAt: null }, mint);
    expect(other.key).not.toBe(first.key);
    // After a save the screen forgets the attempt: the next change is new.
    const next = hostAdLiveEditAttempt(null, { planId: "p", newBudgetCents: 120_00, newEndsAt: null }, mint);
    expect(next.key).not.toBe(other.key);
  });
  it("the detail screen reuses the attempt key and blocks a second save in flight", () => {
    const screen = fs.readFileSync(
      path.join(__dirname, "../../../../screens/hostAds/HostAdDetailScreen.tsx"),
      "utf8",
    );
    const block = screen.slice(screen.indexOf("const onLiveEdit = useCallback("), screen.indexOf("const onDuplicate"));
    expect(block).toContain("if (liveEditInFlight.current) return;");
    expect(block).toContain("idempotencyKey: attempt.key");
    expect(block).not.toMatch(/idempotencyKey:\s*randomUuid\(\)/);
  });
});

describe("#4238 r9 — the Host's words after a live edit", () => {
  it("a failed undo names the app and never says nothing was changed", () => {
    const text = hostAdLiveEditError("host_ad_live_edit_undo_failed", "meta,tiktok", "NGN");
    expect(text).toContain("Facebook & Instagram and TikTok may still be on the new daily amount");
    expect(text).not.toMatch(/nothing was changed/i);
  });
  it("names an app minimum with its amount", () => {
    expect(hostAdLiveEditError("host_ad_live_edit_below_app_minimum", "tiktok:790500", "NGN"))
      .toBe("TikTok needs about NGN 7,905.00 a day. Pick a higher total or a sooner end date.");
  });
  it("TikTok's refusal copy no longer cites a one-third rule", () => {
    const text = hostAdLiveEditError("tiktok_budget_update_failed");
    expect(text).not.toMatch(/third/i);
    expect(text).toContain("TikTok didn't take that change");
  });
  it("another device's edit in flight is said plainly", () => {
    expect(hostAdLiveEditError("host_ad_live_edit_in_progress")).toContain("already being changed");
  });
  it("the wait line uses the page's zone and Mingla's date style", () => {
    expect(hostAdLiveEditWhen("2026-11-04T21:25:54Z", "Africa/Lagos")).toBe("Wed 4 Nov, 22:25");
    expect(hostAdLiveEditWhen("2026-11-04T21:25:54Z", "America/New_York")).toBe("Wed 4 Nov, 16:25");
  });
  it("names the apps Mingla stops at the new end date", () => {
    expect(hostAdLiveEditDoneNote({ daily_not_pushed: [], end_not_pushed: ["tiktok", "snapchat"] }))
      .toBe("Your ad is updated. Mingla stops TikTok and Snapchat at your new end date.");
  });
});

// eslint-disable-next-line import/first
import { hostAdBudgetShortMessage, hostAdSplitWithMinimums } from "../hostAdBudget";

describe("#4238 r9 P3 — the budget short line", () => {
  const money = (cents: number) => `NGN ${(cents / 100).toLocaleString("en-US")}`;
  it("names the combined minimum when several apps are short", () => {
    const split = hostAdSplitWithMinimums(10_000_00, ["meta", "tiktok", "snapchat"], {
      meta: 7_905_00, tiktok: 79_050_00, snapchat: 31_620_00,
    });
    expect(hostAdBudgetShortMessage(split, money)).toBe(
      "Your 3 apps need about NGN 118,575 a day together (Facebook & Instagram, TikTok and Snapchat are short). Raise the budget, or turn an app off.",
    );
  });
  it("names the one app when only one is short", () => {
    const split = hostAdSplitWithMinimums(15_000_00, ["meta", "tiktok"], { meta: 1_000_00, tiktok: 15_000_00 });
    expect(hostAdBudgetShortMessage(split, money)).toBe(
      "TikTok needs about NGN 15,000 a day. Raise the budget, or turn it off.",
    );
  });
});


describe("#4238 r10 — round 9 P3s", () => {
  it("a pin ending in its country asks TikTok for the town, not the country", () => {
    const pin = { name: "Eko Atlantic, Victoria Island, Lagos, Nigeria", countryCode: "NG", kind: "pin" as const };
    expect(hostAdLookupQuery(pin)).toBe("Lagos");
    expect(hostAdLookupQuery({ ...pin, name: "Eko Atlantic, Lagos, NG" })).toBe("Lagos");
    expect(hostAdLookupQuery({ ...pin, name: "Landmark Beach, Oniru, Lekki" })).toBe("Lekki");
    // A pin that is only the country keeps it (nothing else to ask for).
    expect(hostAdLookupQuery({ ...pin, name: "Nigeria" })).toBe("Nigeria");
    expect(hostAdPlaceDisplayName(pin)).toBe("Eko Atlantic, Victoria Island, Lagos, Nigeria");
    expect(hostAdPlaceDisplayName({ name: "Lagos", countryCode: "NG", kind: "city" })).toBe("Lagos, Nigeria");
  });
  it("one app keeps its daily amount; several keep theirs", () => {
    expect(hostAdLiveEditDoneNote({ daily_not_pushed: ["google"], end_not_pushed: [] }))
      .toBe("Your ad is updated. Google keeps its daily amount; Mingla stops it at your new total.");
    expect(hostAdLiveEditDoneNote({ daily_not_pushed: ["google", "reddit"], end_not_pushed: [] }))
      .toBe("Your ad is updated. Google and Reddit keep their daily amount; Mingla stops them at your new total.");
  });
  it("the live-edit result shows inside the card, not at the bottom of the page", () => {
    const card = fs.readFileSync(path.join(__dirname, "../HostAdLiveEditCard.tsx"), "utf8");
    expect(card).toContain('testID="host-ad-live-edit-result"');
    const screen = fs.readFileSync(
      path.join(__dirname, "../../../../screens/hostAds/HostAdDetailScreen.tsx"),
      "utf8",
    );
    expect(screen).toContain("result={liveEditResult}");
    const block = screen.slice(screen.indexOf("const onLiveEdit = useCallback("), screen.indexOf("const onDuplicate"));
    expect(block).not.toMatch(/setError\(|setNotice\(/);
  });
});
