import React from "react";

import type { TurnoutForecastController } from "../../../hooks/useTurnoutForecast";
import type { TurnoutInputSource } from "../../../utils/turnoutInput";
import type { TurnoutIntelSessionController } from "../TurnoutIntelContext";
import { TurnoutIntelProvider } from "../TurnoutIntelProvider";
import { PrePublishGateSheet } from "../PrePublishGateSheet";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../TurnoutIntelObserver", () => {
  const ReactRuntime = jest.requireActual("react") as typeof React;
  const MockObserver = ({
    source,
    onController,
  }: {
    source: TurnoutInputSource;
    onController: (controller: TurnoutForecastController) => void;
  }): null => {
    ReactRuntime.useEffect(() => {
      const finiteCapacity =
        source.kind === "experience" && !source.unlimited
          ? Number(source.capacity)
          : null;
      const capacity = finiteCapacity ?? 0;
      const finite = Number.isInteger(capacity) && capacity > 0;
      const input = finite
        ? {
            title: "Gallery preview",
            category: "Romantic",
            city: "Lagos",
            venue_name: "Art Roost",
            date: "2027-08-29",
            indoor_outdoor: "indoor" as const,
            ticket_price: 25,
            capacity,
            budget: 0 as const,
            audience_size: null,
            lineup: null,
          }
        : null;
      onController({
        state: finite ? "result" : "idle",
        report: finite
          ? {
              forecast: {
                total_low: capacity === 50 ? 30 : 24,
                total_high: capacity === 50 ? 42 : 36,
                capacity,
                confidence: "medium",
              },
              fixes: [],
              factors: [],
              competitors: [],
              demand_read: "Demand is strongest after work.",
              meta: {
                generated_at: new Date().toISOString(),
                research_source: "grounded",
              },
            }
          : null,
        result: null,
        blockReason: finite ? null : "unlimited_capacity",
        input,
        inputKey: finite ? `capacity:${capacity}` : null,
        inputHash: finite ? `hash:${capacity}` : null,
        run: jest.fn(async (): Promise<void> => undefined),
        trackReportOpened: jest.fn(),
        updateFailureCount: 0,
        gateFailureCount: 0,
        fresh: finite,
        gateState: jest.fn(() => "fresh"),
        gateAnalyticsProps: jest.fn(() => ({ gate_state: "fresh" })),
        cancelPending: jest.fn(),
      });
    }, [onController, source]);
    return null;
  };
  return {
    __esModule: true,
    default: MockObserver,
  };
});
jest.mock("../../ui/Sheet", () => ({
  Sheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? React.createElement("Sheet", null, children) : null,
}));
jest.mock("../../ui/Button", () => ({
  Button: ({ label, onPress }: { label: string; onPress: () => void }) =>
    React.createElement("Button", { onPress }, label),
}));
jest.mock("../IntelProgress", () => ({
  IntelProgress: () => React.createElement("Progress"),
}));
jest.mock("../../../services/postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));

interface TestRenderer {
  toJSON: () => unknown;
  update: (node: React.ReactElement) => void;
}

// The repository intentionally omits @types/react-test-renderer.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (work: () => void | Promise<void>) => Promise<void> | void;
  create: (node: React.ReactElement) => TestRenderer;
};

const source = (unlimited: boolean, capacity: string): TurnoutInputSource => ({
  kind: "experience",
  title: "Gallery preview",
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
    date: "2027-08-29",
    doorsOpen: "18:00",
    endsAt: "21:00",
    timezone: "Africa/Lagos",
    recurrenceRule: null,
    multiDates: null,
  },
  pricingMode: "whole",
  resolvedTotalMajor: 25,
  isFree: false,
  capacity,
  unlimited,
  brandDefaultCurrency: "NGN",
});

const textContent = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(textContent).join("");
  if (value !== null && typeof value === "object" && "children" in value) {
    return textContent((value as { children?: unknown }).children);
  }
  return "";
};

describe("#1742 Experience estimate source transition", () => {
  it("clears an unlimited estimate when the source becomes finite and never resurrects it", async () => {
    const sessionRef: React.MutableRefObject<TurnoutIntelSessionController | null> = {
      current: null,
    };
    const view = (turnoutSource: TurnoutInputSource): React.ReactElement => (
      <TurnoutIntelProvider
        source={turnoutSource}
        brandId="brand-1"
        wizard="experience"
        surface="experience_cover"
        previewActive
        keyboardVisible={false}
        autoRunEnabled={false}
        sessionRef={sessionRef}
      >
        <PrePublishGateSheet
          visible
          onClose={jest.fn()}
          onPublish={jest.fn()}
        />
      </TurnoutIntelProvider>
    );

    const holder: { instance: TestRenderer | null } = { instance: null };
    await act(async () => {
      holder.instance = create(view(source(true, "20")));
      await Promise.resolve();
    });
    const renderer = holder.instance;
    if (renderer === null) throw new Error("provider did not mount");
    const initialSession = sessionRef.current;
    if (initialSession === null) throw new Error("session did not mount");

    await act(async () => {
      initialSession.setEstimate(50);
      await Promise.resolve();
    });
    expect(textContent(renderer.toJSON())).toContain(
      "MODELED · your estimate of ~50",
    );

    await act(async () => {
      renderer.update(view(source(false, "40")));
      await Promise.resolve();
    });
    const finiteText = textContent(renderer.toJSON());
    expect(finiteText).toContain("24–36 of 40");
    expect(finiteText).not.toContain("people expected");
    expect(finiteText).not.toContain("your estimate of ~50");
    expect(sessionRef.current?.estimate).toEqual({ kind: "unanswered" });

    await act(async () => {
      renderer.update(view(source(true, "20")));
      await Promise.resolve();
    });
    const reopenedUnlimitedText = textContent(renderer.toJSON());
    expect(reopenedUnlimitedText).toContain(
      "About how many people could join?",
    );
    expect(reopenedUnlimitedText).not.toContain("your estimate of ~50");
  });
});
