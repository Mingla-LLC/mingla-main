import React from "react";
import { Platform, View } from "react-native";

import { BuyerClaimCard } from "../DownloadMinglaCta";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface RenderNode {
  props: Record<string, unknown> & {
    accessibilityLabel?: string;
    children?: unknown;
    onPress?: () => void;
    testID?: string;
  };
  findAll: (
    predicate: (node: RenderNode) => boolean,
    options?: { deep: boolean },
  ) => RenderNode[];
}

interface RenderTree {
  root: RenderNode;
  toJSON: () => unknown;
  unmount: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => void | Promise<void>) => Promise<void>;
};
const { act } = TestRenderer;

const mockOpenExternal = jest.fn();
const mockDetectClientPlatform = jest.fn(() => "other");
const mockCaptureWeb = jest.fn();

jest.mock("../../../services/guestFunnelLink", () => ({
  detectClientPlatform: () => mockDetectClientPlatform(),
  openAppScheme: jest.fn(),
  openExternal: (...args: unknown[]) => mockOpenExternal(...args),
  resolveConfirmationAppTarget: () => ({
    mode: "store_direct",
    ctaUrl: "https://usemingla.com/download",
    qrUrl: "https://usemingla.com/download",
    store: "download_page",
  }),
}));

jest.mock("../../../analytics/phMask", () => ({
  phMaskProps: () => ({ "data-ph-mask": true }),
}));

jest.mock("../../../analytics/webAnalytics", () => ({
  captureWeb: (...args: unknown[]) => mockCaptureWeb(...args),
}));

jest.mock("../../../services/postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));

jest.mock("../../event/GateQr", () => ({
  GateQr: ({ value }: { value: string }) => (
    <View testID="claim-handoff-qr" accessibilityLabel={value} />
  ),
}));

jest.mock("../../ui/Icon", () => ({ Icon: () => null }));

Object.defineProperty(Platform, "OS", { value: "web", configurable: true });

const baseProps = {
  kind: "ticket" as const,
  email: "buyer@example.com",
  phoneLast4: "4432",
  shortUrl: "https://usemingla.com/c/CLAIM12345",
  textSent: true,
  analyticsSurface: "checkout_confirm_event",
  fallbackEntity: {
    entityType: "event" as const,
    brandSlug: "mingla",
    entitySlug: "night-out",
  },
};

function visibleText(tree: RenderTree): string {
  return JSON.stringify(tree.toJSON());
}

function nodesByTestId(tree: RenderTree, testID: string): RenderNode[] {
  return tree.root.findAll((node) => node.props.testID === testID, {
    deep: true,
  });
}

async function mount(
  props: Partial<React.ComponentProps<typeof BuyerClaimCard>> = {},
): Promise<RenderTree> {
  let tree!: RenderTree;
  await act(async () => {
    tree = TestRenderer.create(
      <BuyerClaimCard {...baseProps} handoff={null} {...props} />,
    );
    await Promise.resolve();
  });
  return tree;
}

async function unmount(tree: RenderTree): Promise<void> {
  await act(async () => {
    tree.unmount();
  });
}

describe("#4063 BuyerClaimCard", () => {
  beforeEach(() => {
    mockOpenExternal.mockReset();
    mockCaptureWeb.mockReset();
    mockDetectClientPlatform.mockReset().mockReturnValue("other");
  });

  test("phone has one claim action and opens its short URL synchronously", async () => {
    mockDetectClientPlatform.mockReturnValue("ios");
    const tree = await mount({ variant: "phone" });

    expect(visibleText(tree)).toContain(
      "Your ticket is waiting in the Mingla app.",
    );
    expect(visibleText(tree)).toContain("buyer@example.com");
    expect(visibleText(tree)).toContain("4432");
    expect(visibleText(tree)).toContain("Get my tickets");
    expect(nodesByTestId(tree, "buyer-claim-primary").length).toBeGreaterThan(
      0,
    );
    expect(nodesByTestId(tree, "claim-handoff-qr")).toHaveLength(0);

    nodesByTestId(tree, "buyer-claim-primary")[0]?.props.onPress?.();
    expect(mockOpenExternal).toHaveBeenCalledWith(baseProps.shortUrl);
    expect(JSON.stringify(mockCaptureWeb.mock.calls)).not.toContain(
      "buyer@example.com",
    );
    await unmount(tree);
  });

  test("desktop without a handoff shows recovery truth but no QR or error", async () => {
    const tree = await mount({ variant: "desktop", handoff: null });
    const text = visibleText(tree);

    expect(text).toContain(
      "Your ticket is waiting in the Mingla app on your phone.",
    );
    expect(text).toContain(
      "We also texted the link to the number ending 4432.",
    );
    expect(text).not.toContain("We couldn't prepare a code");
    expect(nodesByTestId(tree, "claim-handoff-qr")).toHaveLength(0);
    expect(nodesByTestId(tree, "buyer-claim-primary")).toHaveLength(0);
    expect(nodesByTestId(tree, "buyer-claim-scan-refresh")).toHaveLength(0);
    await unmount(tree);
  });

  test("desktop mints a non-ticket QR and replaces it when it expires", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-24T16:00:00.000Z"));
    const mint = jest.fn().mockResolvedValue({
      ok: true,
      handoffUrl: "https://usemingla.com/c/HANDOFF123",
      expiresAt: "2026-10-24T16:10:00.000Z",
    });

    const tree = await mount({ variant: "desktop", handoff: { mint } });
    expect(mint).toHaveBeenCalledTimes(1);
    expect(nodesByTestId(tree, "claim-handoff-qr").length).toBeGreaterThan(0);
    expect(
      nodesByTestId(tree, "claim-handoff-qr").some(
        (node) =>
          node.props.accessibilityLabel ===
          "https://usemingla.com/c/HANDOFF123",
      ),
    ).toBe(true);
    expect(visibleText(tree)).toContain("This is not your ticket.");

    await act(async () => {
      await jest.advanceTimersByTimeAsync(600_000);
    });
    expect(nodesByTestId(tree, "claim-handoff-qr")).toHaveLength(0);
    expect(visibleText(tree)).toContain("This code has expired.");
    expect(
      nodesByTestId(tree, "buyer-claim-scan-refresh").length,
    ).toBeGreaterThan(0);

    await unmount(tree);
    jest.useRealTimers();
  });

  test("a rate limit is honest and offers no retry button", async () => {
    const mint = jest.fn().mockResolvedValue({
      ok: false,
      reason: "rate_limited",
      retryAfterSeconds: 60,
    });
    const tree = await mount({ variant: "desktop", handoff: { mint } });

    expect(visibleText(tree)).toContain(
      "Too many codes for this ticket. Try again in a few minutes.",
    );
    expect(nodesByTestId(tree, "claim-handoff-qr")).toHaveLength(0);
    expect(nodesByTestId(tree, "buyer-claim-scan-refresh")).toHaveLength(0);
    await unmount(tree);
  });
});
