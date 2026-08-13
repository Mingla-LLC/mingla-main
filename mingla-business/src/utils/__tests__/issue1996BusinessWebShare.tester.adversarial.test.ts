import { beforeEach, describe, expect, jest, test } from "@jest/globals";

let mockPlatformOS = "web";

jest.mock("react-native", () => ({
  Platform: {
    get OS() {
      return mockPlatformOS;
    },
  },
  Share: { share: jest.fn(async () => undefined) },
}));

jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn(async () => undefined),
}));

// eslint-disable-next-line import/first
import { sharePublicUrl } from "../sharePublicUrl";

describe("#1996 Business desktop share adversarial browser contract", () => {
  beforeEach(() => {
    mockPlatformOS = "web";
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: undefined,
    });
  });

  test("Web Share keeps Navigator as its receiver and sends the exact prepared URL", async () => {
    const navigatorOwner = {
      share: jest.fn(async function (
        this: unknown,
        payload: { title: string; url: string; text?: string },
      ) {
        expect(this).toBe(navigatorOwner);
        expect(payload).toEqual({
          title: "New Forms: Collector's Preview",
          url: "https://usemingla.com/s/Aa0Bb1Cc2Dd3Ee4F",
          text: "A private collector preview at Art Roost Gallery.",
        });
      }),
    };
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: navigatorOwner,
    });

    await sharePublicUrl({
      title: "New Forms: Collector's Preview",
      url: "https://usemingla.com/s/Aa0Bb1Cc2Dd3Ee4F",
      description: "A private collector preview at Art Roost Gallery.",
    });

    expect(navigatorOwner.share).toHaveBeenCalledTimes(1);
  });
});
