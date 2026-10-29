import { selectedCommunityTabOffset } from "../communityTabReveal";

describe("#4173 Community selected-tab reveal", () => {
  it("does not move a tab that is fully visible", () => {
    expect(selectedCommunityTabOffset({
      tab: { x: 112, width: 108 },
      viewportWidth: 240,
      currentOffset: 80,
      contentWidth: 444,
    })).toBeNull();
  });

  it("reveals clipped tabs on either edge without overscrolling", () => {
    expect(selectedCommunityTabOffset({
      tab: { x: 336, width: 108 },
      viewportWidth: 240,
      currentOffset: 0,
      contentWidth: 444,
    })).toBe(204);
    expect(selectedCommunityTabOffset({
      tab: { x: 0, width: 108 },
      viewportWidth: 240,
      currentOffset: 204,
      contentWidth: 444,
    })).toBe(0);
  });
});
