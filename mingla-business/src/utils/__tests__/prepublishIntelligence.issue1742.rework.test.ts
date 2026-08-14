import fs from "node:fs";
import path from "node:path";

import { TurnoutGateSessionClaims } from "../../components/intel/TurnoutIntelContext";
import type { TurnoutReport } from "../../types/growthTools";
import {
  buildTurnoutGateRecommendations,
  buildTurnoutInput,
  shouldTrackGatePublishedAnyway,
  withExperienceModelEstimate,
  type TurnoutInputSource,
} from "../turnoutInput";

const root = path.resolve(__dirname, "../../..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(root, relative), "utf8");

const future = (): string => {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
};

const unlimitedSource = (): TurnoutInputSource => ({
  kind: "experience",
  title: "Lagos Art Walk",
  intents: ["romantic"],
  stops: [
    {
      clientId: "one",
      placeId: null,
      placeName: "Art Roost",
      address: "2 Alexander Avenue",
      city: "Lagos",
      region: null,
      countryCode: "NG",
      lat: 6.4,
      lng: 3.4,
      imageUrls: [],
      startTime: "18:00",
      priceMajor: "0",
      description: "Meet here",
    },
  ],
  when: {
    whenMode: "single",
    date: future(),
    doorsOpen: "18:00",
    endsAt: "21:00",
    timezone: "Africa/Lagos",
    recurrenceRule: null,
    multiDates: null,
  },
  pricingMode: "whole",
  resolvedTotalMajor: 25.555,
  isFree: false,
  capacity: "20",
  unlimited: true,
  brandDefaultCurrency: "NGN",
});

describe("#1742 implementor rework proof", () => {
  it("keeps an unlimited estimate model-only while producing a rounded canonical input", () => {
    const source = unlimitedSource();
    const modeled = withExperienceModelEstimate(source, 50);
    expect(source).toMatchObject({ unlimited: true, capacity: "20" });
    expect(modeled).toMatchObject({ unlimited: false, capacity: "50" });
    expect(buildTurnoutInput(modeled)).toMatchObject({
      ok: true,
      input: { capacity: 50, ticket_price: 25.56 },
    });
    if (source.kind !== "experience") throw new Error("fixture drifted");
    expect(
      buildTurnoutInput({
        ...source,
        unlimited: false,
        resolvedTotalMajor: Number.NaN,
      }),
    ).toEqual({ ok: false, reason: "invalid_price" });
  });

  it("builds the same ordered, severity-labeled recommendation truth for every gate", () => {
    const report: TurnoutReport = {
      fixes: [{ title: "Move to Friday", change: "Change the date" }],
      factors: [
        { key: "ticket_price", label: "Premium position", status: "hurt" },
      ],
      competitors: [{ name: "Other show" }],
      plan: { kind: "paid_optimized", read: "Ads can add reach" },
    };
    const rows = buildTurnoutGateRecommendations(
      report,
      {
        title: "x",
        category: "x",
        city: "x",
        venue_name: "x",
        date: future(),
        indoor_outdoor: "indoor",
        ticket_price: 25,
        capacity: 50,
        budget: 0,
        audience_size: null,
        lineup: null,
      },
      "experience",
    );
    expect(rows.map((row) => row.id)).toEqual([
      "fix",
      "hurt",
      "competitors",
      "plan",
    ]);
    expect(rows.map((row) => row.severityWord)).toEqual([
      "Info",
      "Warning",
      "Info",
      "Info",
    ]);
    expect(rows[1].target).toMatchObject({ step: 3, focus: "price" });
    expect(rows[3].copy).toBe("promo can add reach");
  });

  it("claims a gate once under repeated taps and only tracks real blocked continuations", () => {
    const session = new TurnoutGateSessionClaims();
    expect(session.claim("key-a")).toBe("claimed");
    expect(session.claim("key-a")).toBe("active");
    session.dismiss("key-a");
    expect(session.claim("key-a")).toBe("seen");
    expect(session.claim("key-b")).toBe("claimed");

    for (const state of ["running", "failed", "rate_limited", "blocked"] as const) {
      expect(shouldTrackGatePublishedAnyway(state)).toBe(true);
    }
    for (const state of ["fresh", "ran", "demand_read"] as const) {
      expect(shouldTrackGatePublishedAnyway(state)).toBe(false);
    }
  });

  it("keeps estimate/session ownership in the provider and cancels a publish-mid-run result", () => {
    const provider = read("src/components/intel/TurnoutIntelProvider.tsx");
    const wizard = read("src/components/experience/ExperienceCreatorWizard.tsx");
    expect(provider).toContain("useState<TurnoutEstimateState>");
    expect(provider).toContain("new TurnoutGateSessionClaims()");
    expect(provider).toContain("withExperienceModelEstimate");
    expect(wizard).not.toContain("setTurnoutEstimate");
    expect(wizard).not.toContain("shownGateKeys");
    expect(wizard).toContain("shouldTrackGatePublishedAnyway(gateState)");
    expect(wizard).toContain("controller.cancelPending()");
    expect(wizard).toContain("sessionRef={intelSessionRef}");
    const hook = read("src/hooks/useTurnoutForecast.ts");
    expect(hook).toContain('if (state === "running") return "running"');
    expect(hook).not.toContain(
      'state === "running" || state === "eligible"',
    );
  });
});
