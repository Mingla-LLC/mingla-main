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
    // [TEST-MOD-APPROVED #1685] #1467's contract is "hand the exact venue to
    // onDone BEFORE clearing the completed draft" — that ordering is preserved
    // verbatim. Only the clearing PRIMITIVE changed: `reset(currentBrand.id)`
    // now destroys the brand's OTHER half-built venues under the draft-id-keyed
    // store, so the submit path clears exactly the draft it just submitted.
    // The gap tolerates ONLY whitespace and `//` comment lines, so no statement
    // can ever slip between the handoff and the clear.
    expect(source).toMatch(
      /onDone\(null, venueId, st\.displayName\.trim\(\), false\);\s*(?:\/\/[^\n]*\n\s*)*useDraftVenueStore\.getState\(\)\.deleteActiveDraft\(\)/,
    );
    expect(source).toContain("submissionVenueId: id");
    expect(source).toContain("placePoolId: authoringPlacePoolId");
  });

  it("keeps the live-listing message exclusive to claim/adoption success", () => {
    const route = readFileSync(
      join(__dirname, "..", "..", "..", "..", "app", "venue", "create.tsx"),
      "utf8",
    );
    expect(route).toContain("setSuccessWasClaim(wasClaim)");
    expect(route).toContain("Your listing is not live yet.");
    expect(route).toContain("successWasClaim");
  });
});
