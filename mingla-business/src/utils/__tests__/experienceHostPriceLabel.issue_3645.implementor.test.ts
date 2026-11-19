/**
 * issue #3645 / #3281 — the Host experience detail screen labels a paid
 * experience by its price, never "Free" from a free first option.
 */
import * as fs from "fs";
import * as path from "path";

import { experienceHostPriceLabel, type HostPriceExperience } from "../experienceHostPriceLabel";

const fmt = (cents: number): string => `N${(cents / 100).toFixed(0)}`;
const opt = (priceCents: number, isHidden = false) => ({
  priceCents,
  isFree: priceCents === 0,
  isHidden,
});
const exp = (over: Partial<HostPriceExperience>): HostPriceExperience => ({
  isFree: false,
  pricingMode: "whole",
  wholePriceCents: 500_000,
  ticket: opt(500_000),
  tickets: [opt(500_000)],
  ...over,
});

describe("issue #3645 — experienceHostPriceLabel", () => {
  test("Kids 0 beside Adult 5000 is labelled by its price, not Free", () => {
    const kids = exp({ ticket: opt(0), tickets: [opt(0), opt(500_000)] });
    expect(experienceHostPriceLabel(kids, fmt)).toBe("N5000");
  });

  test("whole mode with one price shows the whole price", () => {
    expect(experienceHostPriceLabel(exp({}), fmt)).toBe("N5000");
  });

  test("paid options at different prices read From the lowest", () => {
    const tiers = exp({
      wholePriceCents: 300_000,
      ticket: opt(300_000),
      tickets: [opt(300_000), opt(800_000)],
    });
    expect(experienceHostPriceLabel(tiers, fmt)).toBe("From N3000");
  });

  test("hidden options are not offered, so they do not set the From price", () => {
    const hiddenCheap = exp({ tickets: [opt(500_000), opt(100_000, true)] });
    expect(experienceHostPriceLabel(hiddenCheap, fmt)).toBe("N5000");
  });

  test("a free choice with every option at 0 is Free", () => {
    const free = exp({ isFree: true, wholePriceCents: 0, ticket: opt(0), tickets: [opt(0)] });
    expect(experienceHostPriceLabel(free, fmt)).toBe("Free");
  });

  test("a detail without isFree falls back to the first option", () => {
    expect(
      experienceHostPriceLabel(
        exp({ isFree: undefined, wholePriceCents: 0, ticket: opt(0), tickets: [opt(0)] }),
        fmt,
      ),
    ).toBe("Free");
    expect(experienceHostPriceLabel(exp({ isFree: undefined }), fmt)).toBe("N5000");
  });

  test("per-stop with no whole price shows the ticket's price, not a dash", () => {
    const perStop = exp({ pricingMode: "per_stop", wholePriceCents: null });
    expect(experienceHostPriceLabel(perStop, fmt)).toBe("N5000");
  });

  test("no ticket at all is a dash", () => {
    expect(experienceHostPriceLabel(exp({ ticket: null, tickets: [] }), fmt)).toBe("—");
  });

  test("the detail screen uses it, not the first option's isFree", () => {
    const screen = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "app", "experience", "[id]", "index.tsx"),
      "utf8",
    );
    expect(screen).toMatch(/const priceLabel = experienceHostPriceLabel\(experience,/);
    expect(screen).not.toMatch(/ticket\.isFree\s*\n?\s*\?\s*"Free"/);
  });
});
