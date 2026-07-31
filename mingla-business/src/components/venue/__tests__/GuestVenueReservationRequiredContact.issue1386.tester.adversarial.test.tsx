import React from "react";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mockCaptureWeb = jest.fn();
let mockNormalizedPhone: string | null = "+12025550146";
const mockCreateReservation =
  jest.fn<(input: unknown) => Promise<Record<string, unknown>>>();

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

const invoke = (
  node: TestInstance,
  prop: "onPress" | "onChangeText" | "onChangePhone" | "onBlur",
  value?: string,
): void => {
  const callback = node.props[prop];
  if (typeof callback !== "function") {
    throw new Error(`Expected ${prop} callback`);
  }
  callback(value);
};

const renderSelectedForm = async (
  analyticsSurface: "buyer_web" | "business_preview" = "buyer_web",
): Promise<TestRendererInstance> => {
  let tree!: TestRendererInstance;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <GuestVenueReservation
        venueId="venue-tester-1386"
        brandId="brand-tester-1386"
        currency="USD"
        analyticsSurface={analyticsSurface}
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

const setContact = async (
  tree: TestRendererInstance,
  name: string,
  email: string,
): Promise<void> => {
  await TestRenderer.act(async () => {
    invoke(
      findByProp(tree.root, "aria-label", "Name, required"),
      "onChangeText",
      name,
    );
    invoke(
      findByProp(tree.root, "aria-label", "Email, required"),
      "onChangeText",
      email,
    );
  });
};

const submitProgrammatically = async (
  tree: TestRendererInstance,
): Promise<void> => {
  await TestRenderer.act(async () => {
    invoke(
      findByProp(tree.root, "label", "Confirm reservation"),
      "onPress",
    );
    await Promise.resolve();
    await Promise.resolve();
  });
};

const unmount = async (tree: TestRendererInstance): Promise<void> => {
  await TestRenderer.act(async () => {
    tree.unmount();
  });
};

describe("issue #1386 tester adversarial reservation contact contract", () => {
  beforeEach(() => {
    mockNormalizedPhone = "+12025550146";
    mockCaptureWeb.mockClear();
    mockCreateReservation.mockReset();
    mockCreateReservation.mockResolvedValue({
      kind: "free_completed",
      reservationId: "reservation-tester-1386",
    });
  });

  test.each(["", "   ", "Q"])(
    "rejects every invalid normalized-name class before analytics or transport",
    async (invalidName) => {
      const tree = await renderSelectedForm();
      await setContact(tree, invalidName, "valid@example.invalid");

      expect(
        findByProp(tree.root, "label", "Confirm reservation").props.disabled,
      ).toBe(true);
      await submitProgrammatically(tree);

      expect(findText(tree.root, "Enter your name.")).toHaveLength(1);
      expect(findText(tree.root, "Enter a valid email address.")).toHaveLength(0);
      expect(mockCreateReservation).not.toHaveBeenCalled();
      expect(
        mockCaptureWeb.mock.calls.filter(
          ([event]) => event === "public_venue_reservation_submitted",
        ),
      ).toHaveLength(0);
      await unmount(tree);
    },
  );

  test.each(["", "   ", "missing-at", "guest@", "guest@example"])(
    "rejects every malformed normalized-email class before analytics or transport",
    async (invalidEmail) => {
      const tree = await renderSelectedForm();
      await setContact(tree, "Valid Guest", invalidEmail);

      expect(
        findByProp(tree.root, "label", "Confirm reservation").props.disabled,
      ).toBe(true);
      await submitProgrammatically(tree);

      expect(findText(tree.root, "Enter your name.")).toHaveLength(0);
      expect(findText(tree.root, "Enter a valid email address.")).toHaveLength(1);
      expect(mockCreateReservation).not.toHaveBeenCalled();
      expect(
        mockCaptureWeb.mock.calls.filter(
          ([event]) => event === "public_venue_reservation_submitted",
        ),
      ).toHaveLength(0);
      await unmount(tree);
    },
  );

  test("uses field-specific alerts, clears each touched field immediately, and accepts surrounding email spaces", async () => {
    const tree = await renderSelectedForm();
    const name = findByProp(tree.root, "aria-label", "Name, required");
    const email = findByProp(tree.root, "aria-label", "Email, required");

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
      invoke(name, "onChangeText", "Valid Guest");
    });
    expect(findText(tree.root, "Enter your name.")).toHaveLength(0);
    expect(findText(tree.root, "Enter a valid email address.")).toHaveLength(1);

    await TestRenderer.act(async () => {
      invoke(email, "onChangeText", "  valid@example.invalid  ");
    });
    expect(findText(tree.root, "Enter a valid email address.")).toHaveLength(0);
    expect(
      findByProp(tree.root, "label", "Confirm reservation").props.disabled,
    ).toBe(false);
    await unmount(tree);
  });

  test("keeps phone outside the contact-disabled predicate and adds submitting only while the request is pending", async () => {
    mockNormalizedPhone = null;
    let releaseRequest!: () => void;
    mockCreateReservation.mockImplementation(
      () =>
        new Promise((resolveRequest) => {
          releaseRequest = () =>
            resolveRequest({
              kind: "free_completed",
              reservationId: "reservation-tester-1386",
            });
        }),
    );
    const tree = await renderSelectedForm();
    await setContact(tree, "Valid Guest", "valid@example.invalid");
    const confirm = findByProp(tree.root, "label", "Confirm reservation");

    expect(confirm.props.disabled).toBe(false);
    await submitProgrammatically(tree);
    expect(mockCreateReservation).not.toHaveBeenCalled();
    expect(findText(tree.root, "Enter a valid phone number.")).toHaveLength(1);

    mockNormalizedPhone = "+12025550146";
    await TestRenderer.act(async () => {
      invoke(
        tree.root.findAll((node) => node.type === "PhoneInput")[0] as TestInstance,
        "onChangePhone",
        "2025550146",
      );
    });
    await TestRenderer.act(async () => {
      invoke(confirm, "onPress");
      await Promise.resolve();
    });
    expect(mockCreateReservation).toHaveBeenCalledTimes(1);
    expect(
      findByProp(tree.root, "label", "Confirm reservation").props.disabled,
    ).toBe(true);
    await TestRenderer.act(async () => {
      releaseRequest();
      await Promise.resolve();
      await Promise.resolve();
    });
    await unmount(tree);
  });

  test.each([
    ["buyer_name_required", "Enter your name.", "Enter a valid email address."],
    [
      "buyer_email_invalid",
      "Enter a valid email address.",
      "Enter your name.",
    ],
  ])(
    "maps an authoritative contact rejection only to its matching field",
    async (code, expectedCopy, excludedCopy) => {
      mockCreateReservation.mockRejectedValueOnce(new Error(code));
      const tree = await renderSelectedForm("business_preview");
      await setContact(tree, "Valid Guest", "valid@example.invalid");
      await submitProgrammatically(tree);

      expect(findText(tree.root, expectedCopy)).toHaveLength(1);
      expect(findText(tree.root, excludedCopy)).toHaveLength(0);
      expect(
        findText(
          tree.root,
          "We couldn’t start your reservation. Check your details and try again.",
        ),
      ).toHaveLength(0);
      await unmount(tree);
    },
  );

  test("retains generic failure copy for an unrelated service rejection", async () => {
    mockCreateReservation.mockRejectedValueOnce(
      new Error("venue_not_reservable"),
    );
    const tree = await renderSelectedForm();
    await setContact(tree, "Valid Guest", "valid@example.invalid");
    await submitProgrammatically(tree);

    expect(findText(tree.root, "Enter your name.")).toHaveLength(0);
    expect(findText(tree.root, "Enter a valid email address.")).toHaveLength(0);
    expect(
      findText(
        tree.root,
        "We couldn’t start your reservation. Check your details and try again.",
      ),
    ).toHaveLength(1);
    await unmount(tree);
  });

  test.each(["buyer_web", "business_preview"] as const)(
    "keeps guest contact out of analytics on every shared web surface",
    async (surface) => {
      const syntheticName = "Synthetic Guest";
      const syntheticEmail = "synthetic@example.invalid";
      const syntheticPhone = "+12025550146";
      const tree = await renderSelectedForm(surface);
      await setContact(tree, syntheticName, syntheticEmail);
      await submitProgrammatically(tree);

      expect(mockCreateReservation).toHaveBeenCalledTimes(1);
      const analyticsJson = JSON.stringify(mockCaptureWeb.mock.calls);
      expect(analyticsJson).not.toContain(syntheticName);
      expect(analyticsJson).not.toContain(syntheticEmail);
      expect(analyticsJson).not.toContain(syntheticPhone);
      expect(
        mockCaptureWeb.mock.calls.filter(
          ([event]) => event === "public_venue_reservation_submitted",
        ),
      ).toEqual([
        [
          "public_venue_reservation_submitted",
          {
            surface,
            brand_id: "brand-tester-1386",
            venue_id: "venue-tester-1386",
            currency: "USD",
          },
        ],
      ]);
      await unmount(tree);
    },
  );

  test("pins the unchanged edge authority hash and contact-before-side-effects order", () => {
    const edgePath = resolve(
      __dirname,
      "../../../../../supabase/functions/venue-reservation-create/index.ts",
    );
    const source = readFileSync(edgePath, "utf8");

    expect(createHash("sha256").update(source).digest("hex")).toBe(
      "a875199585a8614879cca120921fed36f08ca1ccc73e0458709f07c247856088",
    );
    const venueGate = source.indexOf('return jsonResponse({ error: "venue_id_required"');
    const partyGate = source.indexOf('return jsonResponse({ error: "party_size_invalid"');
    const nameGate = source.indexOf('return jsonResponse({ error: "buyer_name_required"');
    const emailGate = source.indexOf('return jsonResponse({ error: "buyer_email_invalid"');
    const phoneGate = source.indexOf('return jsonResponse({ error: "buyer_phone_required"');
    const timeParsing = source.indexOf("Date.parse(reservedForUtc)");
    const authResolution = source.indexOf("userIdFromAuthHeader(req)");
    const serviceClientCreation = source.indexOf("serviceClient()");
    const firstDatabaseRead = source.indexOf('.from("venue_listings")');

    for (const index of [
      venueGate,
      partyGate,
      nameGate,
      emailGate,
      phoneGate,
      timeParsing,
      authResolution,
      serviceClientCreation,
      firstDatabaseRead,
    ]) {
      expect(index).toBeGreaterThan(-1);
    }
    expect(venueGate).toBeLessThan(partyGate);
    expect(partyGate).toBeLessThan(nameGate);
    expect(nameGate).toBeLessThan(emailGate);
    expect(emailGate).toBeLessThan(phoneGate);
    expect(phoneGate).toBeLessThan(timeParsing);
    expect(timeParsing).toBeLessThan(authResolution);
    expect(authResolution).toBeLessThan(serviceClientCreation);
    expect(serviceClientCreation).toBeLessThan(firstDatabaseRead);
  });
});
