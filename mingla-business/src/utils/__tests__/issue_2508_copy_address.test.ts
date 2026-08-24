// issue #2508 [maps-app-chooser] — the RUNTIME clipboard proof.
//
// The Deno suite (packages/offering-rendering/__tests__/issue_2508_maps_app_chooser.test.ts)
// proves WHAT text the copy button is allowed to carry and that a withheld
// address produces none. It cannot prove the text actually reaches a clipboard,
// because the host effect imports react-native.
//
// This does: it drives `copyAddressText` on BOTH arms and asserts the exact
// address string lands on the exact clipboard API — `expo-clipboard` natively,
// `navigator.clipboard` on the buyer web — and that a missing clipboard
// THROWS instead of resolving into a false "Copied" confirmation.
//
// Mocking idiom copied verbatim from `sharePublicUrl.test.ts`, the sibling that
// already tests this app's other clipboard path.
//
// FAILS-ON-REVERT: delete the `await clipboard.writeText(value)` line → the web
// test fails; delete `await loadExpoClipboard().setStringAsync(value)` → the
// native test fails; delete either `throw new Error(...)` → a no-clipboard
// test fails.

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

let mockPlatformOS = "ios";
const mockSetStringAsync = jest.fn<(...args: unknown[]) => Promise<void>>();

jest.mock("react-native", () => ({
  Platform: {
    get OS() {
      return mockPlatformOS;
    },
  },
}));

jest.mock("expo-clipboard", () => ({
  setStringAsync: (...args: unknown[]) => mockSetStringAsync(...args),
}));

// eslint-disable-next-line import/first
import { copyAddressText } from "../copyAddressText";

// The composed label `selectVenueMapsTarget` produces for the production event
// #2468 was proven against — venue name + street, exactly what a guest pastes
// into Waze or a message.
const ADDRESS =
  "Didi Museum, Akin Adesola Street 175, Lagos 10, Lagos, Nigeria";

const setNavigator = (value: unknown): void => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value,
  });
};

describe("issue #2508 copyAddressText", () => {
  beforeEach(() => {
    mockPlatformOS = "ios";
    mockSetStringAsync.mockReset();
    mockSetStringAsync.mockResolvedValue(undefined);
    setNavigator(undefined);
  });

  test("native: the exact address text lands on the clipboard", async () => {
    await copyAddressText(ADDRESS);
    expect(mockSetStringAsync).toHaveBeenCalledTimes(1);
    expect(mockSetStringAsync).toHaveBeenCalledWith(ADDRESS);
  });

  test("android takes the same native path", async () => {
    mockPlatformOS = "android";
    await copyAddressText(ADDRESS);
    expect(mockSetStringAsync).toHaveBeenCalledWith(ADDRESS);
  });

  test("web: the exact address text lands on navigator.clipboard", async () => {
    mockPlatformOS = "web";
    const writeText = jest.fn<(value: string) => Promise<void>>();
    writeText.mockResolvedValue(undefined);
    setNavigator({ clipboard: { writeText } });

    await copyAddressText(ADDRESS);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(ADDRESS);
    // The buyer web must NOT reach for the native module.
    expect(mockSetStringAsync).not.toHaveBeenCalled();
  });

  test("it copies the ADDRESS, not a URL and not a coordinate pair", async () => {
    mockPlatformOS = "web";
    const writeText = jest.fn<(value: string) => Promise<void>>();
    writeText.mockResolvedValue(undefined);
    setNavigator({ clipboard: { writeText } });

    await copyAddressText(ADDRESS);

    const copied = writeText.mock.calls[0]?.[0] ?? "";
    expect(copied).toBe(ADDRESS);
    expect(copied).not.toContain("http");
    expect(copied).not.toContain("maps://");
    expect(copied).not.toContain("6.43273");
  });

  test("surrounding whitespace is trimmed, so the paste is clean", async () => {
    await copyAddressText(`   ${ADDRESS}   `);
    expect(mockSetStringAsync).toHaveBeenCalledWith(ADDRESS);
  });

  // Constitution #3 — a copy that did not happen must never resolve, or the
  // button confirms "Copied" for a clipboard the guest never got.
  test("web with no clipboard API THROWS instead of silently succeeding", async () => {
    mockPlatformOS = "web";
    setNavigator({});
    await expect(copyAddressText(ADDRESS)).rejects.toThrow(
      "clipboard_unavailable",
    );
    expect(mockSetStringAsync).not.toHaveBeenCalled();
  });

  test("empty text THROWS rather than clearing the guest's clipboard", async () => {
    await expect(copyAddressText("   ")).rejects.toThrow("copy_address_empty");
    expect(mockSetStringAsync).not.toHaveBeenCalled();
  });

  test("a rejecting clipboard propagates, so the button can show the failure", async () => {
    mockSetStringAsync.mockRejectedValue(new Error("denied"));
    await expect(copyAddressText(ADDRESS)).rejects.toThrow("denied");
  });
});
