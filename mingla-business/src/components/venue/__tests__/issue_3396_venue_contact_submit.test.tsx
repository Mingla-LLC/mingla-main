/**
 * #3396: execute the real wizard submission, rather than merely proving the
 * draft seeds a country. The old submit discarded the country at the final
 * transport boundary. Native chrome and unrelated steps are mocked; the
 * wizard, draft, contact step, validation, and submission coordinator are real.
 */
import React from "react";
import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import type { CreateVenueListingInput } from "../../../services/venueListingsService";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockCreate = jest.fn((_input: CreateVenueListingInput) => Promise.resolve("venue-3396"));
jest.mock("../../../hooks/useVenueListings", () => ({ useCreateVenueListing: () => ({ mutateAsync: mockCreate, isPending: false }) }));
jest.mock("../../../hooks/useCurrentBrand", () => ({ useCurrentBrand: () => ({ id: "brand-3396", slug: "test-brand" }) }));
jest.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ user: { id: "host-3396" } }) }));
jest.mock("../../../hooks/useBrands", () => ({
  SlugCollisionError: class extends Error {},
  resolveAvailableVenueSlug: () => Promise.resolve("venue-test"),
}));
jest.mock("../../../services/businessPlaceAuthoringService", () => ({
  upsertTier1Place: () => Promise.resolve({ place_pool_id: "place-3396" }),
  commitNewVenueDiscoveryRange: () => Promise.resolve(),
  syncGallery: () => Promise.resolve(),
  fetchVenuePipelineState: () => Promise.resolve(null),
}));
jest.mock("../../../services/venueListingsService", () => ({
  PlaceClaimConflictError: class extends Error {},
  findOwnListingForPlace: () => Promise.resolve(null),
  fetchVenueListing: () => Promise.resolve(null),
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: { View: require("react-native").View, Text: require("react-native").Text },
  useReducedMotion: () => true,
  useSharedValue: (value: number) => ({ value }),
  useAnimatedStyle: (fn: () => unknown) => fn(),
  withTiming: (value: number) => value,
}));
jest.mock("../../../wrappers/SmartScrollView", () => ({ ScrollView: require("react-native").ScrollView }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/IconChrome", () => ({ IconChrome: () => null }));
jest.mock("../../ui/Stepper", () => ({ Stepper: () => null }));
jest.mock("../../ui/Sheet", () => ({ Sheet: () => null }));
jest.mock("../../ui/Spinner", () => ({ Spinner: () => null }));
jest.mock("expo-haptics", () => ({
  impactAsync: () => Promise.resolve(),
  selectionAsync: () => Promise.resolve(),
  notificationAsync: () => Promise.resolve(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

// These steps cannot affect a contact edit or the executed submit callback.
for (const [path, name] of [
  ["../VenueStep1Address", "VenueStep1Address"],
  ["../VenueStep2NameSlug", "VenueStep2NameSlug"],
  ["../VenueStep4Hours", "VenueStep4Hours"],
  ["../VenuePhotosStep", "VenuePhotosStep"],
  ["../VenueCoverStep", "VenueCoverStep"],
  ["../claim/ClaimAdoptionBanner", "ClaimAdoptionBanner"],
  ["../claim/ClaimStepBookings", "ClaimStepBookings"],
  ["../claim/ClaimStepCategory", "ClaimStepCategory"],
  ["../claim/ClaimStepCover", "ClaimStepCover"],
  ["../claim/ClaimStepHours", "ClaimStepHours"],
  ["../claim/ClaimStepPhotos", "ClaimStepPhotos"],
  ["../claim/ClaimStepPlace", "ClaimStepPlace"],
  ["../claim/ClaimStepPrice", "ClaimStepPrice"],
]) {
  jest.doMock(path, () => ({ [name]: () => null }));
}
for (const [path, name] of [
  ["../VenueStep7Review", "VenueStep7Review"],
  ["../claim/ClaimStepReview", "ClaimStepReview"],
]) {
  jest.doMock(path, () => ({ [name]: (props: Record<string, unknown>) => React.createElement("Review", props) }));
}

const { VenueCreatorWizard } = require("../VenueCreatorWizard") as typeof import("../VenueCreatorWizard");
const { useDraftVenueStore } = require("../../../store/draftVenueStore") as typeof import("../../../store/draftVenueStore");
interface Node {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: Node) => boolean) => Node[];
  findByType: (type: string) => Node;
}
interface Tree { root: Node; unmount: () => void }
const mounted: Tree[] = [];
const renderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};
const call = (node: Node, name: string, ...args: unknown[]): void => {
  const fn = node.props[name];
  if (typeof fn !== "function") throw new Error(`Missing ${name}`);
  fn(...args);
};
afterEach(async () => {
  await renderer.act(async () => mounted.splice(0).forEach((tree) => tree.unmount()));
});
const mountWizard = async (): Promise<Tree> => {
  let tree!: Tree;
  await renderer.act(async () => { tree = renderer.create(<VenueCreatorWizard onDone={() => undefined} onClose={() => undefined} />); });
  mounted.push(tree);
  return tree;
};

beforeEach(() => {
  mockCreate.mockClear();
  useDraftVenueStore.getState().reset();
  useDraftVenueStore.getState().createDraft("brand-3396");
  useDraftVenueStore.getState().patch({
    displayName: "Test venue", slug: "test-venue", venueCategory: "restaurant",
    formattedAddress: "Lagos", countryCode: "NG", lat: 6.45, lng: 3.39,
    contactEmail: "test@example.com", contactPhone: "0803 123 4567",
    hours: [], discoveryPriceMinInput: "1000", step: 8,
    coverChoice: { url: "https://example.com/cover.jpg", type: "image", isNew: true },
  });
});

test.each([
  ["NG", "0803 123 4567", "+2348031234567"],
  ["GB", "020 7946 0018", "+442079460018"],
  ["US", "(415) 555-0123", "+14155550123"],
  ["NG", "+447700900123", "+447700900123"],
  ["NG", "", undefined],
])("the real wizard submits %s contact %s in canonical form", async (iso, text, canonical) => {
  useDraftVenueStore.getState().patch({ contactPhoneCountryIso: iso, contactPhone: text });
  const tree = await mountWizard();
  await renderer.act(async () => { call(tree.root.findByType("Review"), "onSubmit"); });
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(mockCreate.mock.calls[0]?.[0].contact.phone).toBe(canonical);
});

test("create contact mounts the actual shared claim step and reflects its seeded country", async () => {
  useDraftVenueStore.getState().setStep(5);
  const tree = await mountWizard();
  expect(tree.root.findAll((n) => n.props.accessibilityLabel === "Country: Nigeria, +234. Tap to change.").length).toBeGreaterThan(0);
  const input = tree.root.findAll((n) => n.type === "TextInput" && n.props.accessibilityLabel === "Contact phone")[0];
  expect(input).toBeDefined();
  await renderer.act(async () => call(input, "onChangeText", "0812 345 6789"));
  expect(useDraftVenueStore.getState().contactPhone).toBe("0812 345 6789");
  expect(useDraftVenueStore.getState().contactPhoneCountryIso).toBe("NG");
});

test("claim submission uses the same canonical phone boundary", async () => {
  useDraftVenueStore.getState().patch({
    claim: {
      adopted: {
        name: "Test venue", address: "Lagos", hours: [], phone: null,
        website: null, priceTiers: [], facets: {}, summary: null,
        summarySource: null, galleryUrls: [], category: "restaurant",
        categoryConfident: true, reservableHint: false,
      },
      keptGalleryUrls: [], addedGalleryUrls: [], detailFetched: true,
      adoptedAt: "2026-09-15T00:00:00Z",
      coverChoice: { url: "https://example.com/cover.jpg", type: "image", isNew: true },
    },
  });
  const tree = await mountWizard();
  await renderer.act(async () => call(tree.root.findByType("Review"), "onSubmit"));
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(mockCreate.mock.calls[0]?.[0].contact.phone).toBe("+2348031234567");
});

test.each(["0803 12", "0803abc1234567"])("invalid contact %s is blocked before the write and the draft survives", async (phone) => {
  useDraftVenueStore.getState().patch({ contactPhone: phone });
  const tree = await mountWizard();
  await renderer.act(async () => call(tree.root.findByType("Review"), "onSubmit"));
  expect(mockCreate).not.toHaveBeenCalled();
  expect(useDraftVenueStore.getState().contactPhone).toBe(phone);
  expect(useDraftVenueStore.getState().step).toBe(5);
  expect(tree.root.findAll((n) => n.props.children === "That phone number doesn't look right — check it.").length).toBeGreaterThan(0);
});
