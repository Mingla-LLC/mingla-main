import {
  draftVenueForBrand,
  useDraftVenueStore,
} from "../../../store/draftVenueStore";
import {
  venueDraftBrandToActivate,
  venueDraftBrandToReset,
} from "../venueCreateBrandLifecycle";

describe("Issue #1461 venue current-brand lifecycle", () => {
  beforeEach(() => {
    useDraftVenueStore.getState().reset();
  });

  it("waits for both hydration and delayed current-brand resolution", () => {
    expect(
      venueDraftBrandToActivate({
        hydrated: false,
        currentBrandId: "brand-a",
        activeDraftBrandId: null,
      }),
    ).toBeNull();
    expect(
      venueDraftBrandToActivate({
        hydrated: true,
        currentBrandId: null,
        activeDraftBrandId: null,
      }),
    ).toBeNull();
    expect(
      venueDraftBrandToActivate({
        hydrated: true,
        currentBrandId: "brand-a",
        activeDraftBrandId: null,
      }),
    ).toBe("brand-a");
  });

  it("activates every in-route brand switch, then becomes a no-op", () => {
    expect(
      venueDraftBrandToActivate({
        hydrated: true,
        currentBrandId: "brand-b",
        activeDraftBrandId: "brand-a",
      }),
    ).toBe("brand-b");
    expect(
      venueDraftBrandToActivate({
        hydrated: true,
        currentBrandId: "brand-b",
        activeDraftBrandId: "brand-b",
      }),
    ).toBeNull();
  });

  it("adopts an already-hydrated unscoped draft when the brand arrives late", () => {
    const store = useDraftVenueStore;
    store.getState().patch({
      workingName: "Mingla Release Stay 1392",
      venueCategory: "stay",
      discoveryPriceMinInput: "180",
      discoveryPriceMaxInput: "450",
      step: 6,
    });

    store.getState().activateBrand("brand-a");

    expect(store.getState()).toMatchObject({
      activeBrandId: "brand-a",
      workingName: "Mingla Release Stay 1392",
      venueCategory: "stay",
      discoveryPriceMinInput: "180",
      discoveryPriceMaxInput: "450",
      step: 6,
    });
  });

  it("never authorizes an empty-draft reset before the current brand is active", () => {
    const base = {
      hydrated: true,
      hasPoolContext: false,
      workingName: "",
    };
    expect(
      venueDraftBrandToReset({
        ...base,
        currentBrandId: null,
        activeDraftBrandId: "brand-b",
      }),
    ).toBeNull();
    expect(
      venueDraftBrandToReset({
        ...base,
        currentBrandId: "brand-a",
        activeDraftBrandId: "brand-b",
      }),
    ).toBeNull();
    expect(
      venueDraftBrandToReset({
        ...base,
        currentBrandId: "brand-a",
        activeDraftBrandId: "brand-a",
      }),
    ).toBe("brand-a");
  });

  it("preserves the other brand when the authorized reset id is applied", () => {
    const store = useDraftVenueStore;
    store.getState().activateBrand("brand-b");
    store.getState().patch({ workingName: "Brand B Stay", step: 4 });
    store.getState().activateBrand("brand-a");

    const resetBrandId = venueDraftBrandToReset({
      hydrated: true,
      currentBrandId: "brand-a",
      activeDraftBrandId: store.getState().activeBrandId,
      hasPoolContext: false,
      workingName: store.getState().workingName,
    });
    expect(resetBrandId).toBe("brand-a");
    store.getState().reset(resetBrandId ?? undefined);

    expect(draftVenueForBrand(store.getState(), "brand-b")).toMatchObject({
      workingName: "Brand B Stay",
      step: 4,
    });
    expect(store.getState().activeBrandId).toBe("brand-a");
  });

  it("does not reset a current draft that already has a name or pool context", () => {
    expect(
      venueDraftBrandToReset({
        hydrated: true,
        currentBrandId: "brand-a",
        activeDraftBrandId: "brand-a",
        hasPoolContext: false,
        workingName: "Mingla Release Stay 1392",
      }),
    ).toBeNull();
    expect(
      venueDraftBrandToReset({
        hydrated: true,
        currentBrandId: "brand-a",
        activeDraftBrandId: "brand-a",
        hasPoolContext: true,
        workingName: "",
      }),
    ).toBeNull();
  });
});
