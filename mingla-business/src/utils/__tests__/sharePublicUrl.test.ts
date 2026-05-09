import { readFileSync } from "fs";
import path from "path";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

let mockPlatformOS = "ios";
const mockShare = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockSetStringAsync = jest.fn<(...args: unknown[]) => Promise<void>>();

jest.mock("react-native", () => ({
  Platform: {
    get OS() {
      return mockPlatformOS;
    },
  },
  Share: {
    share: (...args: unknown[]) => mockShare(...args),
  },
}));

jest.mock("expo-clipboard", () => ({
  setStringAsync: (...args: unknown[]) => mockSetStringAsync(...args),
}));

// eslint-disable-next-line import/first
import { buildPublicShareText, copyPublicUrl, sharePublicUrl } from "../sharePublicUrl";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

const canonicalUrl = "https://business.usemingla.com/e/test-stripe/great-free-event";

const setNavigator = (value: unknown): void => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value,
  });
};

describe("sharePublicUrl helpers", () => {
  beforeEach(() => {
    mockPlatformOS = "ios";
    mockShare.mockReset();
    mockSetStringAsync.mockReset();
    mockShare.mockResolvedValue({ action: "sharedAction" });
    mockSetStringAsync.mockResolvedValue(undefined);
    setNavigator(undefined);
  });

  test("native copy writes the exact canonical public URL to expo-clipboard", async () => {
    await copyPublicUrl(canonicalUrl);

    expect(mockSetStringAsync).toHaveBeenCalledWith(canonicalUrl);
  });

  test("web copy writes the exact canonical public URL to navigator.clipboard", async () => {
    const writeText = jest.fn<(...args: unknown[]) => Promise<void>>();
    writeText.mockResolvedValue(undefined);
    mockPlatformOS = "web";
    setNavigator({ clipboard: { writeText } });

    await copyPublicUrl(canonicalUrl);

    expect(writeText).toHaveBeenCalledWith(canonicalUrl);
  });

  test("native share payload carries the SEO public URL, never an Expo/current route URL", async () => {
    await sharePublicUrl({
      title: "Great Free Event",
      url: canonicalUrl,
      description: "A free Mingla QA event.",
    });

    expect(mockShare).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Great Free Event",
        url: canonicalUrl,
        message: expect.stringContaining(canonicalUrl),
      }),
    );
    expect(JSON.stringify(mockShare.mock.calls)).not.toContain("exp://");
    expect(JSON.stringify(mockShare.mock.calls)).not.toContain("localhost");
    expect(JSON.stringify(mockShare.mock.calls)).not.toContain("https://mingla.com/e");
    expect(JSON.stringify(mockShare.mock.calls)).not.toContain("business.mingla.com");
  });

  test("web share payload carries the SEO public URL in url and text", async () => {
    const webShare = jest.fn<(...args: unknown[]) => Promise<void>>();
    webShare.mockResolvedValue(undefined);
    mockPlatformOS = "web";
    setNavigator({ share: webShare });

    await sharePublicUrl({
      title: "Great Free Event",
      url: canonicalUrl,
      description: "A free Mingla QA event.",
    });

    expect(webShare).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Great Free Event",
        url: canonicalUrl,
        text: expect.stringContaining(canonicalUrl),
      }),
    );
    expect(JSON.stringify(webShare.mock.calls)).not.toContain("exp://");
    expect(JSON.stringify(webShare.mock.calls)).not.toContain("localhost");
    expect(JSON.stringify(webShare.mock.calls)).not.toContain("https://mingla.com/e");
    expect(JSON.stringify(webShare.mock.calls)).not.toContain("business.mingla.com");
  });

  test("share text includes the URL once and falls back to title without description", () => {
    expect(
      buildPublicShareText({
        title: "Great Free Event",
        url: canonicalUrl,
        description: "A free Mingla QA event.",
      }),
    ).toBe(`A free Mingla QA event.\n${canonicalUrl}`);

    expect(
      buildPublicShareText({
        title: "Great Free Event",
        url: canonicalUrl,
      }),
    ).toBe(`Great Free Event\n${canonicalUrl}`);

    expect(
      buildPublicShareText({
        title: "Great Free Event",
        url: canonicalUrl,
        description: `Already includes ${canonicalUrl}`,
      }),
    ).toBe(`Already includes ${canonicalUrl}`);
  });

  test("ShareModal only shows copy success after resolved copy and has a failure toast", () => {
    const source = repoFile("src/components/ui/ShareModal.tsx");

    expect(source).toContain("await copyPublicUrl(url);");
    expect(source).toContain('showToast("Link copied")');
    expect(source).toContain("Copy failed");
    expect(source).not.toContain("Tap Share via to copy on iOS / Android.");
  });
});
