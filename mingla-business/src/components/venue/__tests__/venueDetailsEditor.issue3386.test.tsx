/**
 * #3386 — venue Settings → Venue details is a real editor.
 *
 * The REAL VenueDetailsEditor is mounted under the stock jest config (bare
 * react-test-renderer). Data hooks, the address field, the category picker and
 * the UI primitives are stubs, so each assertion reads exactly what the editor
 * sends for what the host did.
 *
 *   E-1..E-4  in review: name, category and address save directly
 *   E-5..E-8  live: the same edit is a request; pending card; withdraw
 *   E-9       rejected request: reason shown, dismiss
 *   E-10..12  contact: E.164 + country, specific refusal, saved directly
 *   E-13..14  locked venue / Stay: "Request a change" is the only fallback
 *   E-15      non-managers see no edit controls
 */

import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Linking } from "react-native";

import type {
  VenueContactInput,
  VenueDetailsForHost,
  VenueIdentityPatch,
} from "../../../services/venueDetailsEditService";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mockVenue: VenueDetailsForHost | null = null;
const mockUpdateContact = jest.fn((_input: Omit<VenueContactInput, "venueId">) => undefined);
const mockUpdateIdentity = jest.fn((_patch: VenueIdentityPatch) => undefined);
const mockSubmitRequest = jest.fn((_patch: VenueIdentityPatch) => undefined);
const mockWithdraw = jest.fn((_requestId: string | null) => undefined);

type MutateOpts<T> = { onSuccess?: (value: T) => void; onError?: (e: Error) => void };

jest.mock("../../../hooks/useVenueDetailsEdit", () => ({
  __esModule: true,
  useVenueDetailsForHost: () => ({ data: mockVenue, isError: false }),
  useUpdateVenueContact: () => ({
    isPending: false,
    mutate: (input: Omit<VenueContactInput, "venueId">, opts?: MutateOpts<void>) => {
      mockUpdateContact(input);
      opts?.onSuccess?.(undefined);
    },
  }),
  useUpdateVenueIdentityInReview: () => ({
    isPending: false,
    mutate: (patch: VenueIdentityPatch, opts?: MutateOpts<{ changed: boolean }>) => {
      mockUpdateIdentity(patch);
      opts?.onSuccess?.({ changed: true });
    },
  }),
  useSubmitVenueDetailsChangeRequest: () => ({
    isPending: false,
    mutate: (
      patch: VenueIdentityPatch,
      opts?: MutateOpts<{ requestId: string; replaced: boolean }>,
    ) => {
      mockSubmitRequest(patch);
      opts?.onSuccess?.({ requestId: "req-new", replaced: false });
    },
  }),
  useWithdrawVenueDetailsChangeRequest: () => ({
    isPending: false,
    mutate: (requestId: string | null, opts?: MutateOpts<void>) => {
      mockWithdraw(requestId);
      opts?.onSuccess?.(undefined);
    },
  }),
}));

const mockHost = (name: string) => (props: Record<string, unknown>) => {
  const ReactActual = require("react") as typeof React;
  return ReactActual.createElement(name, props, props.children as React.ReactNode);
};

jest.mock("../../ui/Button", () => ({ __esModule: true, Button: mockHost("Button") }));
jest.mock("../../ui/Input", () => ({
  __esModule: true,
  Input: mockHost("Input"),
  PHONE_COUNTRIES: [
    { iso: "GB", name: "United Kingdom", dialCode: "+44", flag: "" },
    { iso: "NG", name: "Nigeria", dialCode: "+234", flag: "" },
    { iso: "US", name: "United States", dialCode: "+1", flag: "" },
  ],
}));
jest.mock("../../location/MapboxAddressInput", () => ({
  __esModule: true,
  MapboxAddressInput: mockHost("MapboxAddressInput"),
}));
jest.mock("../../brand/VenueCategoryPicker", () => ({
  __esModule: true,
  VenueCategoryPicker: mockHost("VenueCategoryPicker"),
}));
jest.mock("@mingla/location-input", () => ({
  __esModule: true,
  precisionFromPlaceDetails: (details: { featureType?: string }) =>
    details.featureType === "address" || details.featureType === "poi" ? "exact" : "approximate",
}));
jest.mock("../../../utils/resolveApproxLocation", () => ({
  __esModule: true,
  advanceLocationRequestGeneration: (ref: { current: number }) => ++ref.current,
  isLocationRequestGenerationCurrent: (ref: { current: number }, g: number) => ref.current === g,
  isFreeTextResolveStale: (a: string, b: string) => a !== b,
  resolveFreeTextLocation: () => Promise.resolve({ status: "needs_context" }),
}));

import { VenueDetailsEditor } from "../VenueDetailsEditor";

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}
interface Tree {
  root: TestInstance;
  update: (element: React.ReactElement) => void;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const venue = (overrides: Partial<VenueDetailsForHost> = {}): VenueDetailsForHost => ({
  id: "venue-3386",
  brandId: "brand-3386",
  name: "Pending Kitchen",
  venueCategory: "restaurant",
  address: "1 Old Road",
  city: "Lagos",
  countryCode: "NG",
  lat: 6.45,
  lng: 3.4,
  coordinatePrecision: "exact",
  contactPhone: "+2348031234567",
  contactPhoneCountryIso: "NG",
  contactEmail: "old@example.test",
  claimStatus: "pending_review",
  changeRequest: null,
  ...overrides,
});

async function mount(canMutate = true): Promise<Tree> {
  let tree!: Tree;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <VenueDetailsEditor brandId="brand-3386" venueId="venue-3386" canMutate={canMutate} />,
    );
  });
  return tree;
}

function maybeByTestId(root: TestInstance, testID: string): TestInstance | undefined {
  return root.findAll((n) => n.props.testID === testID && typeof n.type === "string")[0];
}
function byTestId(root: TestInstance, testID: string): TestInstance {
  const node = maybeByTestId(root, testID);
  if (node === undefined) throw new Error(`missing testID ${testID}`);
  return node;
}
function byType(root: TestInstance, type: string): TestInstance {
  const node = root.findAll((n) => n.type === type)[0];
  if (node === undefined) throw new Error(`missing ${type}`);
  return node;
}
function textOf(node: TestInstance): string {
  const walk = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(walk).join("");
    if (value !== null && typeof value === "object" && "props" in (value as object)) {
      return walk((value as { props: { children?: unknown } }).props.children);
    }
    return "";
  };
  return walk(node.props.children);
}
function allText(root: TestInstance): string {
  return root
    .findAll((n) => n.type === "Text")
    .map((n) => textOf(n))
    .join("\n");
}
async function press(root: TestInstance, testID: string): Promise<void> {
  await TestRenderer.act(async () => {
    (byTestId(root, testID).props.onPress as () => void)();
  });
}

beforeEach(() => {
  mockVenue = venue();
  mockUpdateContact.mockClear();
  mockUpdateIdentity.mockClear();
  mockSubmitRequest.mockClear();
  mockWithdraw.mockClear();
});

describe("in review — name, category and address save directly", () => {
  test("E-1 the edit button opens the form on the live values", async () => {
    const tree = await mount();
    expect(byTestId(tree.root, "venue-details-edit-identity").props.label).toBe(
      "Edit name, address & category",
    );
    await press(tree.root, "venue-details-edit-identity");
    expect(byTestId(tree.root, "venue-details-name").props.value).toBe("Pending Kitchen");
    expect(byType(tree.root, "MapboxAddressInput").props.selectionState).toBe("selected");
    expect(byTestId(tree.root, "venue-details-save-identity").props.label).toBe("Save changes");
    await TestRenderer.act(async () => tree.unmount());
  });

  test("E-2 a rename saves through the in-review write, never as a request", async () => {
    const tree = await mount();
    await press(tree.root, "venue-details-edit-identity");
    await TestRenderer.act(async () => {
      (byTestId(tree.root, "venue-details-name").props.onChangeText as (v: string) => void)(
        "Pending Kitchen & Bar",
      );
    });
    await press(tree.root, "venue-details-save-identity");
    expect(mockUpdateIdentity).toHaveBeenCalledTimes(1);
    expect(mockUpdateIdentity.mock.calls[0][0]).toEqual({ name: "Pending Kitchen & Bar" });
    expect(mockSubmitRequest).not.toHaveBeenCalled();
    expect(textOf(byTestId(tree.root, "venue-details-notice"))).toMatch(/Saved/);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("E-3 a typed address that was never picked cannot save (#3407)", async () => {
    const tree = await mount();
    await press(tree.root, "venue-details-edit-identity");
    await TestRenderer.act(async () => {
      (byType(tree.root, "MapboxAddressInput").props.onChangeText as (v: string) => void)(
        "11 Somewhere Road",
      );
    });
    await press(tree.root, "venue-details-save-identity");
    expect(mockUpdateIdentity).not.toHaveBeenCalled();
    expect(textOf(byTestId(tree.root, "venue-details-form-error"))).toBe(
      "Choose the address from the list so your map pin is right.",
    );
    await TestRenderer.act(async () => tree.unmount());
  });

  test("E-4 a picked address saves with the pick's pin and precision", async () => {
    const tree = await mount();
    await press(tree.root, "venue-details-edit-identity");
    await TestRenderer.act(async () => {
      (byType(tree.root, "MapboxAddressInput").props.onPick as (d: unknown, l?: string) => void)(
        {
          placeId: "mapbox.abc",
          formattedAddress: "10 New Road, Lekki, Lagos, Nigeria",
          city: "Lagos",
          region: null,
          regionCode: null,
          regionCodeFull: null,
          countryCode: "NG",
          location: { lat: 6.4474, lng: 3.4723 },
          featureType: "address",
        },
        "10 New Road, Lekki",
      );
      (byType(tree.root, "VenueCategoryPicker").props.onChange as (v: string) => void)("play");
    });
    await press(tree.root, "venue-details-save-identity");
    expect(mockUpdateIdentity).toHaveBeenCalledTimes(1);
    expect(mockUpdateIdentity.mock.calls[0][0]).toEqual({
      venueCategory: "play",
      address: {
        address: "10 New Road, Lekki",
        city: "Lagos",
        countryCode: "NG",
        lat: 6.4474,
        lng: 3.4723,
        coordinatePrecision: "exact",
      },
    });
    await TestRenderer.act(async () => tree.unmount());
  });
});

describe("live — the change goes to Mingla", () => {
  test("E-5 the same edit on a live venue is a request, with honest copy", async () => {
    mockVenue = venue({ claimStatus: "verified", name: "Live Lounge" });
    const tree = await mount();
    expect(textOf(byTestId(tree.root, "venue-details-mode-copy"))).toMatch(
      /keeps its current details until it's approved/,
    );
    await press(tree.root, "venue-details-edit-identity");
    expect(byTestId(tree.root, "venue-details-save-identity").props.label).toBe("Send for review");
    await TestRenderer.act(async () => {
      (byTestId(tree.root, "venue-details-name").props.onChangeText as (v: string) => void)(
        "Live Lounge Rooftop",
      );
    });
    await press(tree.root, "venue-details-save-identity");
    expect(mockSubmitRequest).toHaveBeenCalledTimes(1);
    expect(mockSubmitRequest.mock.calls[0][0]).toEqual({ name: "Live Lounge Rooftop" });
    expect(mockUpdateIdentity).not.toHaveBeenCalled();
    expect(textOf(byTestId(tree.root, "venue-details-notice"))).toMatch(/Sent to Mingla/);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("E-6 a pending request shows 'Pending review' with the proposed values", async () => {
    mockVenue = venue({
      claimStatus: "verified",
      name: "Live Lounge",
      changeRequest: {
        requestId: "req-7",
        status: "pending",
        name: "Live Lounge Rooftop",
        venueCategory: null,
        address: {
          address: "20 Admiralty Way",
          city: "Lagos",
          countryCode: "NG",
          lat: 6.43,
          lng: 3.42,
          coordinatePrecision: "approximate",
        },
        requestedAt: "2026-09-15T10:00:00Z",
        reviewedAt: null,
        rejectionReason: null,
      },
    });
    const tree = await mount();
    const pending = byTestId(tree.root, "venue-details-pending");
    const pendingText = pending
      .findAll((n) => n.type === "Text")
      .map((n) => textOf(n))
      .join("\n");
    expect(pendingText).toMatch(/Pending review/);
    expect(pendingText).toMatch(/Name: Live Lounge Rooftop/);
    expect(pendingText).toMatch(/Address: 20 Admiralty Way, Lagos/);
    // The summary still shows what guests see now.
    expect(textOf(byTestId(tree.root, "venue-details-summary").findAll((n) => n.type === "Text")[0])).toBe(
      "Live Lounge",
    );
    expect(byTestId(tree.root, "venue-details-edit-identity").props.label).toBe("Change your request");
    await TestRenderer.act(async () => tree.unmount());
  });

  test("E-7 re-opening a pending request keeps what it proposed and says it replaces it", async () => {
    mockVenue = venue({
      claimStatus: "verified",
      name: "Live Lounge",
      changeRequest: {
        requestId: "req-8",
        status: "pending",
        name: "Live Lounge Rooftop",
        venueCategory: null,
        address: null,
        requestedAt: null,
        reviewedAt: null,
        rejectionReason: null,
      },
    });
    const tree = await mount();
    await press(tree.root, "venue-details-edit-identity");
    expect(byTestId(tree.root, "venue-details-name").props.value).toBe("Live Lounge Rooftop");
    expect(textOf(byTestId(tree.root, "venue-details-identity-help"))).toMatch(/replaces the request/);
    await TestRenderer.act(async () => {
      (byType(tree.root, "VenueCategoryPicker").props.onChange as (v: string) => void)("play");
    });
    await press(tree.root, "venue-details-save-identity");
    expect(mockSubmitRequest.mock.calls[0][0]).toEqual({
      name: "Live Lounge Rooftop",
      venueCategory: "play",
    });
    await TestRenderer.act(async () => tree.unmount());
  });

  test("E-8 withdraw sends the request id on screen", async () => {
    mockVenue = venue({
      claimStatus: "verified",
      changeRequest: {
        requestId: "req-9",
        status: "pending",
        name: "Other",
        venueCategory: null,
        address: null,
        requestedAt: null,
        reviewedAt: null,
        rejectionReason: null,
      },
    });
    const tree = await mount();
    await press(tree.root, "venue-details-withdraw");
    expect(mockWithdraw).toHaveBeenCalledWith("req-9");
    await TestRenderer.act(async () => tree.unmount());
  });

  test("E-9 a rejected request shows Mingla's reason and can be dismissed", async () => {
    mockVenue = venue({
      claimStatus: "verified",
      changeRequest: {
        requestId: "req-10",
        status: "rejected",
        name: "Refused Name",
        venueCategory: null,
        address: null,
        requestedAt: null,
        reviewedAt: "2026-09-15T11:00:00Z",
        rejectionReason: "The sign on the door still says Pending Kitchen.",
      },
    });
    const tree = await mount();
    expect(textOf(byTestId(tree.root, "venue-details-rejection-reason"))).toBe(
      "The sign on the door still says Pending Kitchen.",
    );
    expect(maybeByTestId(tree.root, "venue-details-pending")).toBeUndefined();
    await press(tree.root, "venue-details-dismiss-rejection");
    expect(mockWithdraw).toHaveBeenCalledWith("req-10");
    await TestRenderer.act(async () => tree.unmount());
  });
});

describe("contact — saved directly, E.164 with its country", () => {
  test("E-10 the phone opens on its saved country without the dial code", async () => {
    const tree = await mount();
    await press(tree.root, "venue-details-edit-contact");
    const phone = byTestId(tree.root, "venue-details-phone");
    expect(phone.props.variant).toBe("phone");
    expect(phone.props.defaultCountryIso).toBe("NG");
    expect(phone.props.value).toBe("8031234567");
    await TestRenderer.act(async () => tree.unmount());
  });

  test("E-11 a local Lagos number saves as +234… with NG, on a live venue too", async () => {
    mockVenue = venue({ claimStatus: "verified", contactPhone: null, contactPhoneCountryIso: null });
    const tree = await mount();
    await press(tree.root, "venue-details-edit-contact");
    await TestRenderer.act(async () => {
      (byTestId(tree.root, "venue-details-phone").props.onChangeText as (v: string) => void)(
        "0803 123 4567",
      );
      (byTestId(tree.root, "venue-details-email").props.onChangeText as (v: string) => void)(
        "bookings@live.example",
      );
    });
    await press(tree.root, "venue-details-save-contact");
    expect(mockUpdateContact).toHaveBeenCalledTimes(1);
    expect(mockUpdateContact.mock.calls[0][0]).toEqual({
      phoneE164: "+2348031234567",
      phoneCountryIso: "NG",
      email: "bookings@live.example",
    });
    expect(mockSubmitRequest).not.toHaveBeenCalled();
    await TestRenderer.act(async () => tree.unmount());
  });

  test("E-12 a number under the wrong country is refused with a specific message", async () => {
    const tree = await mount();
    await press(tree.root, "venue-details-edit-contact");
    await TestRenderer.act(async () => {
      (byTestId(tree.root, "venue-details-phone").props.onCountryChange as (c: unknown) => void)({
        iso: "US",
        name: "United States",
        dialCode: "+1",
        flag: "",
      });
      (byTestId(tree.root, "venue-details-phone").props.onChangeText as (v: string) => void)(
        "0803 123 4567",
      );
    });
    await press(tree.root, "venue-details-save-contact");
    expect(mockUpdateContact).not.toHaveBeenCalled();
    expect(textOf(byTestId(tree.root, "venue-details-form-error")).length).toBeGreaterThan(0);
    await TestRenderer.act(async () => tree.unmount());
  });
});

describe("fallback and permissions", () => {
  test("E-13 a venue that is neither in review nor live keeps only 'Request a change' for identity", async () => {
    const openURL = jest
      .spyOn(Linking, "openURL")
      .mockImplementation(() => Promise.reject(new Error("no mail app")));
    mockVenue = venue({ claimStatus: "rejected" });
    const tree = await mount();
    expect(maybeByTestId(tree.root, "venue-details-edit-identity")).toBeUndefined();
    expect(maybeByTestId(tree.root, "venue-details-edit-contact")).toBeDefined();
    await press(tree.root, "venue-details-request-change");
    expect(String(openURL.mock.calls[0][0]).startsWith("mailto:support@usemingla.com?")).toBe(true);
    expect(textOf(byTestId(tree.root, "venue-details-request-failed"))).toMatch(/support@usemingla\.com/);
    openURL.mockRestore();
    await TestRenderer.act(async () => tree.unmount());
  });

  test("E-14 a Stay venue cannot change category here and gets the fallback", async () => {
    mockVenue = venue({ claimStatus: "verified", venueCategory: "stay" });
    const tree = await mount();
    expect(maybeByTestId(tree.root, "venue-details-request-change")).toBeDefined();
    await press(tree.root, "venue-details-edit-identity");
    expect(tree.root.findAll((n) => n.type === "VenueCategoryPicker")).toHaveLength(0);
    expect(maybeByTestId(tree.root, "venue-details-stay-category")).toBeDefined();
    await TestRenderer.act(async () => tree.unmount());
  });

  test("E-15 a scanner or host sees the details but no edit controls", async () => {
    mockVenue = venue({ claimStatus: "verified" });
    const tree = await mount(false);
    expect(allText(tree.root)).toMatch(/Pending Kitchen/);
    for (const id of [
      "venue-details-edit-identity",
      "venue-details-edit-contact",
      "venue-details-request-change",
    ]) {
      expect(maybeByTestId(tree.root, id)).toBeUndefined();
    }
    await TestRenderer.act(async () => tree.unmount());
  });
});
