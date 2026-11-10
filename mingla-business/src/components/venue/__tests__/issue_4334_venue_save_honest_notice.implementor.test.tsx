/**
 * #4334 — an in-review venue save the server did not write never says "Saved."
 *
 * biz_update_venue_identity_in_review compares again and answers
 * changed:false when nothing differs from the stored venue (for example an
 * address re-picked before the server counted a new place id). The editor
 * showed "Saved." for every success, so the host was told a change was saved
 * when nothing was written. Now changed:false keeps the form open with
 * "Nothing has changed yet."
 *
 * Same harness as venueDetailsEditor.issue3386.test.tsx (the REAL editor, data
 * hooks stubbed), with the server's `changed` answer controllable.
 *
 * Fails-on-revert: delete the `if (!changed)` branch in VenueDetailsEditor.tsx
 * saveIdentity → N-1 red.
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
// What the in-review RPC answers: false = it compared again and wrote nothing.
let mockServerChanged = true;
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
      opts?.onSuccess?.({ changed: mockServerChanged });
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
jest.mock("../../location/AddressInput", () => ({
  __esModule: true,
  AddressInput: mockHost("AddressInput"),
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
  mockServerChanged = true;
  mockUpdateContact.mockClear();
  mockUpdateIdentity.mockClear();
  mockSubmitRequest.mockClear();
  mockWithdraw.mockClear();
});


const pickSamePlace = async (tree: Tree): Promise<void> => {
  await press(tree.root, "venue-details-edit-identity");
  await TestRenderer.act(async () => {
    (byType(tree.root, "AddressInput").props.onPick as (d: unknown, l?: string) => void)(
      {
        placeId: "ChIJfixture_new",
        formattedAddress: "1 Old Road, Lagos, Nigeria",
        city: "Lagos",
        region: null,
        regionCode: null,
        regionCodeFull: null,
        countryCode: "NG",
        location: { lat: 6.45, lng: 3.4 },
        featureType: "address",
      },
      "1 Old Road",
    );
  });
  await press(tree.root, "venue-details-save-identity");
};

describe("#4334 — in review: the server's changed answer decides the notice", () => {
  test("N-1 changed:false keeps the form open with 'Nothing has changed yet.'", async () => {
    mockServerChanged = false;
    const tree = await mount();
    await pickSamePlace(tree);
    expect(mockUpdateIdentity).toHaveBeenCalledTimes(1);
    expect(textOf(byTestId(tree.root, "venue-details-form-error"))).toBe("Nothing has changed yet.");
    expect(maybeByTestId(tree.root, "venue-details-notice")).toBeUndefined();
    expect(allText(tree.root)).not.toMatch(/Saved\./);
    expect(maybeByTestId(tree.root, "venue-details-save-identity")).toBeDefined();
    await TestRenderer.act(async () => tree.unmount());
  });

  test("N-2 changed:true still closes the form and says Saved", async () => {
    const tree = await mount();
    await pickSamePlace(tree);
    expect(textOf(byTestId(tree.root, "venue-details-notice"))).toMatch(/^Saved\./);
    expect(maybeByTestId(tree.root, "venue-details-save-identity")).toBeUndefined();
    await TestRenderer.act(async () => tree.unmount());
  });
});
