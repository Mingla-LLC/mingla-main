import {
  stayDraftReadiness,
  stayEditorLifecycleCopy,
} from "../stayInventoryPresentation";

describe("#4490 truthful Stay editor states", () => {
  it("keeps a live room live while showing booking-setup gaps separately", () => {
    const copy = stayEditorLifecycleCopy({
      status: "live",
      kind: "room",
      draftCount: 1,
      pendingReadiness: 2,
    });

    expect(copy).toMatchObject({
      pillLabel: "Live",
      pillReady: true,
      readinessHeading: "Booking setup",
      summaryEyebrow: "You’re editing",
      summaryHeadline: "Live Room",
    });
    expect(copy.helper).toContain("Guests can book this room now");
    expect(copy.helper).not.toContain("Nothing here can be booked");
  });

  it("names paused, saved-draft and new-draft lifecycles without conflating them", () => {
    expect(
      stayEditorLifecycleCopy({ status: "paused", kind: "place", draftCount: 1, pendingReadiness: 0 }),
    ).toMatchObject({ pillLabel: "Paused", summaryHeadline: "Paused Place" });
    expect(
      stayEditorLifecycleCopy({ status: "draft", kind: "room", draftCount: 1, pendingReadiness: 3 }),
    ).toMatchObject({ pillLabel: "3 to go", summaryHeadline: "Room draft", readinessHeading: "Before this can go live" });
    expect(
      stayEditorLifecycleCopy({ status: null, kind: "place", draftCount: 2, pendingReadiness: 1 }),
    ).toMatchObject({ summaryEyebrow: "You’re creating", summaryHeadline: "2 Place drafts", readinessHeading: "Before these can go live" });
  });

  it("uses the server's saved availability fact instead of always saying it is missing", () => {
    const readiness = stayDraftReadiness({
      description: "A quiet room",
      photoCount: 1,
      hasPrice: true,
      hasPolicy: true,
      hasOpenAvailability: true,
      namedUnits: false,
      unitNameCount: 0,
    });

    expect(readiness.find((item) => item.id === "availability")).toMatchObject({
      label: "Open future availability",
      done: true,
    });
  });
});
