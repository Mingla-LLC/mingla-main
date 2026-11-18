/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4473 — "Missing a ticket?" and its dark add sheet (implementor, render).
 *
 *   - The screen: Check again runs the claim sweep, shows a spinner, then
 *     "Checked", and the "Last checked" line updates; the three "Bought it
 *     another way?" buttons open the sheet on the right step.
 *   - The add sheet: Email | Mobile tabs (tab roles, selected state), Send code
 *     only once the value is shaped, the code step, auto-verify at 6 digits,
 *     Checking, then Found cards that open the purchase detail route, the
 *     shared note only when an entry says so, Nothing found with its three
 *     ways on, and every refusal code keeping its copy.
 *   - Ask them to send it: the shared message carries this account's
 *     confirmed email and mobile, and leaves them out when there are none.
 *   - Use your confirmation link: Open Mail, and a visible note when no mail
 *     app opens.
 *   - The Send to a friend sheet now draws dark.
 *   - parseClaimedEntries reads the optional sharedWithAnotherAccount flag.
 *
 * The translation double reads the real en purchases.json, so a missing key
 * shows up as the raw key and fails the copy assertions.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 */
import React from "react";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");
const { act } = TestRenderer;

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

jest.mock("react-i18next", () => {
  const purchases = jest.requireActual("../../../i18n/locales/en/purchases.json");
  const lookup = (key: string): unknown =>
    key.split(".").reduce<unknown>(
      (node, part) =>
        node && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined,
      purchases,
    );
  const t = (key: string, options: Record<string, unknown> = {}): string => {
    const plural = typeof options.count === "number"
      ? lookup(`${key}_${options.count === 1 ? "one" : "other"}`)
      : undefined;
    const value = plural ?? lookup(key);
    if (typeof value !== "string") return key;
    return value.replace(/{{\s*(\w+)\s*}}/g, (match, name) =>
      name in options ? String(options[name]) : match
    );
  };
  return {
    initReactI18next: { type: "3rdParty", init: () => undefined },
    useTranslation: () => ({ t, i18n: { language: "en" } }),
  };
});

const mockSheetProps: Array<Record<string, unknown>> = [];
jest.mock("../../ui/BaseBottomSheet", () => {
  const ReactActual = jest.requireActual("react");
  const h = ReactActual.createElement;
  function BaseBottomSheet(props: Record<string, unknown>) {
    mockSheetProps.push(props);
    if (props.visible !== true) return null;
    return h("SheetHost", { testID: "sheet-host" }, props.children);
  }
  const BottomSheetTextInput = ReactActual.forwardRef(
    (props: Record<string, unknown>, _ref: unknown) =>
      h("BottomSheetTextInput", props),
  );
  return { BaseBottomSheet, BottomSheetTextInput, BottomSheetScrollView: "ScrollView" };
});
jest.mock("../../onboarding/OTPInput", () => {
  const ReactActual = jest.requireActual("react");
  return {
    OTPInput: (props: Record<string, unknown>) =>
      ReactActual.createElement("OTPInput", { ...props, testID: "otp" }),
  };
});
jest.mock("../../onboarding/PhoneInput", () => {
  const ReactActual = jest.requireActual("react");
  return {
    PhoneInput: (props: Record<string, unknown>) =>
      ReactActual.createElement("PhoneInput", props),
  };
});
// The package index also loads its keyboard-controlled picker, which needs a
// native runtime; the country directory itself is plain data.
jest.mock("../../../constants/countries", () => {
  const directory = jest.requireActual("@mingla/phone-input/countries");
  return { ...directory, getDefaultCountryCode: () => "US" };
});
jest.mock("../../../services/supabase", () => ({
  supabase: { rpc: jest.fn(), functions: { invoke: jest.fn() } },
  reactivateExplorerForVerifiedSession: jest.fn(),
}));
jest.mock("../../../lib/secureStoreSafe", () => ({
  secureGetItem: jest.fn(),
  secureSetItem: jest.fn(),
  secureDeleteItem: jest.fn(),
}));
jest.mock("../../../utils/explorerReactivation", () => ({
  withExplorerReactivationIntent: jest.fn(),
}));
const mockSend = jest.fn();
const mockVerify = jest.fn();
jest.mock("../../../services/claimContactService", () => {
  const actual = jest.requireActual("../../../services/claimContactService");
  return {
    ...actual,
    sendClaimContactCode: (...args: unknown[]) => mockSend(...args),
    verifyClaimContactCode: (...args: unknown[]) => mockVerify(...args),
  };
});
const mockSweep = jest.fn();
jest.mock("../../../services/claimSweep", () => ({
  runClaimSweep: (...args: unknown[]) => mockSweep(...args),
}));
const mockGetQueryState = jest.fn();
const mockInvalidate = jest.fn(() => Promise.resolve());
jest.mock("../../../config/queryClient", () => ({
  queryClient: {
    getQueryState: (...args: unknown[]) => mockGetQueryState(...args),
    invalidateQueries: (...args: unknown[]) => mockInvalidate(...args),
  },
}));
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockPush,
    back: jest.fn(),
    canGoBack: () => true,
    replace: jest.fn(),
  }),
}));
jest.mock("../../../store/appStore", () => ({
  useAppStore: (select: (state: unknown) => unknown) =>
    select({ user: { id: "user-1" } }),
}));
const mockIdentifiers: { current: Record<string, unknown> } = {
  current: { isLoading: false, isError: false, data: [] },
};
jest.mock("../../../hooks/useClaimIdentifiers", () => ({
  useClaimIdentifiers: () => mockIdentifiers.current,
}));
jest.mock("../../../services/postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));
jest.mock("../../../services/purchasesService", () => ({
  offerTicketToFriend: jest.fn(),
  TicketTransferError: class TicketTransferError extends Error {},
}));

const RN = require("react-native");
const { AddIdentitySheet } = require("../AddIdentitySheet");
const { SendTicketSheet } = require("../SendTicketSheet");
const MissingPurchaseRoute = require("../../../../app/purchases/missing").default;
const { ClaimContactError } = require("../../../services/claimContactService");
const { parseClaimedEntries } = require("../../../services/attendanceClaimService");
const {
  askMessageContacts,
  claimedEntryPath,
  lastCheckedCopy,
  resendClock,
} = require("../missingTicketModel");

type Renderer = import("react-test-renderer").ReactTestRenderer;
type Node = import("react-test-renderer").ReactTestInstance;

const IDENTIFIERS = [
  { kind: "email", value: "guest@example.com", source: "account", display: "guest@example.com" },
  { kind: "phone", value: "+19843822876", source: "added", display: "+1 •••• 2876" },
];

function entry(overrides: Record<string, unknown> = {}) {
  return {
    kind: "order",
    id: "o1",
    routeKind: "order",
    routeId: "order-1",
    offeringType: "event",
    noun: "ticket",
    title: "Live payment test",
    orderLabel: null,
    startsAt: "2026-12-15T19:00:00.000Z",
    timezone: "Europe/London",
    venueLine: "Lantern Room",
    quantity: 1,
    source: "purchase",
    sentByFirstName: null,
    chatJoined: true,
    conversationId: "c1",
    sharedWithAnotherAccount: false,
    ...overrides,
  };
}

function sweepResult(overrides: Record<string, unknown> = {}) {
  return {
    count: 0,
    eventIds: [],
    claims: [],
    claimed: [],
    more: false,
    rateLimited: false,
    throttled: false,
    reason: "add_identity",
    ...overrides,
  };
}

const mounted: Renderer[] = [];

function render(element: React.ReactElement): Renderer {
  let renderer: Renderer | null = null;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  mounted.push(renderer as unknown as Renderer);
  return renderer as unknown as Renderer;
}

function byId(renderer: Renderer, id: string): Node {
  const found = renderer.root.findAll(
    (node) => node.props?.testID === id && typeof node.type !== "string",
  );
  const node = found[0] ??
    renderer.root.findAll((candidate) => candidate.props?.testID === id)[0];
  if (!node) throw new Error(`no node with testID ${id}`);
  return node;
}

function maybeId(renderer: Renderer, id: string): Node | undefined {
  return renderer.root.findAll((node) => node.props?.testID === id)[0];
}

function text(renderer: Renderer): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || node === undefined) return;
    if (typeof node === "string") {
      parts.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    walk((node as { children?: unknown }).children);
  };
  walk(renderer.toJSON());
  return parts.join(" ");
}

async function press(node: Node): Promise<void> {
  await act(async () => {
    await node.props.onPress();
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function sheet(props: Record<string, unknown> = {}): Renderer {
  return render(
    React.createElement(AddIdentitySheet, {
      visible: true,
      userId: "user-1",
      identifiers: IDENTIFIERS,
      onClose: jest.fn(),
      ...props,
    }),
  );
}

async function typeEmailAndSend(renderer: Renderer, value: string): Promise<void> {
  await press(byId(renderer, "add-identity-tab-email"));
  await act(async () => {
    byId(renderer, "add-identity-email").props.onChangeText(value);
  });
  await press(byId(renderer, "add-identity-send"));
}

beforeEach(() => {
  mockSheetProps.length = 0;
  mockSend.mockReset();
  mockVerify.mockReset();
  mockSweep.mockReset();
  mockPush.mockReset();
  mockInvalidate.mockClear();
  mockGetQueryState.mockReset();
  mockIdentifiers.current = { isLoading: false, isError: false, data: IDENTIFIERS };
  jest.spyOn(RN.AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
  jest.spyOn(RN.AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
});

afterEach(() => {
  for (const renderer of mounted.splice(0)) {
    act(() => {
      renderer.unmount();
    });
  }
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("#4473 add sheet", () => {
  test("opens dark, on the Mobile tab, with tab roles and the selected state", () => {
    const renderer = sheet();
    const props = mockSheetProps.at(-1)!;
    expect(props.theme).toBe("dark");
    expect((props.backgroundStyle as Record<string, unknown>).backgroundColor).toBe("#15181e");
    expect(props.keyboardBehavior).toBe("interactive");
    const tablist = renderer.root.findAll((node) => node.props?.accessibilityRole === "tablist")[0];
    expect(tablist).toBeTruthy();
    expect(byId(renderer, "add-identity-tab-phone").props.accessibilityRole).toBe("tab");
    expect(byId(renderer, "add-identity-tab-phone").props.accessibilityState.selected).toBe(true);
    expect(byId(renderer, "add-identity-tab-email").props.accessibilityState.selected).toBe(false);
    expect(maybeId(renderer, "add-identity-phone")).toBeTruthy();
    expect(text(renderer)).toContain("Formats as you type. We'll text the code.");
  });

  test("Send code stays disabled until the email is shaped, then sends it normalized", async () => {
    mockSend.mockResolvedValue({ challengeId: "ch1", sentTo: "g•••@example.com", alreadyConfirmed: false });
    const renderer = sheet();
    await press(byId(renderer, "add-identity-tab-email"));
    expect(byId(renderer, "add-identity-email").props.keyboardType).toBe("email-address");
    await act(async () => {
      byId(renderer, "add-identity-email").props.onChangeText("guest@exa");
    });
    expect(byId(renderer, "add-identity-send").props.disabled).toBe(true);
    await act(async () => {
      byId(renderer, "add-identity-email").props.onChangeText("  Guest@Example.com ");
    });
    expect(byId(renderer, "add-identity-send").props.disabled).toBe(false);
    await press(byId(renderer, "add-identity-send"));
    expect(mockSend).toHaveBeenCalledWith({ channel: "email", value: "guest@example.com" });
    expect(text(renderer)).toContain("Enter the code");
    expect(text(renderer)).toContain("Sent to g•••@example.com");
    expect(text(renderer)).toContain("Resend in 0:30");
    expect(byId(renderer, "add-identity-resend").props.disabled).toBe(true);
    expect(byId(renderer, "otp").props.tone).toBe("dark");
  });

  test("six digits verify on their own, then Found cards open the purchase", async () => {
    mockSend.mockResolvedValue({ challengeId: "ch1", sentTo: "guest@example.com", alreadyConfirmed: false });
    mockVerify.mockResolvedValue({
      foundCount: 2,
      claimed: [entry(), entry({ id: "o2", routeKind: "rsvp", routeId: "rsvp-9", title: "Detty December", chatJoined: true })],
    });
    mockSweep.mockResolvedValue(sweepResult());
    const onClose = jest.fn();
    const onChecked = jest.fn();
    const renderer = sheet({ onClose, onChecked });
    await typeEmailAndSend(renderer, "guest@example.com");
    await act(async () => {
      byId(renderer, "otp").props.onComplete("123456");
    });
    await flush();
    expect(mockVerify).toHaveBeenCalledWith({ challengeId: "ch1", code: "123456" });
    expect(mockSweep).toHaveBeenCalledWith("user-1", "add_identity");
    expect(onChecked).toHaveBeenCalledTimes(1);
    expect(text(renderer)).toContain("Found 2 tickets");
    expect(text(renderer)).toContain("They're in Purchases now, and you're in each event's group chat.");
    expect(text(renderer)).toContain("Live payment test");
    expect(text(renderer)).toContain("Lantern Room");
    expect(maybeId(renderer, "add-identity-shared-note")).toBeUndefined();
    expect(byId(renderer, "add-identity-open-o1").props.accessibilityLabel).toBe("Open Live payment test");
    await press(byId(renderer, "add-identity-open-o2"));
    expect(onClose).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith("/purchases/rsvp/rsvp-9");
  });

  test("the shared note shows only when an entry is also on another account", async () => {
    mockSend.mockResolvedValue({ challengeId: "ch1", sentTo: "guest@example.com", alreadyConfirmed: false });
    mockVerify.mockResolvedValue({
      foundCount: 1,
      claimed: [entry({ sharedWithAnotherAccount: true, chatJoined: false })],
    });
    mockSweep.mockResolvedValue(sweepResult());
    const renderer = sheet();
    await typeEmailAndSend(renderer, "guest@example.com");
    await act(async () => {
      byId(renderer, "otp").props.onComplete("654321");
    });
    await flush();
    expect(text(renderer)).toContain("Found 1 ticket");
    expect(text(renderer)).toContain("It's in Purchases now.");
    expect(text(renderer)).toContain(
      "guest@example.com is also confirmed on another Mingla account, so this ticket shows on both.",
    );
  });

  test("a wrong code stays on the code step with an alert, digits editable", async () => {
    mockSend.mockResolvedValue({ challengeId: "ch1", sentTo: "guest@example.com", alreadyConfirmed: false });
    mockVerify.mockRejectedValue(new ClaimContactError("bad_code"));
    const renderer = sheet();
    await typeEmailAndSend(renderer, "guest@example.com");
    await act(async () => {
      byId(renderer, "otp").props.onComplete("000000");
    });
    await flush();
    const alert = byId(renderer, "add-identity-error");
    expect(alert.props.accessibilityRole).toBe("alert");
    expect(text(renderer)).toContain("That code didn't work. Check the latest message and try again.");
    expect(byId(renderer, "otp").props.error).toBe(true);
    expect(byId(renderer, "otp").props.disabled).toBe(false);
    expect(mockSweep).not.toHaveBeenCalled();
  });

  test.each([
    ["invalid_value", "Enter an email address or a mobile number with its country code."],
    ["rate_limited", "Too many attempts. Try again in a few minutes."],
    ["locked", "Too many attempts. Try again in a few minutes."],
    ["limit_reached", "You've added the most emails and numbers this account can hold."],
    ["already_other_account", "That email or number is already confirmed on another Mingla account."],
    ["unavailable", "Check your connection and try again."],
  ])("a %s refusal on send keeps its copy", async (code, copy) => {
    mockSend.mockRejectedValue(new ClaimContactError(code));
    const renderer = sheet();
    await typeEmailAndSend(renderer, "guest@example.com");
    expect(text(renderer)).toContain(copy);
    expect(maybeId(renderer, "otp")).toBeUndefined();
  });

  test("expired and locked codes keep their copy on the code step", async () => {
    mockSend.mockResolvedValue({ challengeId: "ch1", sentTo: "guest@example.com", alreadyConfirmed: false });
    mockVerify.mockRejectedValueOnce(new ClaimContactError("expired"));
    const renderer = sheet();
    await typeEmailAndSend(renderer, "guest@example.com");
    await act(async () => {
      byId(renderer, "otp").props.onComplete("111111");
    });
    await flush();
    expect(text(renderer)).toContain("That code didn't work.");
    mockVerify.mockRejectedValueOnce(new ClaimContactError("locked"));
    await act(async () => {
      byId(renderer, "otp").props.onChange("");
    });
    await act(async () => {
      byId(renderer, "otp").props.onComplete("222222");
    });
    await flush();
    expect(text(renderer)).toContain("Too many attempts. Try again in a few minutes.");
  });

  test("the resend countdown runs down to Send a new code", async () => {
    jest.useFakeTimers();
    mockSend.mockResolvedValue({ challengeId: "ch1", sentTo: "guest@example.com", alreadyConfirmed: false });
    const renderer = sheet();
    await typeEmailAndSend(renderer, "guest@example.com");
    for (let second = 0; second < 30; second += 1) {
      act(() => {
        jest.advanceTimersByTime(1_000);
      });
    }
    expect(text(renderer)).toContain("Send a new code");
    expect(byId(renderer, "add-identity-resend").props.disabled).toBe(false);
    await press(byId(renderer, "add-identity-resend"));
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  test("Paste fills the code and verifies it", async () => {
    jest.spyOn(RN.Clipboard, "getString").mockResolvedValue("Your code: 482 913");
    mockSend.mockResolvedValue({ challengeId: "ch1", sentTo: "guest@example.com", alreadyConfirmed: false });
    mockVerify.mockResolvedValue({ foundCount: 0, claimed: [] });
    mockSweep.mockResolvedValue(sweepResult());
    const renderer = sheet();
    await typeEmailAndSend(renderer, "guest@example.com");
    await press(byId(renderer, "add-identity-paste"));
    await flush();
    expect(mockVerify).toHaveBeenCalledWith({ challengeId: "ch1", code: "482913" });
  });

  test("nothing found keeps the contact and offers the other ways", async () => {
    mockSend.mockResolvedValue({ challengeId: "ch1", sentTo: "guest@example.com", alreadyConfirmed: false });
    mockVerify.mockResolvedValue({ foundCount: 0, claimed: [] });
    mockSweep.mockResolvedValue(sweepResult());
    const renderer = sheet();
    await typeEmailAndSend(renderer, "guest@example.com");
    await act(async () => {
      byId(renderer, "otp").props.onComplete("123456");
    });
    await flush();
    expect(text(renderer)).toContain("No tickets on guest@example.com yet");
    await press(byId(renderer, "add-identity-none-link"));
    expect(maybeId(renderer, "missing-link-step")).toBeTruthy();
  });

  test("Try another goes back to an empty add step", async () => {
    mockSend.mockResolvedValue({ challengeId: null, sentTo: null, alreadyConfirmed: true });
    mockSweep.mockResolvedValue(sweepResult());
    const renderer = sheet();
    await typeEmailAndSend(renderer, "guest@example.com");
    await flush();
    // Already confirmed on this account: no code, straight to the check.
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockSweep).toHaveBeenCalledWith("user-1", "add_identity");
    expect(text(renderer)).toContain("No tickets on guest@example.com yet");
    await press(byId(renderer, "add-identity-none-retry"));
    expect(byId(renderer, "add-identity-email").props.value).toBe("");
  });

  test("an already-confirmed contact with purchases goes straight to Found", async () => {
    mockSend.mockResolvedValue({ challengeId: null, sentTo: null, alreadyConfirmed: true });
    mockSweep.mockResolvedValue(sweepResult({ count: 1, claimed: [entry()] }));
    const renderer = sheet();
    await typeEmailAndSend(renderer, "guest@example.com");
    await flush();
    expect(text(renderer)).toContain("Found 1 ticket");
  });

  test("while checking, the sheet cannot be dragged or tapped closed", async () => {
    mockSend.mockResolvedValue({ challengeId: "ch1", sentTo: "guest@example.com", alreadyConfirmed: false });
    mockVerify.mockResolvedValue({ foundCount: 0, claimed: [] });
    let finish: (value: unknown) => void = () => undefined;
    mockSweep.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const renderer = sheet();
    await typeEmailAndSend(renderer, "guest@example.com");
    await act(async () => {
      byId(renderer, "otp").props.onComplete("123456");
    });
    await flush();
    expect(maybeId(renderer, "add-identity-checking")).toBeTruthy();
    expect(text(renderer)).toContain("Confirmed. Looking for tickets");
    const props = mockSheetProps.at(-1)!;
    expect(props.enablePanDownToClose).toBe(false);
    expect(props.backdropPressBehavior).toBe("none");
    expect(maybeId(renderer, "add-identity-close")).toBeUndefined();
    await act(async () => {
      finish(sweepResult());
    });
    await flush();
    expect(mockSheetProps.at(-1)!.enablePanDownToClose).toBe(true);
  });
});

describe("#4473 ask them to send it", () => {
  test("the shared message carries this account's confirmed email and mobile", async () => {
    const share = jest.spyOn(RN.Share, "share").mockResolvedValue({ action: "sharedAction" });
    const renderer = sheet({ initialStep: "ask" });
    const message = byId(renderer, "missing-ask-message").props.children as string;
    expect(message).toBe(
      "Hey, can you send me my ticket on Mingla? Open it in the Mingla app, tap Send to a friend, and use guest@example.com and +1 (984) 382-2876. Thanks!",
    );
    expect(text(renderer)).toContain("Send to a friend");
    await press(byId(renderer, "missing-ask-share"));
    expect(share).toHaveBeenCalledWith({ message });
  });

  test("no confirmed contact: the message leaves that part out", () => {
    const renderer = sheet({ initialStep: "ask", identifiers: [] });
    expect(byId(renderer, "missing-ask-message").props.children).toBe(
      "Hey, can you send me my ticket on Mingla? Open it in the Mingla app and tap Send to a friend. Thanks!",
    );
  });
});

describe("#4473 use your confirmation link", () => {
  test("says the link still ends in a code, and Open Mail opens the mail app", async () => {
    const openURL = jest.spyOn(RN.Linking, "openURL").mockResolvedValue(true);
    const renderer = sheet({ initialStep: "link" });
    expect(text(renderer)).toContain("Get your tickets");
    expect(text(renderer)).toContain("then we send a quick code to the email or number it was bought with");
    await press(byId(renderer, "missing-link-open-mail"));
    await flush();
    expect(openURL).toHaveBeenCalled();
    expect(maybeId(renderer, "missing-link-mail-failed")).toBeUndefined();
  });

  test("when no mail app opens, it says so instead of failing silently", async () => {
    jest.spyOn(RN.Linking, "openURL").mockRejectedValue(new Error("no handler"));
    const renderer = sheet({ initialStep: "link" });
    await press(byId(renderer, "missing-link-open-mail"));
    await flush();
    expect(byId(renderer, "missing-link-mail-failed").props.accessibilityRole).toBe("alert");
  });
});

describe("#4473 Missing a ticket? screen", () => {
  test("Check again sweeps, spins, says Checked, then updates Last checked", async () => {
    jest.useFakeTimers();
    mockGetQueryState.mockReturnValue({ dataUpdatedAt: Date.now() - 2 * 60_000 });
    let finish: (value: unknown) => void = () => undefined;
    mockSweep.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const renderer = render(React.createElement(MissingPurchaseRoute));
    expect(byId(renderer, "missing-last-checked").props.children).toBe("Last checked 2 minutes ago");
    await act(async () => {
      byId(renderer, "missing-check-again").props.onPress();
    });
    expect(mockSweep).toHaveBeenCalledWith("user-1", "pull_to_refresh");
    expect(byId(renderer, "missing-check-again").props.accessibilityState.busy).toBe(true);
    await act(async () => {
      finish(sweepResult({ reason: "pull_to_refresh" }));
    });
    await flush();
    expect(text(renderer)).toContain("Checked");
    expect(byId(renderer, "missing-last-checked").props.children).toBe(
      "Last checked just now. Nothing new.",
    );
    act(() => {
      jest.advanceTimersByTime(3_000);
    });
    expect(text(renderer)).toContain("Check again");
  });

  test("a check that finds purchases says so", async () => {
    mockGetQueryState.mockReturnValue(undefined);
    mockSweep.mockResolvedValue(sweepResult({ count: 2, reason: "pull_to_refresh" }));
    const renderer = render(React.createElement(MissingPurchaseRoute));
    expect(byId(renderer, "missing-last-checked").props.children).toBe("Not checked yet");
    await press(byId(renderer, "missing-check-again"));
    await flush();
    expect(text(renderer)).toContain("2 purchases found. They're now in Purchases.");
  });

  test("the three ways open the sheet on their own step", async () => {
    const renderer = render(React.createElement(MissingPurchaseRoute));
    expect(text(renderer)).toContain("Bought it another way?");
    await press(byId(renderer, "missing-option-link"));
    expect(maybeId(renderer, "missing-link-step")).toBeTruthy();
    await press(byId(renderer, "add-identity-close"));
    await press(byId(renderer, "missing-option-ask"));
    expect(maybeId(renderer, "missing-ask-step")).toBeTruthy();
    await press(byId(renderer, "add-identity-close"));
    await press(byId(renderer, "missing-option-add"));
    expect(maybeId(renderer, "add-identity-send")).toBeTruthy();
  });

  test("loading, empty and offline states of the confirmed card", async () => {
    mockIdentifiers.current = { isLoading: true, isError: false, data: undefined };
    const loading = render(React.createElement(MissingPurchaseRoute));
    expect(maybeId(loading, "missing-identifiers-loading")).toBeTruthy();
    mockIdentifiers.current = { isLoading: false, isError: false, data: [] };
    const empty = render(React.createElement(MissingPurchaseRoute));
    expect(text(empty)).toContain("Nothing confirmed yet.");
    const refetch = jest.fn();
    mockIdentifiers.current = { isLoading: false, isError: true, data: undefined, refetch };
    const offline = render(React.createElement(MissingPurchaseRoute));
    expect(text(offline)).toContain("Check your connection and try again.");
    await press(byId(offline, "missing-identifiers-retry"));
    expect(refetch).toHaveBeenCalled();
  });
});

describe("#4473 Send to a friend sheet", () => {
  test("draws on the dark purchase sheet", () => {
    render(
      React.createElement(SendTicketSheet, {
        ticket: { id: "t1", ticketIndex: 2 },
        total: 3,
        visible: true,
        onClose: jest.fn(),
        onSent: jest.fn(),
      }),
    );
    const props = mockSheetProps.at(-1)!;
    expect(props.theme).toBe("dark");
    expect((props.backgroundStyle as Record<string, unknown>).backgroundColor).toBe("#15181e");
  });
});

describe("#4473 model", () => {
  test("parseClaimedEntries reads sharedWithAnotherAccount, false when absent", () => {
    const [absent, shared, junk] = parseClaimedEntries([
      { ...entry(), sharedWithAnotherAccount: undefined },
      { ...entry({ id: "o2" }), sharedWithAnotherAccount: true },
      { ...entry({ id: "o3" }), sharedWithAnotherAccount: "yes" },
    ]);
    expect(absent.sharedWithAnotherAccount).toBe(false);
    expect(shared.sharedWithAnotherAccount).toBe(true);
    expect(junk.sharedWithAnotherAccount).toBe(false);
  });

  test("found purchases open the same detail routes Purchases uses", () => {
    expect(claimedEntryPath(entry())).toBe("/purchases/order/order-1");
    expect(claimedEntryPath(entry({ routeKind: "held_ticket", routeId: "a b" }))).toBe("/purchases/order/a%20b");
    expect(claimedEntryPath(entry({ routeKind: "venue_order", routeId: "v1" }))).toBe("/purchases/venue_order/v1");
    // The buyer's own stay opens on its stay screen; a shared one in Purchases.
    expect(claimedEntryPath(entry({ routeKind: "stay", routeId: "s1" }))).toBe("/stay/s1");
    expect(claimedEntryPath(entry({ routeKind: "stay", routeId: "s1", role: "shared" })))
      .toBe("/purchases/stay/s1");
  });

  test("Last checked buckets and the resend clock", () => {
    const now = 1_000_000_000;
    expect(lastCheckedCopy(now - 30_000, now)).toEqual({ key: "justNow" });
    expect(lastCheckedCopy(now - 5 * 60_000, now)).toEqual({ key: "minutes", count: 5 });
    expect(lastCheckedCopy(now - 3 * 3_600_000, now)).toEqual({ key: "hours", count: 3 });
    expect(lastCheckedCopy(now - 49 * 3_600_000, now)).toEqual({ key: "days", count: 2 });
    expect(resendClock(24)).toBe("0:24");
    expect(resendClock(75)).toBe("1:15");
  });

  test("the ask message only ever uses confirmed contacts", () => {
    expect(askMessageContacts(undefined)).toEqual([]);
    expect(askMessageContacts([IDENTIFIERS[1]])).toEqual(["+1 (984) 382-2876"]);
  });
});
