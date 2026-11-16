/**
 * issue #4420 — the public parts that several routes render load on demand.
 *
 *   L-1 importing the boundary module evaluates none of the four parts (so
 *       no route that imports it pulls them into its own chunk, and Expo's
 *       serializer cannot hoist them into the eager web `__common` chunk);
 *   L-2 rendering a part shows its loading line first, then the real part
 *       with the same props;
 *   L-3 a failed chunk fetch shows the shared retry state, and Try again
 *       loads it (runs before L-2: a loaded module stays cached).
 *
 * Fails-on-revert: re-exporting the real components (a static import) makes
 * L-1 fail; dropping the Suspense fallback or the props pass-through fails
 * L-2; dropping the retry boundary fails L-3.
 */
import React from "react";
import { Text } from "react-native";

jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    jest.requireActual<typeof import("react")>("react").createElement("MockButton", props),
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));

const loaded: string[] = [];
let failNextHandoffLoad = false;

jest.mock("../../checkout/SecurePaymentHandoff", () => {
  if (failNextHandoffLoad) {
    failNextHandoffLoad = false;
    throw new Error("chunk failed");
  }
  loaded.push("SecurePaymentHandoff");
  const { Text: RNText } = jest.requireActual("react-native");
  return {
    __esModule: true,
    SecurePaymentHandoff: (props: { url: string; providerName: string }) => (
      <RNText testID="real-handoff">{`${props.providerName} ${props.url}`}</RNText>
    ),
  };
});
jest.mock("../../checkout/DownloadMinglaCta", () => {
  loaded.push("DownloadMinglaCta");
  return { __esModule: true, BuyerClaimCard: () => null };
});
jest.mock("../../trip/TripPreview", () => {
  loaded.push("TripPreview");
  return { __esModule: true, TripPreview: () => null };
});
jest.mock("../../trip/RefundPreviewBody", () => {
  loaded.push("RefundPreviewBody");
  return { __esModule: true, RefundPreviewBody: () => null };
});

type Node = { type: unknown; props: Record<string, unknown>; children: unknown[] };
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => {
    root: { findAll: (p: (n: Node) => boolean) => Node[] };
    unmount: () => void;
  };
  act: (fn: () => void | Promise<void>) => Promise<void>;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const palette = {
  page: "#0b0b0e",
  accent: "#b85c1a",
  accentText: "#ffffff",
  primaryText: "#ffffff",
  secondaryText: "rgba(255,255,255,0.78)",
  tertiaryText: "rgba(255,255,255,0.58)",
  panel: "rgba(255,255,255,0.08)",
  panelStrong: "rgba(255,255,255,0.11)",
  panelBorder: "rgba(184,92,26,0.38)",
  card: "rgba(255,255,255,0.10)",
  cutoutBorder: "rgba(255,255,255,0.24)",
  glass: "rgba(255,255,255,0.12)",
  glassTint: "dark" as const,
  accentWash: "rgba(184,92,26,0.24)",
};

const textOf = (tree: ReturnType<typeof TestRenderer.create>): string =>
  tree.root
    .findAll((n) => n.type === Text)
    .map((n) => {
      const c = n.props.children;
      return Array.isArray(c) ? c.join("") : typeof c === "string" ? c : "";
    })
    .join("|");

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) {
    await TestRenderer.act(async () => {
      await Promise.resolve();
    });
  }
};

describe("issue #4420 — public parts load on demand", () => {
  test("L-1 importing the boundary evaluates none of the parts", () => {
    require("../LazyPublicParts");
    expect(loaded).toEqual([]);
  });

  test("L-3 a failed chunk shows the retry state, and retry loads it", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    failNextHandoffLoad = true;
    const { SecurePaymentHandoff } = require("../LazyPublicParts");
    let tree!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <SecurePaymentHandoff
          url="https://checkout.stripe.com/c/pay/cs_test_10"
          palette={palette}
          providerName="Stripe"
          onBack={() => undefined}
        />,
      );
    });
    await flush();
    expect(tree.root.findAll((n) => n.props.testID === "real-handoff")).toHaveLength(0);
    const retry = tree.root.findAll(
      (n) => n.type === "MockButton" && n.props.label === "Try again",
    )[0];
    expect(retry).toBeDefined();
    await TestRenderer.act(async () => {
      (retry?.props.onPress as () => void)();
    });
    await flush();
    expect(tree.root.findAll((n) => n.props.testID === "real-handoff").length).toBeGreaterThan(0);
    await TestRenderer.act(async () => tree.unmount());
    errorSpy.mockRestore();
  });
  test("L-2 a part shows its loading line, then renders with its props", async () => {
    const { SecurePaymentHandoff } = require("../LazyPublicParts");
    let tree!: ReturnType<typeof TestRenderer.create>;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        <SecurePaymentHandoff
          url="https://checkout.stripe.com/c/pay/cs_test_9"
          palette={palette}
          providerName="Stripe"
          onBack={() => undefined}
        />,
      );
    });
    expect(textOf(tree)).toContain("Opening secure payment…");
    await flush();
    expect(textOf(tree)).not.toContain("Opening secure payment…");
    expect(textOf(tree)).toContain("Stripe https://checkout.stripe.com/c/pay/cs_test_9");
    await TestRenderer.act(async () => tree.unmount());
  });

});
