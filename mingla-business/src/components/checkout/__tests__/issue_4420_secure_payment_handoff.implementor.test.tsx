/**
 * issue #4420 wave 2 (§2.4, payments test 16 Nov) — the venue and Stay
 * hosted-payment handoff.
 *
 *   H-1 web opens the payment page in THIS tab (`location.assign`), never
 *       `window.open` (which popup blockers stop outside a click);
 *   H-2 the Secure payment step shows "Opening …" first, and only after 3 s
 *       without leaving does it offer a real link to the same URL;
 *   H-3 that link is a link role with a label, and "Back to review" works.
 *
 * Fails-on-revert: going back to Linking.openURL / window.open on web fails
 * H-1; showing the fallback at once or never fails H-2; a button without a
 * link role or href fails H-3.
 */
import React from "react";

jest.mock("../../ui/Icon", () => ({ __esModule: true, Icon: () => null }));

const openSpy = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
jest.mock("../../../payments/openPaymentPage", () => {
  const actual = jest.requireActual("../../../payments/openPaymentPage");
  return {
    ...actual,
    openPaymentPage: (url: string) => openSpy(url),
  };
});

const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => {
    root: {
      findAll: (p: (n: { type: unknown; props: Record<string, unknown> }) => boolean) => Array<{
        type: unknown;
        props: Record<string, unknown>;
      }>;
    };
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

describe("issue #4420 — secure payment handoff", () => {
  test("H-1 web navigates this tab and never calls window.open", async () => {
    const { openPaymentPage } = jest.requireActual("../../../payments/openPaymentPage");
    const assign = jest.fn();
    const windowOpen = jest.fn();
    Object.assign(globalThis, { open: windowOpen });
    await openPaymentPage("https://checkout.stripe.com/c/pay/cs_test_1", {
      location: { assign },
    });
    expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_test_1");
    expect(windowOpen).not.toHaveBeenCalled();
  });

  test("H-2/H-3 the fallback link appears after 3 s and points at the session", async () => {
    jest.useFakeTimers();
    const { SecurePaymentHandoff } = require("../SecurePaymentHandoff");
    const onBack = jest.fn();
    const url = "https://checkout.stripe.com/c/pay/cs_test_2";
    let tree!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <SecurePaymentHandoff
          url={url}
          palette={palette}
          onBack={onBack}
          testID="h"
        />,
      );
    });
    expect(openSpy).toHaveBeenCalledWith(url);
    // Seth's standing rule: guest copy names no payment provider.
    const shown = tree.root
      .findAll((n) => n.type === "Text")
      .map((n) => [n.props.children].flat().filter((c) => typeof c === "string").join(""))
      .join(" ");
    expect(shown).toContain("Opening secure payment…");
    expect(shown).toContain("Our secure payment page opens in this tab");
    expect(shown).not.toMatch(/Stripe|Paystack/);
    const fallback = () => tree.root.findAll((n) => n.props.testID === "h-fallback");
    expect(fallback()).toHaveLength(0);
    await TestRenderer.act(async () => {
      jest.advanceTimersByTime(2900);
    });
    expect(fallback()).toHaveLength(0);
    await TestRenderer.act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(fallback().length).toBeGreaterThan(0);
    // A real anchor in this tab (web): a user gesture no blocker stops.
    const link = tree.root.findAll((n) => n.type === "a")[0];
    expect(link).toBeDefined();
    expect(link?.props.href).toBe(url);
    expect(link?.props.target).toBe("_self");
    expect(link?.props.role).toBe("link");
    expect(link?.props["aria-label"]).toBe("Continue to payment");
    const back = tree.root.findAll(
      (n) => n.props.testID === "h-back" && typeof n.props.onPress === "function",
    )[0];
    await TestRenderer.act(async () => {
      (back?.props.onPress as () => void)();
    });
    expect(onBack).toHaveBeenCalledTimes(1);
    await TestRenderer.act(async () => tree.unmount());
    jest.useRealTimers();
  });
});
