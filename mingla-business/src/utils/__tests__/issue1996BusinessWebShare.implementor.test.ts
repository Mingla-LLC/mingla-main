import { readFileSync } from "fs";
import path from "path";

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
import { copyPublicUrl } from "../sharePublicUrl";

const businessFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

const repositoryFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), "..", relativePath), "utf8");

describe("#1996 Business desktop share regression", () => {
  beforeEach(() => {
    mockPlatformOS = "web";
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: undefined,
    });
  });

  test("Clipboard write keeps the browser Clipboard object as its receiver", async () => {
    const clipboard = {
      writeText: jest.fn(async function (this: unknown, value: string) {
        expect(this).toBe(clipboard);
        expect(value).toBe("https://usemingla.com/s/Aa0Bb1Cc2Dd3Ee4F");
      }),
    };
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard },
    });

    await copyPublicUrl("https://usemingla.com/s/Aa0Bb1Cc2Dd3Ee4F");

    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
  });

  test("the split dialog preloads once without moving preparation into its shell", () => {
    const shell = businessFile("src/components/ui/ShareModal.tsx");

    expect(shell).toContain("shareModalContentPromise ??= importShareModalContent()");
    expect(shell).toContain("void loadShareModalContent()");
    expect(shell).toContain("const module = await loadShareModalContent()");
    expect(shell).not.toContain("prepareBusinessContentShare");
  });

  test("browser transports are loaded before Copy or Share receives a click", () => {
    const content = businessFile("src/components/ui/ShareModalContent.tsx");

    expect(content).toContain(
      "import { copyPublicUrl, sharePublicUrl } from '../../utils/sharePublicUrl';",
    );
    expect(content).not.toContain("await import('../../utils/sharePublicUrl')");
    expect(content).toContain("await copyPublicUrl(prepared.url)");
    expect(content).toContain("await sharePublicUrl({ title: prepared.title");
  });

  test("public readiness permits credential-free cross-origin reads and remains uncached", () => {
    const readiness = repositoryFile(
      "mingla-marketing/lib/content-share-readiness.ts",
    );

    expect(readiness).toContain("'access-control-allow-origin': '*'");
    expect(readiness).toContain(
      "'cache-control': 'private, no-store, max-age=0'",
    );
    expect(readiness).toContain("'cdn-cache-control': 'no-store'");
    expect(readiness).toContain("'vercel-cdn-cache-control': 'no-store'");
  });
});
