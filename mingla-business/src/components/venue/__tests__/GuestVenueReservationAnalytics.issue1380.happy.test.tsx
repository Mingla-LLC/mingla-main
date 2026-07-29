import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mockCaptureWeb = jest.fn();
const mockCreateReservation = jest.fn((_input: unknown) =>
  Promise.resolve({
    kind: "free_completed" as const,
    reservationId: "reservation-1380",
  }),
);

jest.mock("../../../analytics/webAnalytics", () => ({
  __esModule: true,
  captureWeb: (...args: unknown[]) => mockCaptureWeb(...args),
  getStoredClickAttribution: () => ({ clickId: null }),
}));

jest.mock("../../../hooks/usePublicVenueAvailability", () => ({
  __esModule: true,
  usePublicVenueAvailability: () => ({
    data: [
      {
        slotStartUtc: "2026-07-30T23:00:00.000Z",
        slotLocalLabel: "7:00 PM",
        isFull: false,
      },
    ],
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));

jest.mock("../../../services/venueGuestReservationService", () => ({
  __esModule: true,
  createGuestVenueReservation: (input: unknown) =>
    mockCreateReservation(input),
}));

jest.mock("../../../utils/phone", () => ({
  __esModule: true,
  composeE164: () => "+19195550180",
}));

jest.mock("@mingla/phone-input", () => ({
  __esModule: true,
  PhoneInput: (props: Record<string, unknown>) => {
    const ReactActual = require("react") as typeof React;
    return ReactActual.createElement("PhoneInput", props);
  },
  getCountryByCode: () => ({ dialCode: "+1" }),
  getDefaultCountryCode: () => "US",
}));

jest.mock("../../ui/Button", () => ({
  __esModule: true,
  Button: ({
    label,
    onPress,
    accessibilityLabel,
  }: {
    label: string;
    onPress: () => void;
    accessibilityLabel?: string;
  }) => {
    const ReactActual = require("react") as typeof React;
    const { Pressable } = require("react-native") as {
      Pressable: React.ComponentType<Record<string, unknown>>;
    };
    return ReactActual.createElement(Pressable, {
      accessibilityRole: "button",
      accessibilityLabel: accessibilityLabel ?? label,
      onPress,
    });
  },
}));

jest.mock("../../ui/Input", () => ({
  __esModule: true,
  Input: (props: Record<string, unknown>) => {
    const ReactActual = require("react") as typeof React;
    return ReactActual.createElement("Input", props);
  },
}));

jest.mock("../../ui/Icon", () => ({
  __esModule: true,
  Icon: () => null,
}));

import { GuestVenueReservation } from "../GuestVenueReservation";

interface TestInstance {
  props: Record<string, unknown>;
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}

interface TestRendererInstance {
  root: TestInstance;
  unmount: () => void;
}

const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => TestRendererInstance;
  act: (callback: () => Promise<void> | void) => Promise<void> | void;
};

const invoke = (
  node: TestInstance,
  prop: "onPress" | "onChangeText",
  value?: string,
): void => {
  const callback = node.props[prop];
  if (typeof callback !== "function") {
    throw new Error(`Expected ${prop} callback`);
  }
  callback(value);
};

describe("issue #1380 guest reservation analytics", () => {
  test("submission emits submitted, never a second started event, and carries no guest PII", async () => {
    mockCaptureWeb.mockClear();
    mockCreateReservation.mockClear();
    let tree!: TestRendererInstance;

    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <GuestVenueReservation
          venueId="venue-1380"
          brandId="brand-1380"
          currency="USD"
          analyticsSurface="business_preview"
        />,
      );
    });
    const slot = tree.root.findAll(
      (node) => node.props.accessibilityLabel === "Select 7:00 PM",
    )[0];
    await TestRenderer.act(async () => {
      invoke(slot, "onPress");
    });

    const name = tree.root.findAll(
      (node) => node.props.accessibilityLabel === "Name",
    )[0];
    const email = tree.root.findAll(
      (node) => node.props.accessibilityLabel === "Email",
    )[0];
    await TestRenderer.act(async () => {
      invoke(name, "onChangeText", "Seth");
      invoke(email, "onChangeText", "seth@example.com");
    });

    const confirm = tree.root.findAll(
      (node) => node.props.accessibilityLabel === "Confirm reservation",
    )[0];
    await TestRenderer.act(async () => {
      invoke(confirm, "onPress");
      await Promise.resolve();
      await Promise.resolve();
    });

    const submitted = mockCaptureWeb.mock.calls.filter(
      ([event]) => event === "public_venue_reservation_submitted",
    );
    const started = mockCaptureWeb.mock.calls.filter(
      ([event]) => event === "public_venue_reservation_started",
    );
    expect(submitted).toHaveLength(1);
    expect(started).toHaveLength(0);
    expect(submitted[0]?.[1]).toEqual({
      surface: "business_preview",
      brand_id: "brand-1380",
      venue_id: "venue-1380",
      currency: "USD",
    });
    expect(Object.keys(submitted[0]?.[1] as Record<string, unknown>)).not.toEqual(
      expect.arrayContaining([
        "name",
        "email",
        "phone",
        "notes",
        "occasion",
        "reservation_token",
      ]),
    );
    expect(mockCreateReservation).toHaveBeenCalledTimes(1);

    await TestRenderer.act(async () => {
      tree.unmount();
    });
  });
});
