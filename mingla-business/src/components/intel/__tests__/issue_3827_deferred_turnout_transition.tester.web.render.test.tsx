/**
 * #3827 tester-owned adversarial guard for the repaired lazy boundary.
 *
 * The implementor guard covers stable image callbacks. This test attacks the
 * other eager-growth source: turnout values must be published from the lazy
 * runtime inside a transition, and teardown must clear the ambient value in a
 * transition as well. That keeps typing urgent without leaving stale context.
 */

import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

import type { TurnoutForecastController } from "../../../hooks/useTurnoutForecast";
import type { TurnoutInputSource } from "../../../utils/turnoutInput";
import { TurnoutIntelRuntime } from "../TurnoutIntelProvider";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const mockController: TurnoutForecastController = {
  state: "result",
  report: null,
  result: null,
  blockReason: null,
  input: {
    title: "Gallery preview",
    category: "Romantic",
    city: "Lagos",
    venue_name: "Art Roost",
    date: "2027-08-29",
    indoor_outdoor: "indoor",
    ticket_price: 25,
    capacity: 40,
    budget: 0,
    audience_size: null,
    lineup: null,
  },
  inputKey: "capacity:40",
  inputHash: "hash:40",
  run: jest.fn(async (): Promise<void> => undefined),
  trackReportOpened: jest.fn(),
  updateFailureCount: 0,
  gateFailureCount: 0,
  fresh: true,
  gateState: jest.fn(() => "fresh" as const),
  gateAnalyticsProps: jest.fn(() => ({ gate_state: "fresh" })),
  cancelPending: jest.fn(),
};

jest.mock("../TurnoutIntelObserver", () => {
  const ReactRuntime = jest.requireActual<typeof React>("react");
  const MockObserver = ({
    onController,
  }: {
    onController: (value: TurnoutForecastController) => void;
  }): null => {
    ReactRuntime.useEffect(() => {
      onController(mockController);
    }, [onController]);
    return null;
  };
  return {
    __esModule: true,
    default: MockObserver,
  };
});

type Renderer = { unmount: () => void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};

const source: TurnoutInputSource = {
  kind: "experience",
  title: "Gallery preview",
  intents: ["romantic"],
  stops: [
    {
      clientId: "stop-1",
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
  capacity: "40",
  unlimited: false,
  brandDefaultCurrency: "NGN",
};

describe("#3827 deferred turnout transition boundary", () => {
  test("publishes and clears ambient values inside transitions", async () => {
    const onValue = jest.fn();
    const controllerRef = { current: null };
    const sessionRef = { current: null };
    const transition = jest.spyOn(React, "startTransition");
    let renderer: Renderer | null = null;

    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        <TurnoutIntelRuntime
          source={source}
          brandId="brand-3827"
          wizard="experience"
          surface="experience_cover"
          previewActive
          keyboardVisible={false}
          autoRunEnabled={false}
          controllerRef={controllerRef}
          sessionRef={sessionRef}
          onValue={onValue}
        />,
      );
      await Promise.resolve();
    });

    expect(transition).toHaveBeenCalled();
    expect(onValue.mock.calls.some(([value]) => value !== null)).toBe(true);
    expect(controllerRef.current).toBe(mockController);
    expect(sessionRef.current).not.toBeNull();

    const transitionsBeforeUnmount = transition.mock.calls.length;
    await TestRenderer.act(async () => {
      renderer?.unmount();
      await Promise.resolve();
    });

    expect(transition.mock.calls.length).toBeGreaterThan(
      transitionsBeforeUnmount,
    );
    expect(onValue).toHaveBeenLastCalledWith(null);
    expect(controllerRef.current).toBeNull();
    expect(sessionRef.current).toBeNull();
    transition.mockRestore();
  });
});
