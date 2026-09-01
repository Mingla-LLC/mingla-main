import { siteAttributionPayload } from "../../analytics/siteAttribution.web";

describe("#2830 optional checkout attribution", () => {
  it("fails open when the optional binding is absent", async () => {
    await expect(siteAttributionPayload(null)).resolves.toEqual({});
  });

  it("fails open when the optional reader throws", async () => {
    await expect(siteAttributionPayload(() => {
      throw new Error("storage blocked");
    })).resolves.toEqual({});
  });
});
