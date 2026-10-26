import { mediaViewerKeyAction } from "../viewerInteraction";

describe("#3988 viewer keyboard interaction", () => {
  it("closes only the top-most viewer on Escape", () => {
    expect(mediaViewerKeyAction({ key: "Escape", topLayer: true, hasPrevious: true, hasNext: true })).toBe("close");
    expect(mediaViewerKeyAction({ key: "Escape", topLayer: false, hasPrevious: true, hasNext: true })).toBeNull();
  });

  it("moves only when the requested direction exists", () => {
    expect(mediaViewerKeyAction({ key: "ArrowLeft", topLayer: true, hasPrevious: true, hasNext: false })).toBe("previous");
    expect(mediaViewerKeyAction({ key: "ArrowLeft", topLayer: true, hasPrevious: false, hasNext: true })).toBeNull();
    expect(mediaViewerKeyAction({ key: "ArrowRight", topLayer: true, hasPrevious: false, hasNext: true })).toBe("next");
    expect(mediaViewerKeyAction({ key: "Enter", topLayer: true, hasPrevious: true, hasNext: true })).toBeNull();
  });
});
