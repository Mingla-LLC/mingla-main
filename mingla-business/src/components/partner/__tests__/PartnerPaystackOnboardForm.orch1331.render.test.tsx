/**
 * ORCH-1331 — PartnerPaystackOnboardForm RENDER + FIRE proof (mingla-tester
 * adversarial client leg).
 *
 * A REAL @testing-library/react-native mount of the production form. The
 * implementor's client suite is source-assertion (capped at "suspected");
 * this drives the DESIGN §3.2 state machine at runtime:
 *
 *   R-1  banks_loading  → bank field disabled (a tap must NOT open the sheet).
 *   R-2  banks_error    → E5 copy verbatim + Retry FIRES banksQuery.refetch.
 *   R-3  idle gating    → Verify CTA disabled with <10 digits; typing hostile
 *        input ("12ab34…", 12 digits) is stripped/clamped to 10; CTA enables
 *        only with bank + 10 digits (dead-tap check: disabled CTA never calls
 *        the resolve mutation).
 *   R-4  verify → confirm_name: resolved holder name renders + C10 hint;
 *        CTA swaps to "Connect bank & get paid".
 *   R-5  invalidation contract: editing one digit clears the confirm block →
 *        CTA back to "Verify account".
 *   R-6  resolve_error taxonomy at runtime: account_unresolved → E1 verbatim;
 *        network → E2 verbatim; fields editable again.
 *   R-7  connect hold (BINDING state 8): submitMutation.isSuccess (isPending
 *        false) → CTA still "Connecting…", disabled, busy — no flash back.
 *   R-8  connect_error: stripe_already_connected → E3 verbatim AND the
 *        confirm-name block is RETAINED.
 *   R-9  §7 copy verbatim (C2/C3/C4/C8) + I-39 a11y labels present.
 *
 * Hooks are module-mocked with a mutable state driver (the form's contract is
 * "render whatever the hooks say" — react-query's own subscription mechanics
 * are not under test here). Bank sheet interactions run through the REAL
 * Modal + rows. NO network anywhere.
 *
 * Run: npx jest --config jest.orch1331.render.cjs --runInBand
 */

import React from "react";

// ── module mocks (resolved-path shared with the form's own imports) ──────────

jest.mock("react-native-keyboard-controller", () => {
  const { View: V } = require("react-native");
  return { KeyboardAvoidingView: V };
});

// expo-blur pulls expo-modules-core's native EventEmitter (absent under jest's
// RN preset) — GlassChrome (via GlassCard) imports it; stub to a plain View.
jest.mock("expo-blur", () => {
  const { View: V } = require("react-native");
  return { BlurView: V };
});

jest.mock("react-native-reanimated", () => {
  const { View: V } = require("react-native");
  const passthrough = (c: unknown) => c;
  return {
    __esModule: true,
    default: { View: V, createAnimatedComponent: passthrough },
    View: V,
    createAnimatedComponent: passthrough,
    useSharedValue: (v: unknown) => ({ value: v }),
    useAnimatedStyle: () => ({}),
    withTiming: (v: unknown) => v,
    withSpring: (v: unknown) => v,
    useReducedMotion: () => true, // instant confirm-block render (design §6 fallback)
    Easing: { bezier: () => (t: number) => t, out: (f: unknown) => f },
  };
});

jest.mock("../../../wrappers/useKeyboardIsVisible", () => ({
  useKeyboardIsVisible: () => false,
}));

jest.mock("../../../utils/hapticFeedback", () => ({
  HapticFeedback: {
    light: jest.fn(),
    medium: jest.fn(),
    selection: jest.fn(),
    success: jest.fn(),
  },
}));

jest.mock("../../ui/Spinner", () => {
  const { View: V } = require("react-native");
  return { Spinner: (props: Record<string, unknown>) => <V testID="spinner" {...props} /> };
});

jest.mock("../../ui/Icon", () => {
  const { View: V } = require("react-native");
  return { Icon: ({ name }: { name: string }) => <V testID={`icon-${name}`} /> };
});

jest.mock("../../ui/Sheet", () => {
  const { View: V } = require("react-native");
  return { Sheet: (p: { children?: React.ReactNode }) => <V>{p.children}</V>, default: V };
});

// Mutable hook state — each test shapes it, the form renders it.
interface HookState {
  banks: {
    data: Array<{ name: string; code: string }> | undefined;
    isLoading: boolean;
    isError: boolean;
    refetch: jest.Mock;
  };
  resolve: {
    isPending: boolean;
    mutateAsync: jest.Mock;
  };
  submit: {
    isPending: boolean;
    isSuccess: boolean;
    mutateAsync: jest.Mock;
  };
}

const mockHookState: HookState = {
  banks: { data: [], isLoading: false, isError: false, refetch: jest.fn() },
  resolve: { isPending: false, mutateAsync: jest.fn() },
  submit: { isPending: false, isSuccess: false, mutateAsync: jest.fn() },
};

function resetHooks(): void {
  mockHookState.banks = {
    data: [
      { name: "GTBank", code: "058" },
      { name: "Access Bank", code: "044" },
    ],
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  };
  mockHookState.resolve = {
    isPending: false,
    mutateAsync: jest.fn().mockResolvedValue({
      account_name: "ADAOBI TEST OKAFOR",
      account_number: "0123456789",
    }),
  };
  mockHookState.submit = {
    isPending: false,
    isSuccess: false,
    mutateAsync: jest.fn().mockResolvedValue({ recipient_code: "RCP_r1" }),
  };
}

jest.mock("../../../hooks/usePartnerPaystack", () => ({
  usePartnerPaystackBanks: () => mockHookState.banks,
  useResolvePartnerPaystackAccount: () => mockHookState.resolve,
  useCreatePartnerPaystackRecipient: () => mockHookState.submit,
}));

import { fireEvent, render } from "@testing-library/react-native";
import { PartnerPaystackOnboardForm } from "../PartnerPaystackOnboardForm";

// §7 copy (bound verbatim by the DESIGN):
const C2 = "Get paid in Nigeria";
const C3 =
  "Connect your bank account to receive your partner earnings. Splits are paid in NGN directly to this account.";
const C4 =
  "Paystack will settle you in NGN. You'll only be able to partner with brands that sell in NGN.";
const C8 = "We keep only the last 4 digits of your account number.";
const C10_HINT = "Make sure this is you — payouts go to this account.";
const E1 =
  "We couldn't verify that account. Check the number and bank, then try again.";
const E2 =
  "We couldn't reach the bank check right now. Give it a second and try again.";
const E3 =
  "You already have a Stripe payout account. Disconnect it first, then connect your Nigerian bank.";
const E5 = "Couldn't load the bank list. Check your connection and try again.";

async function mount() {
  return await render(<PartnerPaystackOnboardForm onCancel={jest.fn()} />);
}

/** Drive to the verified state: pick GTBank, type 10 digits, press Verify. */
async function driveToConfirm(screen: Awaited<ReturnType<typeof mount>>) {
  await fireEvent.press(screen.getByTestId("partner-paystack-bank-field"));
  await fireEvent.press(screen.getByText("GTBank"));
  await fireEvent.changeText(
    screen.getByTestId("partner-paystack-account-input"),
    "0123456789",
  );
  await fireEvent.press(screen.getByTestId("partner-paystack-verify-cta"));
}

beforeEach(() => {
  resetHooks();
});

describe("ORCH-1331 RENDER — PartnerPaystackOnboardForm state machine", () => {
  test("R-1 banks_loading → bank field disabled; tap does NOT open the sheet", async () => {
    mockHookState.banks.isLoading = true;
    mockHookState.banks.data = undefined;
    const screen = await mount();
    const field = screen.getByTestId("partner-paystack-bank-field");
    expect(field.props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(field);
    expect(screen.queryByText("Choose your bank", { exact: true })).toBeTruthy();
    // The sheet title ("Choose your bank" also) would ADD a search input if open:
    expect(screen.queryByLabelText("Search banks")).toBeNull();
  });

  test("R-2 banks_error → E5 verbatim + Retry FIRES refetch", async () => {
    mockHookState.banks.isError = true;
    mockHookState.banks.data = undefined;
    const screen = await mount();
    expect(screen.getByText(E5)).toBeTruthy();
    await fireEvent.press(screen.getByText("Retry"));
    expect(mockHookState.banks.refetch).toHaveBeenCalledTimes(1);
  });

  test("R-3 idle gating — hostile input stripped/clamped; disabled CTA is a dead tap by design (resolve never fires)", async () => {
    const screen = await mount();
    const input = screen.getByTestId("partner-paystack-account-input");

    // Hostile: letters + 12 digits → digits-only, clamped to 10.
    await fireEvent.changeText(input, "01x2y3456789zz99");
    expect(screen.getByDisplayValue("0123456789")).toBeTruthy();

    // Under 10 digits → CTA disabled; press must NOT fire the mutation.
    await fireEvent.changeText(input, "01234");
    const cta = screen.getByTestId("partner-paystack-verify-cta");
    expect(cta.props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(cta);
    expect(mockHookState.resolve.mutateAsync).not.toHaveBeenCalled();

    // 10 digits but NO bank picked → still disabled.
    await fireEvent.changeText(input, "0123456789");
    expect(
      screen.getByTestId("partner-paystack-verify-cta").props
        .accessibilityState?.disabled,
    ).toBe(true);

    // Bank + 10 digits → enabled.
    await fireEvent.press(screen.getByTestId("partner-paystack-bank-field"));
    await fireEvent.press(screen.getByText("GTBank"));
    expect(
      screen.getByTestId("partner-paystack-verify-cta").props
        .accessibilityState?.disabled,
    ).toBe(false);
  });

  test("R-4 verify → confirm_name renders the resolved holder + C10 hint; CTA swaps", async () => {
    const screen = await mount();
    await driveToConfirm(screen);
    expect(mockHookState.resolve.mutateAsync).toHaveBeenCalledWith({
      accountNumber: "0123456789",
      bankCode: "058",
    });
    expect(screen.getByTestId("partner-paystack-confirm-name")).toBeTruthy();
    expect(screen.getByText("ADAOBI TEST OKAFOR")).toBeTruthy();
    expect(screen.getByText(C10_HINT)).toBeTruthy();
    expect(screen.getByTestId("partner-paystack-connect-cta")).toBeTruthy();
    expect(screen.queryByTestId("partner-paystack-verify-cta")).toBeNull();
  });

  test("R-5 invalidation — editing one digit clears the verification (back to Verify)", async () => {
    const screen = await mount();
    await driveToConfirm(screen);
    await fireEvent.changeText(
      screen.getByTestId("partner-paystack-account-input"),
      "0123456780", // one digit changed
    );
    expect(screen.queryByTestId("partner-paystack-confirm-name")).toBeNull();
    expect(screen.getByTestId("partner-paystack-verify-cta")).toBeTruthy();
    expect(screen.queryByTestId("partner-paystack-connect-cta")).toBeNull();
  });

  test("R-6 resolve_error taxonomy at runtime — E1 on account_unresolved, E2 on network", async () => {
    mockHookState.resolve.mutateAsync = jest
      .fn()
      .mockRejectedValue(new Error("account_unresolved: 422"));
    const screen = await mount();
    await driveToConfirm(screen);
    expect(screen.getByText(E1)).toBeTruthy();
    expect(screen.queryByTestId("partner-paystack-confirm-name")).toBeNull();

    // Network flavor → E2.
    mockHookState.resolve.mutateAsync = jest
      .fn()
      .mockRejectedValue(new Error("fetch failed: network down"));
    await fireEvent.press(screen.getByTestId("partner-paystack-verify-cta"));
    expect(screen.getByText(E2)).toBeTruthy();
  });

  test("R-7 BINDING state 8 — isSuccess (isPending false) holds the CTA at Connecting…/disabled/busy (no flash back)", async () => {
    const screen = await mount();
    await driveToConfirm(screen);

    // The mutation SUCCEEDED but the parent's status query has not flipped
    // yet — the exact no-flash window the design binds.
    mockHookState.submit = { ...mockHookState.submit, isPending: false, isSuccess: true };
    await screen.rerender(<PartnerPaystackOnboardForm onCancel={jest.fn()} />);

    const cta = screen.getByTestId("partner-paystack-connect-cta");
    expect(screen.getByText("Connecting…")).toBeTruthy();
    expect(cta.props.accessibilityState?.disabled).toBe(true);
    expect(cta.props.accessibilityState?.busy).toBe(true);
    // And pressing it in the hold window must NOT re-fire the mutation.
    await fireEvent.press(cta);
    expect(mockHookState.submit.mutateAsync).not.toHaveBeenCalled();
  });

  test("R-8 connect_error — 409 stripe_already_connected → E3 verbatim; confirm-name RETAINED", async () => {
    mockHookState.submit.mutateAsync = jest
      .fn()
      .mockRejectedValue(new Error("conflict: stripe_already_connected"));
    const screen = await mount();
    await driveToConfirm(screen);
    await fireEvent.press(screen.getByTestId("partner-paystack-connect-cta"));
    expect(screen.getByText(E3)).toBeTruthy();
    expect(
      screen.getByTestId("partner-paystack-confirm-name"),
    ).toBeTruthy(); // the resolution is still valid — design §3.2 state 9
    expect(screen.getByText("ADAOBI TEST OKAFOR")).toBeTruthy();
  });

  test("R-9 §7 copy verbatim + I-39 a11y labels", async () => {
    const screen = await mount();
    expect(screen.getByText(C2)).toBeTruthy();
    expect(screen.getByText(C3)).toBeTruthy();
    expect(screen.getByText(C4)).toBeTruthy();
    expect(screen.getByText(C8)).toBeTruthy();
    expect(screen.getByText("NOT CONNECTED")).toBeTruthy();
    // a11y labels (I-39): unpicked bank field + account input + back button.
    expect(screen.getByLabelText("Choose your bank")).toBeTruthy();
    expect(screen.getByLabelText("Bank account number")).toBeTruthy();
    expect(screen.getByText("‹ Choose a different country")).toBeTruthy();

    // After picking a bank the label upgrades (design §3.3 a11y upgrade).
    await fireEvent.press(screen.getByTestId("partner-paystack-bank-field"));
    await fireEvent.press(screen.getByText("Access Bank"));
    expect(screen.getByLabelText("Bank: Access Bank, tap to change")).toBeTruthy();
  });

  test("R-10 back button fires onCancel (the §1.4 return-to-picker affordance)", async () => {
    const onCancel = jest.fn();
    const screen = await render(<PartnerPaystackOnboardForm onCancel={onCancel} />);
    await fireEvent.press(screen.getByText("‹ Choose a different country"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
