/** Independent #3404 QA: execute wizard → choice → real shared upsert,
 * including deferred/denied writes. Only transport and unrelated UI leaves
 * are mocked. This deliberately does not replace the setting writer. */
import React from "react";
import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockUpsert = jest.fn((_row: Record<string, unknown>, _options: Record<string, unknown>): Promise<{ error: null | { message: string } }> => Promise.resolve({ error: null }));
const mockFrom = jest.fn((_table: string) => ({ upsert: mockUpsert }));
jest.mock("../../../services/supabase", () => ({ supabase: { from: (table: string) => mockFrom(table) } }));
const mockCreate = jest.fn((_input: unknown) => Promise.resolve("venue-3393"));
const mockDone = jest.fn();
jest.mock("../../../hooks/useVenueListings", () => ({ useCreateVenueListing: () => ({ mutateAsync: mockCreate, isPending: false }) }));
jest.mock("../../../hooks/useCurrentBrand", () => ({ useCurrentBrand: () => ({ id: "brand-3393", slug: "test-brand" }) }));
jest.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ user: { id: "host-3393" } }) }));
jest.mock("../../../hooks/useBrands", () => ({ SlugCollisionError: class extends Error {}, resolveAvailableVenueSlug: () => Promise.resolve("venue-test") }));
jest.mock("../../../services/businessPlaceAuthoringService", () => ({
  upsertTier1Place: () => Promise.resolve({ place_pool_id: "place-3393" }),
  commitNewVenueDiscoveryRange: () => Promise.resolve(), syncGallery: () => Promise.resolve(),
  fetchVenuePipelineState: () => Promise.resolve(null),
}));
jest.mock("../../../services/venueListingsService", () => ({ PlaceClaimConflictError: class extends Error {}, findOwnListingForPlace: () => Promise.resolve(null), fetchVenueListing: () => Promise.resolve(null) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock("react-native-reanimated", () => ({ __esModule: true, default: { View: require("react-native").View }, useReducedMotion: () => true, useSharedValue: (value: number) => ({ value }), useAnimatedStyle: (fn: () => unknown) => fn(), withTiming: (value: number) => value }));
jest.mock("../../../wrappers/SmartScrollView", () => ({ ScrollView: require("react-native").ScrollView }));
jest.mock("../../ui/Button", () => ({ Button: () => null }));
jest.mock("../../ui/IconChrome", () => ({ IconChrome: () => null }));
jest.mock("../../ui/Stepper", () => ({ Stepper: () => null }));
for (const [path, name] of [
  ["../VenueStep1Address", "VenueStep1Address"], ["../VenueStep2NameSlug", "VenueStep2NameSlug"],
  ["../VenueStep4Hours", "VenueStep4Hours"], ["../VenuePhotosStep", "VenuePhotosStep"],
  ["../VenueCoverStep", "VenueCoverStep"], ["../claim/ClaimAdoptionBanner", "ClaimAdoptionBanner"],
  ["../claim/ClaimStepBookings", "ClaimStepBookings"], ["../claim/ClaimStepCategory", "ClaimStepCategory"],
  ["../claim/ClaimStepContact", "ClaimStepContact"], ["../claim/ClaimStepCover", "ClaimStepCover"],
  ["../claim/ClaimStepHours", "ClaimStepHours"], ["../claim/ClaimStepPhotos", "ClaimStepPhotos"],
  ["../claim/ClaimStepPlace", "ClaimStepPlace"], ["../claim/ClaimStepPrice", "ClaimStepPrice"],
]) jest.doMock(path, () => ({ [name]: () => null }));
for (const [path, name] of [["../VenueStep7Review", "VenueStep7Review"], ["../claim/ClaimStepReview", "ClaimStepReview"]]) {
  jest.doMock(path, () => ({ [name]: (props: Record<string, unknown>) => React.createElement("Review", props) }));
}
const { VenueCreatorWizard } = require("../VenueCreatorWizard") as typeof import("../VenueCreatorWizard");
const { useDraftVenueStore } = require("../../../store/draftVenueStore") as typeof import("../../../store/draftVenueStore");
const Renderer = require("react-test-renderer");
const mounted: Array<{ unmount: () => void }> = [];
const claim = {
  adopted: { name: "Test venue", address: "Lagos", hours: [], phone: null, website: null, priceTiers: [], facets: {}, summary: null, summarySource: null, galleryUrls: [], category: "restaurant" as const, categoryConfident: true, reservableHint: false },
  keptGalleryUrls: [], addedGalleryUrls: [], detailFetched: true, adoptedAt: "2026-09-15T00:00:00Z",
  coverChoice: { url: "https://example.test/cover.jpg", type: "image" as const, isNew: true },
};
beforeEach(() => {
  mockCreate.mockClear(); mockDone.mockClear(); mockFrom.mockClear();
  mockUpsert.mockReset(); mockUpsert.mockResolvedValue({ error: null });
  useDraftVenueStore.getState().reset();
  useDraftVenueStore.getState().createDraft("brand-3393");
  useDraftVenueStore.getState().patch({ displayName: "Test venue", slug: "test-venue", venueCategory: "restaurant", formattedAddress: "Lagos", countryCode: "NG", lat: 6.45, lng: 3.39, contactEmail: "test@example.test", contactPhone: "", hours: [], discoveryPriceMinInput: "1000", step: 8, coverChoice: claim.coverChoice });
});
afterEach(async () => { await Renderer.act(async () => { mounted.splice(0).forEach(tree => tree.unmount()); }); });
async function mountSubmit(isClaim: boolean, enabled: boolean) {
  useDraftVenueStore.getState().patch({ wantsReservations: enabled, claim: isClaim ? claim : null });
  let tree: any;
  await Renderer.act(async () => { tree = Renderer.create(<VenueCreatorWizard onDone={mockDone} onClose={() => undefined} />); });
  mounted.push(tree);
  return tree;
}
test.each([false, true])("%s claim flag: deferred ON write finishes before handoff and targets acquired venue", async isClaim => {
  let resolve!: (value: { error: null }) => void;
  mockUpsert.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const tree = await mountSubmit(isClaim, true);
  let submitting!: Promise<void>;
  await Renderer.act(async () => { submitting = tree.root.findByType("Review").props.onSubmit(); });
  expect(mockFrom).toHaveBeenCalledWith("venue_reservation_settings");
  expect(mockUpsert).toHaveBeenCalledTimes(1);
  expect(mockUpsert.mock.calls[0]).toEqual([expect.objectContaining({ brand_id: "brand-3393", venue_id: "venue-3393", reservations_enabled: true }), { onConflict: "venue_id" }]);
  expect(mockDone).not.toHaveBeenCalled();
  await Renderer.act(async () => { resolve({ error: null }); await submitting; });
  expect(mockDone).toHaveBeenCalledWith(null, "venue-3393", "Test venue", isClaim);
  expect(mockCreate).toHaveBeenCalledTimes(1);
});
test.each([false, true])("%s claim flag: explicit OFF never creates an enabled setting", async isClaim => {
  const tree = await mountSubmit(isClaim, false);
  await Renderer.act(async () => { await tree.root.findByType("Review").props.onSubmit(); });
  expect(mockUpsert).not.toHaveBeenCalled();
  expect(mockDone).toHaveBeenCalledWith(null, "venue-3393", "Test venue", isClaim);
});
test.each([false, true])("%s claim flag: denied setting write still hands off the one submitted venue", async isClaim => {
  mockUpsert.mockResolvedValueOnce({ error: { message: "new row violates row-level security policy" } });
  const tree = await mountSubmit(isClaim, true);
  await Renderer.act(async () => { await tree.root.findByType("Review").props.onSubmit(); });
  expect(mockUpsert).toHaveBeenCalledTimes(1);
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(mockDone).toHaveBeenCalledWith(null, "venue-3393", "Test venue", isClaim);
});
