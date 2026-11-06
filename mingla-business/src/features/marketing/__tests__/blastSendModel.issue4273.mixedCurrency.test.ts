// #4273 — the review sheet's SMS cost line (one currency, or a converted
// total with its parts) and the Push hint that names the picked buyer lists.
import {
  pushBuyerListReason,
  sendByUnavailable,
  smsCostLabel,
} from "../blastSendModel";

const MIXED = {
  costKind: "provider_estimate" as const,
  estimatedCostMinor: 157700,
  currency: "NGN",
  costBreakdown: [
    { currency: "NGN", providerCostMinor: 26500, convertedCostMinor: 26500 },
    { currency: "USD", providerCostMinor: 79, convertedCostMinor: 131200 },
  ],
};

describe("#4273 SMS cost label", () => {
  it("a single-currency quote reads exactly as before", () => {
    const single = {
      costKind: "provider_estimate" as const,
      estimatedCostMinor: 265,
      currency: "NGN",
      costBreakdown: [{ currency: "NGN", providerCostMinor: 265, convertedCostMinor: 265 }],
    };
    expect(smsCostLabel(single, "row")).toBe("NGN 2.65 estimated");
    expect(smsCostLabel(single, "total")).toBe("NGN 2.65 estimated provider cost");
    // An old server answer without the parts reads the same.
    const { costBreakdown: _parts, ...old } = single;
    expect(smsCostLabel(old, "total")).toBe("NGN 2.65 estimated provider cost");
  });

  it("a mixed-currency total is 'About' the brand currency, with its parts", () => {
    expect(smsCostLabel(MIXED, "row")).toBe("About NGN 1577.00 estimated");
    expect(smsCostLabel(MIXED, "total")).toBe(
      "About NGN 1577.00 estimated provider cost (NGN 265.00 + USD 0.79, converted at today's exchange rate)",
    );
  });

  it("no amount or no currency is 'Cost unavailable', never a made-up 0.00", () => {
    expect(smsCostLabel({ ...MIXED, estimatedCostMinor: null }, "total")).toBe("Cost unavailable");
    expect(smsCostLabel({ ...MIXED, currency: null }, "row")).toBe("Cost unavailable");
  });

  it("not metered is Free", () => {
    const free = { costKind: "not_metered" as const, estimatedCostMinor: null, currency: null };
    expect(smsCostLabel(free, "row")).toBe("Free");
    expect(smsCostLabel(free, "total")).toBe("Free");
  });
});

describe("#4273 Push hint names the buyer lists", () => {
  it("names 0, 1, 2, 3 and 5 lists", () => {
    const base = "reaches Mingla accounts only, so it's off while";
    expect(pushBuyerListReason([])).toBe(`${base} a buyer list is picked`);
    expect(pushBuyerListReason(["Ticket buyers"])).toBe(`${base} Ticket buyers is picked`);
    expect(pushBuyerListReason(["Ticket buyers", "Lagos Launch buyers"])).toBe(
      `${base} Ticket buyers and Lagos Launch buyers are picked`,
    );
    expect(pushBuyerListReason(["Ticket buyers", "Lagos Launch buyers", "VIP"])).toBe(
      `${base} Ticket buyers, Lagos Launch buyers and 1 more buyer list are picked`,
    );
    expect(pushBuyerListReason(["A", "B", "C", "D", "E"])).toBe(
      `${base} A, B and 3 more buyer lists are picked`,
    );
  });

  it("Your Book + a buyer list: Push names the buyer list, not 'pick Your Book'", () => {
    const reasons = sendByUnavailable({
      sourceKeys: ["book", "event:e1"],
      combinedAllowed: true,
      sealedAudience: true,
      lead: "email",
      buyerListNames: ["Lagos Launch buyers"],
    });
    expect(reasons).toEqual({
      push: "reaches Mingla accounts only, so it's off while Lagos Launch buyers is picked",
    });
    expect(reasons.push).not.toContain("pick Your Book");
    // No buyer list picked: Push has no reason at all.
    expect(sendByUnavailable({
      sourceKeys: ["book"],
      combinedAllowed: true,
      sealedAudience: true,
      lead: "email",
    }).push).toBeUndefined();
  });
});
