import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mockCaptureWeb = jest.fn();
let mockNormalizedPhone: string | null = "+19195550180";
const mockCreateReservation = jest.fn((_input: unknown) =>
  Promise.resolve({
    kind: "free_completed" as const,
    reservationId: "reservation-1386",
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
  composeE164: () => mockNormalizedPhone,
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
  Button: (props: Record<string, unknown>) => {
    const ReactActual = require("react") as typeof React;
    return ReactActual.createElement("Button", props);
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
  type: unknown;
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

const findByProp = (
  root: TestInstance,
  prop: string,
  value: unknown,
): TestInstance =>
  root.findAll((node) => node.props[prop] === value)[0] as TestInstance;

const findText = (root: TestInstance, copy: string): TestInstance[] =>
  root.findAll(
    (node) => typeof node.type === "string" && node.props.children === copy,
  );

const unmount = async (tree: TestRendererInstance): Promise<void> => {
  await TestRenderer.act(async () => {
    tree.unmount();
  });
};

const invoke = (
  node: TestInstance,
  prop: "onPress" | "onChangeText" | "onBlur",
  value?: string,
): void => {
  const callback = node.props[prop];
  if (typeof callback !== "function") {
    throw new Error(`Expected ${prop} callback`);
  }
  callback(value);
};

const renderSelectedForm = async (): Promise<TestRendererInstance> => {
  let tree!: TestRendererInstance;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <GuestVenueReservation
        venueId="venue-1386"
        brandId="brand-1386"
        currency="USD"
        analyticsSurface="buyer_web"
      />,
    );
  });
  await TestRenderer.act(async () => {
    invoke(
      findByProp(tree.root, "accessibilityLabel", "Select 7:00 PM"),
      "onPress",
    );
  });
  return tree;
};

describe("issue #1386 required reservation contact", () => {
  beforeEach(() => {
    mockNormalizedPhone = "+19195550180";
  });

  test("shows persistent required labels, exact web names, touched errors, and contact-only disabled state", async () => {
    const tree = await renderSelectedForm();
    const name = findByProp(tree.root, "aria-label", "Name, required");
    const email = findByProp(tree.root, "aria-label", "Email, required");

    expect(findText(tree.root, "NAME · REQUIRED")).toHaveLength(1);
    expect(findText(tree.root, "EMAIL · REQUIRED")).toHaveLength(1);
    expect(
      findByProp(tree.root, "label", "Confirm reservation").props.disabled,
    ).toBe(true);
    expect(findText(tree.root, "Enter your name.")).toHaveLength(0);
    expect(findText(tree.root, "Enter a valid email address.")).toHaveLength(0);

    await TestRenderer.act(async () => {
      invoke(name, "onBlur");
      invoke(email, "onBlur");
    });
    const nameError = findText(tree.root, "Enter your name.");
    const emailError = findText(tree.root, "Enter a valid email address.");
    expect(nameError).toHaveLength(1);
    expect(emailError).toHaveLength(1);
    expect(nameError[0]?.props).toEqual(
      expect.objectContaining({
        accessibilityRole: "alert",
        accessibilityLiveRegion: "polite",
      }),
    );
    expect(emailError[0]?.props).toEqual(
      expect.objectContaining({
        accessibilityRole: "alert",
        accessibilityLiveRegion: "polite",
      }),
    );

    await TestRenderer.act(async () => {
      invoke(name, "onChangeText", "Ada");
      invoke(email, "onChangeText", "ada@example.com");
    });
    expect(findText(tree.root, "Enter your name.")).toHaveLength(0);
    expect(findText(tree.root, "Enter a valid email address.")).toHaveLength(0);
    expect(
      findByProp(tree.root, "label", "Confirm reservation").props.disabled,
    ).toBe(false);
    await unmount(tree);
  });

  test("phone validity does not enter the new contact-disabled predicate", async () => {
    mockNormalizedPhone = null;
    const tree = await renderSelectedForm();

    await TestRenderer.act(async () => {
      invoke(
        findByProp(tree.root, "aria-label", "Name, required"),
        "onChangeText",
        "Ada",
      );
      invoke(
        findByProp(tree.root, "aria-label", "Email, required"),
        "onChangeText",
        "ada@example.com",
      );
    });

    expect(
      findByProp(tree.root, "label", "Confirm reservation").props.disabled,
    ).toBe(false);
    await unmount(tree);
  });

  test("defensive submit guard marks invalid fields and returns before analytics or network", async () => {
    mockCaptureWeb.mockClear();
    mockCreateReservation.mockClear();
    const tree = await renderSelectedForm();

    await TestRenderer.act(async () => {
      invoke(
        findByProp(tree.root, "label", "Confirm reservation"),
        "onPress",
      );
    });

    expect(findText(tree.root, "Enter your name.")).toHaveLength(1);
    expect(findText(tree.root, "Enter a valid email address.")).toHaveLength(1);
    expect(mockCreateReservation).not.toHaveBeenCalled();
    expect(
      mockCaptureWeb.mock.calls.filter(
        ([event]) => event === "public_venue_reservation_submitted",
      ),
    ).toHaveLength(0);
    await unmount(tree);
  });

  test.each([
    ["buyer_name_required", "Enter your name."],
    ["buyer_email_invalid", "Enter a valid email address."],
  ])("maps edge code %s to its field without exposing contact data", async (code, copy) => {
    mockCaptureWeb.mockClear();
    mockCreateReservation.mockReset();
    mockCreateReservation.mockRejectedValueOnce(new Error(code));
    const tree = await renderSelectedForm();

    await TestRenderer.act(async () => {
      invoke(
        findByProp(tree.root, "aria-label", "Name, required"),
        "onChangeText",
        "Ada",
      );
      invoke(
        findByProp(tree.root, "aria-label", "Email, required"),
        "onChangeText",
        "ada@example.com",
      );
    });
    await TestRenderer.act(async () => {
      invoke(
        findByProp(tree.root, "label", "Confirm reservation"),
        "onPress",
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(findText(tree.root, copy)).toHaveLength(1);
    expect(findText(tree.root, code)).toHaveLength(0);
    expect(
      mockCaptureWeb.mock.calls.filter(
        ([event]) => event === "venue_reservation_failed",
      ),
    ).toHaveLength(1);
    await TestRenderer.act(async () => {
      invoke(
        findByProp(
          tree.root,
          "aria-label",
          code === "buyer_name_required"
            ? "Name, required"
            : "Email, required",
        ),
        "onChangeText",
        code === "buyer_name_required" ? "Grace" : "grace@example.com",
      );
    });
    expect(findText(tree.root, copy)).toHaveLength(0);
    await unmount(tree);
  });

  test("valid contact submits once with normalized values and unchanged non-PII analytics", async () => {
    mockCaptureWeb.mockClear();
    mockCreateReservation.mockReset();
    mockCreateReservation.mockResolvedValueOnce({
      kind: "free_completed",
      reservationId: "reservation-1386",
    });
    const tree = await renderSelectedForm();

    await TestRenderer.act(async () => {
      invoke(
        findByProp(tree.root, "aria-label", "Name, required"),
        "onChangeText",
        "  Ada Lovelace  ",
      );
      invoke(
        findByProp(tree.root, "aria-label", "Email, required"),
        "onChangeText",
        "  ada@example.com  ",
      );
    });
    await TestRenderer.act(async () => {
      invoke(
        findByProp(tree.root, "label", "Confirm reservation"),
        "onPress",
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockCreateReservation).toHaveBeenCalledTimes(1);
    expect(mockCreateReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        buyer: expect.objectContaining({
          name: "Ada Lovelace",
          email: "ada@example.com",
        }),
      }),
    );
    const submitted = mockCaptureWeb.mock.calls.filter(
      ([event]) => event === "public_venue_reservation_submitted",
    );
    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.[1]).toEqual({
      surface: "buyer_web",
      brand_id: "brand-1386",
      venue_id: "venue-1386",
      currency: "USD",
    });
    await unmount(tree);
  });
});
