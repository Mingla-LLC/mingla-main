/**
 * #4238 — tester RETEST adversarial suite (Business app side). Angles the
 * implementor's fix tests do not cover:
 *
 *  D4. The Ads setup cache: concurrent loads share ONE request; one brand's
 *      answer never serves another brand; a stale failed request cannot
 *      evict the newer good answer that a forced refresh stored.
 *  D2. The start rule for platforms: junk saved ids count as none (all
 *      ticked); saved ids keep the order of the ready list; the ready list
 *      passed in is never handed back by reference (no shared mutation).
 *      "Matched on all platforms" never shows with nothing ticked, even when
 *      a platform is also reported missing.
 *  D7. A page card's details never repeat the type, for every page type.
 *  D3. Every result word the server can send (the measurement hierarchy)
 *      reads as plain words, never "conversions" / "impressions" / raw keys.
 *
 * Fails on revert (verified by line-deletion at the retest commit):
 *  - hostAdSetupCache: storing the entry after awaiting (no in-flight share)
 *    → loader called 3 times; keying by a constant → brand B gets brand A.
 *  - initialHostAdConnections returning `available` itself → aliasing test.
 *  - hostAdPageDetails back to hostAdPageMeta → the type shows twice.
 *  - hostAdResultLabel without the "conversions" row → banned word.
 */

import {
  hostAdMatchSubtitle,
  initialHostAdConnections,
} from "../hostAdBuilderRules";
import {
  cachedHostAdSetup,
  clearHostAdSetupCache,
} from "../hostAdSetupCache";
import {
  hostAdCopyIsPlain,
  hostAdCostPerLabel,
  hostAdResultLabel,
} from "../hostAdCopy";
import {
  HOST_AD_PAGE_TYPE_LABEL,
  HOST_AD_PAGE_TYPE_ORDER,
  hostAdPageDetails,
} from "../hostAdPageLabels";

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("#4238 RETEST D4 Ads setup cache", () => {
  beforeEach(() => clearHostAdSetupCache());

  it("concurrent loads for one brand share one request", async () => {
    const gate = deferred<{ brand: string }>();
    const loader = jest.fn(() => gate.promise);
    const all = Promise.all([
      cachedHostAdSetup("brand-a", loader, { now: 1000 }),
      cachedHostAdSetup("brand-a", loader, { now: 1001 }),
      cachedHostAdSetup("brand-a", loader, { now: 1002 }),
    ]);
    gate.resolve({ brand: "a" });
    await all;
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("one brand's answer never serves another brand", async () => {
    const loader = jest.fn((brandId: string) => Promise.resolve({ brandId }));
    await cachedHostAdSetup("brand-a", loader, { now: 1000 });
    const b = await cachedHostAdSetup("brand-b", loader, { now: 1001 });
    expect(b).toEqual({ brandId: "brand-b" });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("a stale failed request cannot evict the newer good answer", async () => {
    const first = deferred<{ v: number }>();
    const loader = jest
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => Promise.resolve({ v: 2 }));
    const stale = cachedHostAdSetup("brand-a", loader, { now: 1000 });
    const fresh = await cachedHostAdSetup("brand-a", loader, {
      now: 1001,
      force: true,
    });
    expect(fresh).toEqual({ v: 2 });
    first.reject(new Error("old request failed"));
    await expect(stale).rejects.toThrow("old request failed");
    // The good forced answer is still served without a third request.
    const again = await cachedHostAdSetup("brand-a", loader, { now: 1002 });
    expect(again).toEqual({ v: 2 });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe("#4238 RETEST D2 platform start rule", () => {
  const ready = [
    { id: "meta-1", platform: "meta" },
    { id: "snap-1", platform: "snapchat" },
    { id: "tt-1", platform: "tiktok" },
  ];

  it("junk saved ids count as none: every ready platform is ticked", () => {
    for (const saved of [[null, 7, {}], [""], "meta-1", { 0: "meta-1" }]) {
      const ids = initialHostAdConnections(ready, saved).map((c) => c.id);
      // "" is a string id that matches nothing → falls back to all ready.
      expect(ids).toEqual(["meta-1", "snap-1", "tt-1"]);
    }
  });

  it("saved ids keep the ready list's order and drop gone accounts", () => {
    const ids = initialHostAdConnections(ready, ["tt-1", "gone-9", "meta-1"])
      .map((c) => c.id);
    expect(ids).toEqual(["meta-1", "tt-1"]);
  });

  it("never hands back the ready list itself", () => {
    const out = initialHostAdConnections(ready, null);
    expect(out).not.toBe(ready);
    out.pop();
    expect(ready).toHaveLength(3);
  });

  it("never says 'Matched on all platforms' with nothing ticked", () => {
    for (const missing of [0, 2]) {
      const line = hostAdMatchSubtitle("TikTok", missing, 0);
      expect(line).not.toMatch(/Matched on all/);
      expect(line).not.toMatch(/Not found/);
    }
    expect(hostAdMatchSubtitle("", 0, 2)).toBe("Matched on all platforms");
  });
});

describe("#4238 RETEST D7 page card shows the type once", () => {
  it("details never repeat the type label for any page type", () => {
    for (const type of HOST_AD_PAGE_TYPE_ORDER) {
      const details = hostAdPageDetails({
        page_type: type,
        starts_at: "2026-12-05T18:00:00Z",
        city: "Lagos",
      });
      expect(details).not.toContain(HOST_AD_PAGE_TYPE_LABEL[type]);
      expect(details).toContain("Lagos");
    }
  });

  it("a page with no date and no city has no details line", () => {
    expect(hostAdPageDetails({ page_type: "site", starts_at: null, city: "  " }))
      .toBe("");
  });
});

describe("#4238 RETEST D3 every server result word is plain", () => {
  // The measurement hierarchy the server can send (adMeasurement.ts), plus
  // legacy and Meta words that old rows still carry.
  const SERVER_WORDS = [
    "ticket_purchase",
    "checkout_started",
    "landing_page_view",
    "click",
    "rsvp_registration",
    "booking_confirmed",
    "install",
    "app_store_click",
    "conversions",
    "Landing Page Views",
    "results",
  ];

  it.each(SERVER_WORDS)("%s reads as plain words", (word) => {
    const label = hostAdResultLabel(word);
    const costPer = hostAdCostPerLabel(word);
    expect(hostAdCopyIsPlain(label)).toBe(true);
    expect(hostAdCopyIsPlain(costPer)).toBe(true);
    expect(label).not.toMatch(/_/);
    expect(costPer).toMatch(/^Cost per [a-z-]+$/);
  });
});
