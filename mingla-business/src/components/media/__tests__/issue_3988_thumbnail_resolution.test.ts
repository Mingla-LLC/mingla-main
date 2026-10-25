import {
  PENDING_THUMBNAIL_RETRY_MS,
  requestThumbnailForState,
  thumbnailResolutionPlan,
} from "../thumbnailResolution";

describe("#3988 lazy thumbnail resolution", () => {
  it("calls the authorized thumbnail endpoint for pending rows and polls at the edge writer interval", () => {
    expect(thumbnailResolutionPlan("pending")).toEqual({
      shouldRequest: true,
      retryDelayMs: PENDING_THUMBNAIL_RETRY_MS,
    });
    expect(PENDING_THUMBNAIL_RETRY_MS).toBe(60_000);
  });

  it("executes pending resolution through the supplied authorized request and skips non-media", async () => {
    const request = jest.fn().mockResolvedValue({ uri: "authorized-thumb" });
    await expect(requestThumbnailForState("pending", request)).resolves.toEqual({ uri: "authorized-thumb" });
    expect(request).toHaveBeenCalledTimes(1);
    await expect(requestThumbnailForState("none", request)).resolves.toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("loads ready thumbnails once and never probes non-media rows", () => {
    expect(thumbnailResolutionPlan("ready")).toEqual({ shouldRequest: true, retryDelayMs: null });
    expect(thumbnailResolutionPlan("none")).toEqual({ shouldRequest: false, retryDelayMs: null });
  });
});
