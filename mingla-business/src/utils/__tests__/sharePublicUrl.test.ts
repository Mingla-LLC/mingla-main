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
import {
  buildAndroidPublicShareMessage,
  buildPublicShareBody,
  buildPublicShareText,
  copyPublicUrl,
  sharePublicUrl,
} from "../sharePublicUrl";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

const canonicalUrl = "https://business.usemingla.com/e/test-stripe/great-free-event";

const countOccurrences = (source: string, needle: string): number =>
  source.split(needle).length - 1;

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

  test("iOS native share payload carries the SEO public URL exactly once", async () => {
    await sharePublicUrl({
      title: "Great Free Event",
      url: canonicalUrl,
      description: "A free Mingla QA event.",
    });

    expect(mockShare).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Great Free Event",
        url: canonicalUrl,
        message: "A free Mingla QA event.",
      }),
    );
    const payload = JSON.stringify(mockShare.mock.calls);
    expect(countOccurrences(payload, canonicalUrl)).toBe(1);
    expect(payload).not.toContain("exp://");
    expect(payload).not.toContain("localhost");
    expect(payload).not.toContain("https://mingla.com/e");
    expect(payload).not.toContain("business.mingla.com");
  });

  test("android native share payload includes the SEO public URL once in message", async () => {
    mockPlatformOS = "android";

    await sharePublicUrl({
      title: "Great Free Event",
      url: canonicalUrl,
      description: "A free Mingla QA event.",
    });

    expect(mockShare).toHaveBeenCalledWith({
      title: "Great Free Event",
      message: `A free Mingla QA event.\n${canonicalUrl}`,
    });
    const payload = JSON.stringify(mockShare.mock.calls);
    expect(countOccurrences(payload, canonicalUrl)).toBe(1);
    expect(payload).not.toContain("exp://");
    expect(payload).not.toContain("localhost");
    expect(payload).not.toContain("https://mingla.com/e");
    expect(payload).not.toContain("business.mingla.com");
  });

  test("web share payload carries the SEO public URL exactly once", async () => {
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
        text: "A free Mingla QA event.",
      }),
    );
    const payload = JSON.stringify(webShare.mock.calls);
    expect(countOccurrences(payload, canonicalUrl)).toBe(1);
    expect(payload).not.toContain("exp://");
    expect(payload).not.toContain("localhost");
    expect(payload).not.toContain("https://mingla.com/e");
    expect(payload).not.toContain("business.mingla.com");
  });

  test("share body excludes the URL while android share text includes it once", () => {
    expect(
      buildPublicShareBody({
        title: "Great Free Event",
        description: "A free Mingla QA event.",
      }),
    ).toBe("A free Mingla QA event.");

    expect(
      buildPublicShareBody({
        title: "Great Free Event",
      }),
    ).toBe("Great Free Event");

    expect(
      buildAndroidPublicShareMessage({
        title: "Great Free Event",
        url: canonicalUrl,
        description: "A free Mingla QA event.",
      }),
    ).toBe(`A free Mingla QA event.\n${canonicalUrl}`);

    expect(
      buildAndroidPublicShareMessage({
        title: "Great Free Event",
        url: canonicalUrl,
      }),
    ).toBe(`Great Free Event\n${canonicalUrl}`);

    expect(
      buildAndroidPublicShareMessage({
        title: "Great Free Event",
        url: canonicalUrl,
        description: `Already includes ${canonicalUrl}`,
      }),
    ).toBe(`Already includes ${canonicalUrl}`);

    expect(
      buildPublicShareText({
        title: "Great Free Event",
        url: canonicalUrl,
        description: "A free Mingla QA event.",
      }),
    ).toBe(`A free Mingla QA event.\n${canonicalUrl}`);
  });

  test("ShareModal guards copy/share with pending state and preserves copy toasts", () => {
    const source = repoFile("src/components/ui/ShareModal.tsx");

    expect(source).toContain("const [isCopying, setIsCopying]");
    expect(source).toContain("const [isSharing, setIsSharing]");
    expect(source).toContain("if (isCopying) return;");
    expect(source).toContain("if (isSharing) return;");
    expect(source).toContain("setIsCopying(true);");
    expect(source).toContain("setIsSharing(true);");
    expect(source).toContain("setIsCopying(false);");
    expect(source).toContain("setIsSharing(false);");
    expect(source).toContain("loading={isCopying}");
    expect(source).toContain("loading={isSharing}");
    expect(source).toContain("await copyPublicUrl(url);");
    expect(source).toContain('showToast("Link copied")');
    expect(source).toContain("Copy failed");
    expect(source).not.toContain("Tap Share via to copy on iOS / Android.");
  });
});
