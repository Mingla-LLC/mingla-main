/** Independent #3385: mount route AND real editor, not a synthetic onDone.
 * Transport failure must retain the form; successful retry hands off once. */
import React from "react";
import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockNav = { params: {} as Record<string, string>, canGoBack: false };
const mockBack = jest.fn(); const mockReplace = jest.fn();
jest.mock("expo-router", () => ({ useLocalSearchParams: () => mockNav.params, useRouter: () => ({ back: mockBack, replace: mockReplace, canGoBack: () => mockNav.canGoBack }) }));
jest.mock("../../../src/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner-3393" }, isAuthReady: true }) }));
const mockVenue = { id: "venue-3393", placePoolId: "place-3393", brandId: "brand-3393", name: "Test venue", venueCategory: "restaurant" };
jest.mock("../../../src/hooks/useVenueListings", () => ({ useVenueListing: () => ({ data: mockVenue, isLoading: false }) }));
const mockContext = { tier2: { website: "https://example.test" }, coaching: [], gallery_urls: [], cover_media_url: null, cover_media_type: null };
jest.mock("../../../src/hooks/useBrandPlacePipelineState", () => ({ useBrandPlaceAuthoringContext: () => ({ data: mockContext, isLoading: false }) }));
jest.mock("../../../src/hooks/useBrandDiscoveryCurrency", () => ({ useBrandDiscoveryCurrency: () => ({ data: { currencyCode: "NGN", supportedCurrencies: [{ code: "NGN", minorUnitExponent: 2 }] } }) }));
jest.mock("../../../src/hooks/usePlaceDiscoveryPriceRange", () => ({ usePlaceDiscoveryPriceRange: () => ({ data: null }) }));
const mockSave = jest.fn((_input: unknown) => Promise.resolve());
const mockPrice = jest.fn((_input: unknown) => Promise.resolve());
jest.mock("../../../src/services/businessPlaceAuthoringService", () => ({ saveTier2: (value: unknown) => mockSave(value), commitExistingVenueDiscoveryRange: (value: unknown) => mockPrice(value), refreshDeckReadiness: jest.fn(), syncGallery: jest.fn(), syncHeroMedia: jest.fn() }));
jest.mock("../../../src/services/venueGalleryService", () => ({ pickGalleryPhotos: jest.fn(), uploadGalleryPhoto: jest.fn(), VenueGalleryError: class extends Error {} }));
const mockHost = (name: string) => function Host(props: Record<string, unknown>) { return React.createElement(name, props, props.children as React.ReactNode); };
jest.mock("../../../src/wrappers/SmartScrollView", () => ({ ScrollView: mockHost("ScrollView") }));
jest.mock("../../../src/components/ui/Button", () => ({ Button: mockHost("Button") }));
jest.mock("../../../src/components/ui/IconChrome", () => ({ IconChrome: () => null }));
jest.mock("../../../src/components/ui/EventCoverMedia", () => ({ EventCoverMedia: () => null }));
jest.mock("../../../src/components/ui/CoverPickerSheet", () => ({ CoverPickerSheet: () => null }));
import VenueDeckReadinessRoute from "../deck-readiness";
import { useVenueSuiteStore } from "../../../src/store/venueSuiteStore";
const Renderer = require("react-test-renderer");
const mounted: Array<{ unmount: () => void }> = [];
beforeEach(() => {
  mockBack.mockClear(); mockReplace.mockClear(); mockSave.mockReset(); mockSave.mockResolvedValue(undefined); mockPrice.mockReset(); mockPrice.mockResolvedValue(undefined);
  mockNav.params = { brand_id: "brand-3393", venue_id: "venue-3393", place_pool_id: "place-3393" }; mockNav.canGoBack = false;
  useVenueSuiteStore.setState({ savedFlash: null });
});
afterEach(async () => { await Renderer.act(async () => { mounted.splice(0).forEach(tree => tree.unmount()); }); });
async function mount() { let tree: any; await Renderer.act(async () => { tree = Renderer.create(<VenueDeckReadinessRoute />); }); mounted.push(tree); return tree; }
async function save(tree: any) { await Renderer.act(async () => { tree.root.findAll((node: any) => node.type === "Button" && node.props.label === "Save changes")[0].props.onPress(); }); }
test.each(["tier", "price"])("%s failure cannot navigate or claim success; retry returns to venue with one-shot feedback", async failure => {
  if (failure === "tier") mockSave.mockRejectedValueOnce(new Error("Could not save your changes."));
  else mockPrice.mockRejectedValueOnce(new Error("Could not save your changes."));
  const tree = await mount(); await save(tree);
  expect(mockBack).not.toHaveBeenCalled(); expect(mockReplace).not.toHaveBeenCalled();
  expect(useVenueSuiteStore.getState().savedFlash).toBeNull();
  expect(tree.root.findAll((node: any) => node.type === "Text" && node.props.children === "Could not save your changes.").length).toBeGreaterThan(0);
  await save(tree);
  expect(mockReplace).toHaveBeenCalledWith("/venue/venue-3393?module=settings");
  expect(mockReplace).toHaveBeenCalledTimes(1);
  expect(mockSave).toHaveBeenLastCalledWith(expect.objectContaining({ brandId: "brand-3393", venueId: "venue-3393", placePoolId: "place-3393" }));
  const flash = useVenueSuiteStore.getState().savedFlash!;
  expect(useVenueSuiteStore.getState().takeSavedFlash("other-venue", flash.at)).toBeNull();
  expect(useVenueSuiteStore.getState().takeSavedFlash("venue-3393", flash.at)).toBe("Changes saved");
  expect(useVenueSuiteStore.getState().takeSavedFlash("venue-3393", flash.at)).toBeNull();
});
test("actual save from Settings uses back navigation without Events fallback", async () => {
  mockNav.params.from = "venue"; mockNav.canGoBack = true;
  const tree = await mount(); await save(tree);
  expect(mockBack).toHaveBeenCalledTimes(1); expect(mockReplace).not.toHaveBeenCalled();
  expect(useVenueSuiteStore.getState().savedFlash?.message).toBe("Changes saved");
});
