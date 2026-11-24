/**
 * #4420 — the guest's /pay/door/<code> page on the Public status template
 * (spec §3.6, kit `.tpl-status`). Rendered with the real page; the code read is
 * mocked at the service boundary.
 *
 *   S1  wide web: the status sits in the main column and the locked basket in
 *       the 380 summary column; the form drops its own basket.
 *   S2  phone: no summary column; the basket pane sits on top of the form.
 *   S3  every end state keeps its #4271 copy and door tone tile, beside the summary.
 *   S4  no code (not found): one full-width status, no summary.
 *   S5  the page stays anonymous (no useAuth) and keeps no old token import.
 *   S6  the Tap to Pay sale on wide web sits in the same 1040 status column.
 *   S7  Tap to Pay setup on wide web sits in that column too (wave 6).
 *
 * FAILS-ON-REVERT: putting the old single centred card back fails S1 and S3.
 */
import fs from "fs";
import path from "path";
import React from "react";

// react-test-renderer ships no types in this app.
interface ReactTestInstance {
  type: unknown;
  props: Record<string, any>;
  children: (ReactTestInstance | string)[];
  findAll: (predicate: (node: ReactTestInstance) => boolean) => ReactTestInstance[];
}
interface ReactTestRenderer {
  root: ReactTestInstance;
  unmount: () => void;
}
const renderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => ReactTestRenderer;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};
const { act } = renderer;

let mockWide = false;
let mockView: Record<string, unknown> | null = null;

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ code: "K7Q2M9XA" }),
  usePathname: () => "/pay/door/K7Q2M9XA",
}));
jest.mock("react-native-safe-area-context", () => {
  const { View } = jest.requireActual("react-native");
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: mockWide, isWeb: true, width: mockWide ? 1440 : 390, isShort: false }),
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Spinner", () => ({ Spinner: () => null }));
jest.mock("../../ui/GlassCard", () => {
  const { View } = jest.requireActual("react-native");
  return {
    GlassCard: ({ children, testID }: { children: React.ReactNode; testID?: string }) => (
      <View testID={testID}>{children}</View>
    ),
  };
});
jest.mock("../../ui/Input", () => ({ Input: () => null }));
jest.mock("../../ui/PhoneField", () => ({
  PhoneField: () => null,
  usePhoneEntry: () => ({ reset: jest.fn(), e164: null, countryIso: "US", isEmpty: true }),
}));
jest.mock("../../ui/Button", () => {
  const { Text } = jest.requireActual("react-native");
  return {
    Button: ({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) => (
      <Text onPress={onPress} testID={testID}>
        {label}
      </Text>
    ),
  };
});
jest.mock("../../../services/consentService", () => ({ recordConsent: jest.fn() }));
jest.mock("../../../services/doorPayCodeService", () => {
  class DoorPayCodeError extends Error {
    code: string;
    status: number | null;
    codeStatus: string | null;
    constructor(code: string, status: number | null = null, codeStatus: string | null = null) {
      super(code);
      this.code = code;
      this.status = status;
      this.codeStatus = codeStatus;
    }
  }
  return {
    DoorPayCodeError,
    createDoorCodeCheckout: jest.fn(),
    viewDoorPayCode: jest.fn(async () => {
      if (mockView === null) throw new DoorPayCodeError("not_found", 404);
      return mockView;
    }),
  };
});

// eslint-disable-next-line import/first
import DoorPayGuestPage from "../../../../app/pay/door/[code]";

const view = (status: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  status,
  eventId: "event-1",
  eventDateId: null,
  eventName: "Friday Night Film Club",
  eventStartsAt: null,
  venueLabel: null,
  brandName: "Film Club",
  lines: [{ ticketTypeId: "tier-1", name: "Single Screening", quantity: 1, unitCents: 2200 }],
  subtotalCents: 2200,
  feeCents: 0,
  totalCents: 2200,
  currency: "USD",
  expiresAt: null,
  provider: "stripe",
  latePayment: null,
  ...extra,
});

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  act(() => {
    for (let tree = mounted.pop(); tree; tree = mounted.pop()) tree.unmount();
  });
});

const mount = async (): Promise<ReactTestRenderer> => {
  let tree: ReactTestRenderer | null = null;
  await act(async () => {
    tree = renderer.create(<DoorPayGuestPage />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  mounted.push(tree!);
  return tree!;
};

const byTestId = (tree: ReactTestRenderer, id: string): ReactTestInstance[] =>
  tree.root.findAll((n) => typeof n.type === "string" && n.props.testID === id);

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const screenText = (tree: ReactTestRenderer): string =>
  tree.root
    .findAll((n) => typeof n.type === "string" && n.type === "Text")
    .map(textOf)
    .join("\n");

describe("#4420 door guest page on the Public status template", () => {
  // #4490: the page shows the Mingla logo image (labelled "Mingla"), never the word typed out.
  test("S-logo the Mingla logo image heads the page; no text wordmark", async () => {
    mockWide = false;
    mockView = view("open");
    const tree = await mount();
    const logo = byTestId(tree, "guest-pay-wordmark");
    expect(logo).toHaveLength(1);
    expect(logo[0].props.accessibilityLabel).toBe("Mingla");
    expect(logo[0].props.accessibilityRole).toBe("image");
    expect(screenText(tree).split("\n")).not.toContain("Mingla");
  });

  test("S1 wide web: status left, the locked basket in the summary column", async () => {
    mockWide = true;
    mockView = view("open");
    const tree = await mount();
    expect(byTestId(tree, "door-pay-guest-status-template")).toHaveLength(1);
    expect(byTestId(tree, "door-pay-guest-summary")).toHaveLength(1);
    expect(byTestId(tree, "door-pay-form")).toHaveLength(1);
    // The form no longer carries a second copy of the basket.
    expect(byTestId(tree, "door-pay-guest-basket")).toHaveLength(0);
    const text = screenText(tree);
    expect(text).toContain("PAY AT THE DOOR");
    expect(text).toContain("Friday Night Film Club");
    expect(text).toContain("1× Single Screening");
    expect(text).toContain("Continue to pay $22.00");
    expect(text).toContain("All three are needed for your ticket.");
  });

  test("S2 phone: no summary column, the basket pane on top of the form", async () => {
    mockWide = false;
    mockView = view("opened");
    const tree = await mount();
    expect(byTestId(tree, "door-pay-guest-status-template")).toHaveLength(0);
    expect(byTestId(tree, "door-pay-guest-summary")).toHaveLength(0);
    expect(byTestId(tree, "door-pay-guest-basket")).toHaveLength(1);
    expect(screenText(tree)).toContain("PAY AT THE DOOR · FRIDAY NIGHT FILM CLUB");
  });

  test.each([
    ["expired", "neutral", "This code has expired"],
    ["cancelled", "neutral", "The door cancelled this sale"],
    ["failed", "bad", "Payment didn't go through"],
    ["paid", "ok", "This code is already paid"],
  ])("S3 %s keeps its copy and %s tile beside the summary", async (status, tone, title) => {
    mockWide = true;
    mockView = view(status);
    const tree = await mount();
    expect(byTestId(tree, `door-pay-guest-tone-${tone}`)).toHaveLength(1);
    expect(byTestId(tree, "door-pay-guest-summary")).toHaveLength(1);
    expect(screenText(tree)).toContain(title);
  });

  test("S3 a late refund keeps its money copy and never says not charged", async () => {
    mockWide = true;
    mockView = view("expired", { latePayment: { state: "refunding", amountCents: 2200, currency: "USD" } });
    const tree = await mount();
    const text = screenText(tree);
    expect(text).toContain("Your payment is being refunded");
    expect(text).toContain("$22.00 is queued to go back to you.");
    expect(text).not.toContain("You weren't charged");
  });

  test("S4 not found: one full-width status and no summary", async () => {
    mockWide = true;
    mockView = null;
    const tree = await mount();
    expect(byTestId(tree, "door-pay-guest-summary")).toHaveLength(0);
    expect(screenText(tree)).toContain("This code isn't valid");
  });

  test("S5 the page stays anonymous and on Graphite tokens", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../../../../app/pay/door/[code].tsx"), "utf8");
    expect(source).not.toMatch(/useAuth\b/);
    expect(source).toContain('DESKTOP_TEMPLATE_MAX_WIDTH.status');
    for (const legacy of ["canvas.discover", "glass.border", "accent.warm", "semantic.", "typography."]) {
      expect(source).not.toContain(legacy);
    }
    expect(source).not.toMatch(/["']#[0-9a-fA-F]{3,8}["']/);
  });

  test("S6 Tap to Pay sale on wide web uses the status column, never full-bleed buttons", () => {
    const sale = fs.readFileSync(path.resolve(__dirname, "../tap/TapToPaySaleScreen.tsx"), "utf8");
    expect(sale).toContain('const wideWeb = Platform.OS === "web" && isWideDesktop;');
    expect(sale).toContain('testID="tap-sale-status-template"');
    expect(sale).toContain("maxWidth: DESKTOP_TEMPLATE_MAX_WIDTH.status");
    // Phones and native keep the full-screen tool exactly as before.
    expect(sale).toMatch(/\) : \(\n\s+<>\n\s+\{chrome\}\n\s+\{renderBody\(\)\}/);
  });

  test("S7 Tap to Pay setup on wide web uses the 1040 status column with a readable step", () => {
    // [TEST-MOD-APPROVED #4420] — wave 6: the setup screen joins the sale's column.
    const setup = fs.readFileSync(path.resolve(__dirname, "../tap/TapToPaySetupScreen.tsx"), "utf8");
    expect(setup).toContain('const wideWeb = Platform.OS === "web" && isWideDesktop;');
    expect(setup).toContain('testID="tap-setup-status-template"');
    expect(setup).toContain("maxWidth: DESKTOP_TEMPLATE_MAX_WIDTH.status");
    expect(setup).toContain("wideStep: { flex: 1, width: \"100%\", maxWidth: size.modal }");
    // Phones and native keep the full-screen setup exactly as before.
    expect(setup).toMatch(/\) : \(\n\s+<>\n\s+\{chrome\}\n\s+\{body\}/);
  });
});
