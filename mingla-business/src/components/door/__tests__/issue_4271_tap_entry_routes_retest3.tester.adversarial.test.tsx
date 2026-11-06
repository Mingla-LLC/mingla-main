/**
 * #4271 retest 3 — adversarial: the Tap to Pay entry points still reach setup
 * after f14d9806e8 moved navigation out of the shared components.
 *
 * The builder pins this with source strings. This mounts the two REAL payments
 * routes (stock node/ts-jest Business gate, react-test-renderer), with the
 * views replaced by stubs that capture their props, and presses the callback the
 * route hands down:
 *   E1 Payments (`app/brand/[id]/payments/index.tsx`) passes onOpenTapToPay, and
 *      it opens `/account/tap-to-pay?brandId=<the brand's id, encoded>`.
 *   E2 Onboarding (`app/brand/[id]/payments/onboard.tsx`) does the same from the
 *      route's id, including an id that needs encoding.
 *   E3 Payments with no brand loaded: the callback does nothing (no push to a
 *      setup page with an empty brand), and onboarding with no id passes none
 *      (so the card hides instead of a dead tap).
 *
 * fails-on-revert (retest 3, at f14d9806e8): the two route files back to
 * f14d9806e8^ (no onOpenTapToPay passed) -> E1 and E2 fail.
 */

/* eslint-disable @typescript-eslint/no-require-imports, import/first */

import React from "react";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPush = jest.fn();
let mockParams: Record<string, string | undefined> = {};
let mockBrand: { id: string } | null = null;
const mockViewProps: { payments?: Record<string, unknown>; onboard?: Record<string, unknown> } = {};

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("../../../hooks/useBrands", () => ({
  useBrand: () => ({ data: mockBrand }),
}));
jest.mock("../../../components/brand/BrandPaymentsPermissionGate", () => ({
  BrandPaymentsPermissionGate: ({ children }: { children?: React.ReactNode }) => children,
}));
jest.mock("../../../components/brand/BrandPaymentsView", () => ({
  BrandPaymentsView: (props: Record<string, unknown>) => {
    mockViewProps.payments = props;
    return null;
  },
}));
jest.mock("../../../components/brand/BrandOnboardView", () => ({
  BrandOnboardView: (props: Record<string, unknown>) => {
    mockViewProps.onboard = props;
    return null;
  },
}));

const { act, create } = require("react-test-renderer") as {
  act: (callback: () => void) => void;
  create: (element: React.ReactElement) => unknown;
};

const PaymentsRoute = require("../../../../app/brand/[id]/payments/index").default as React.ComponentType;
const OnboardRoute = require("../../../../app/brand/[id]/payments/onboard").default as React.ComponentType;

const mount = (Route: React.ComponentType): void => {
  act(() => {
    create(<Route />);
  });
};

beforeEach(() => {
  mockPush.mockReset();
  mockViewProps.payments = undefined;
  mockViewProps.onboard = undefined;
});

describe("#4271 retest 3: the real payments routes open Tap to Pay setup", () => {
  test("E1: Payments hands down onOpenTapToPay, which opens setup for the loaded brand", () => {
    mockParams = { id: "brand-1" };
    mockBrand = { id: "b 1/é" };
    mount(PaymentsRoute);
    const open = mockViewProps.payments?.onOpenTapToPay;
    expect(typeof open).toBe("function");
    act(() => (open as () => void)());
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(`/account/tap-to-pay?brandId=${encodeURIComponent("b 1/é")}`);
  });

  test("E2: Onboarding hands down onOpenTapToPay from the route's id, encoded", () => {
    mockParams = { id: "brand 2&x=1" };
    mockBrand = null;
    mount(OnboardRoute);
    const open = mockViewProps.onboard?.onOpenTapToPay;
    expect(typeof open).toBe("function");
    act(() => (open as () => void)());
    expect(mockPush).toHaveBeenCalledWith("/account/tap-to-pay?brandId=brand%202%26x%3D1");
  });

  test("E3: no brand loaded on Payments pushes nothing; no id on Onboarding passes no callback", () => {
    mockParams = { id: "brand-1" };
    mockBrand = null;
    mount(PaymentsRoute);
    const open = mockViewProps.payments?.onOpenTapToPay as (() => void) | undefined;
    if (open !== undefined) act(() => open());
    expect(mockPush).not.toHaveBeenCalled();

    mockParams = {};
    mount(OnboardRoute);
    expect(mockViewProps.onboard).toBeDefined();
    expect(mockViewProps.onboard?.onOpenTapToPay).toBeUndefined();
  });
});
