import {
  homeAdAttentionCopy,
  homeAdNetworkLabel,
  homeAdNetworkList,
  homeAdTileSpan,
} from "../homeAdLifecycle";

describe("#4037 Home Ads presentation policy", () => {
  test.each([
    [1, 12],
    [2, 6],
    [3, 4],
    [4, 3],
    [5, 3],
  ])("%s visible plans use a %s-column tile", (count, span) => {
    expect(homeAdTileSpan(count)).toBe(span);
  });

  test.each([
    ["meta", "Meta"],
    ["tiktok", "TikTok"],
    ["google", "Google"],
    ["snapchat", "Snapchat"],
    ["reddit_ads", "Reddit Ads"],
  ])("maps %s to %s", (network, label) => {
    expect(homeAdNetworkLabel(network)).toBe(label);
  });

  test("deduplicates network labels in provider order", () => {
    expect(homeAdNetworkList(["meta", "tiktok", "meta"])).toBe(
      "Meta · TikTok",
    );
  });

  test("uses the exact unknown-attention fallback", () => {
    expect(homeAdAttentionCopy("unexpected_code")).toBe(
      "Open the ad to see what's needed",
    );
  });
});
