import { readFileSync } from "fs";
import { join } from "path";

import { useDraftVenueStore } from "../../../store/draftVenueStore";
import { venueDraftBrandToReset } from "../venueCreateBrandLifecycle";

describe("Issue #1467 visible venue submission completion", () => {
  beforeEach(() => useDraftVenueStore.getState().reset());

  it("treats success as terminal instead of resetting the route to the gate", () => {
    expect(
      venueDraftBrandToReset({
        hydrated: true,
        currentBrandId: "brand-a",
        activeDraftBrandId: "brand-a",
        hasPoolContext: false,
        workingName: "",
        submissionCompleted: true,
      }),
    ).toBeNull();
  });

  it("parks the remembered venue ID per brand and clears only the completed brand", () => {
    const store = useDraftVenueStore;
    store.getState().activateBrand("brand-a");
    store.getState().patch({
      workingName: "Stay A",
      submissionVenueId: "venue-a",
    });
    store.getState().activateBrand("brand-b");
    store.getState().patch({
      workingName: "Stay B",
      submissionVenueId: "venue-b",
    });
    store.getState().activateBrand("brand-a");
    expect(store.getState().submissionVenueId).toBe("venue-a");
    store.getState().reset("brand-a");
    store.getState().activateBrand("brand-b");
    expect(store.getState().submissionVenueId).toBe("venue-b");
  });

  it("hands the exact venue to onDone before clearing the completed draft", () => {
    const source = readFileSync(
      join(__dirname, "..", "VenueCreatorWizard.tsx"),
      "utf8",
    );
    expect(source).toMatch(
      /onDone\(null, venueId, st\.displayName\.trim\(\)\);\s+useDraftVenueStore\.getState\(\)\.reset\(currentBrand\.id\)/,
    );
    expect(source).toContain("submissionVenueId: id");
    expect(source).toContain("placePoolId: authoringPlacePoolId");
  });
});
