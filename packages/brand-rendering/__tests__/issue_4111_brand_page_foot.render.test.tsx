/**
 * #4111 — IMPLEMENTOR render proof for the brand page foot (D1 / D10): the REAL
 * shared `PublicBrandPage` mounted with the REAL `BrandPageFoot`.
 *
 *   F-1  About no longer prints the brand's email or phone (D10), even when the
 *        brand has both.
 *   F-2  signed-out web: "Stay in the loop" box (Email, Mobile, "Also text me",
 *        Subscribe, consent) then the "Questions?" card with "Message {Brand}".
 *   F-3  signed-in: no box; only the Message card.
 *   F-4  "Usually replies within …" only when the server returned a reply time.
 *   F-5  the foot renders under EVERY tab, not only About.
 *   F-6  desktop side panel: Message sits in the Share row only when the brand
 *        takes enquiries (callbacks.onMessage).
 *   F-7  Subscribe sends the email; the sent state reads "Check your email"
 *        with "Use a different email".
 *
 * Mock boundary (declared): lucide icons and the offering-rendering barrel's RN
 * shell/cover components are stubbed as the #3426 suite does; react-native-web's
 * TextInput (which needs a DOM `document` this node-env harness does not have)
 * is replaced by a host element that keeps its props and a focus() handle. The
 * page, the foot and their copy are real.
 *
 * FAILS-ON-REVERT: re-adding the About contact rows fails F-1; dropping the foot
 * slot from PublicBrandPage fails F-2/F-3/F-5.
 *
 * Run: cd mingla-business && npx jest --config jest.issue679.cfg.cjs --maxWorkers=2 \
 *        --testPathPattern issue_4111_brand_page_foot
 */

let mockIsDesktop = false;
const mockFocus = jest.fn();

jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  const React = require("react");
  const TextInput = React.forwardRef(
    (props: Record<string, unknown>, ref: unknown) => {
      React.useImperativeHandle(ref, () => ({ focus: mockFocus }));
      return React.createElement("mock-text-input", props);
    },
  );
  return { ...actual, TextInput };
});

jest.mock("lucide-react-native", () => {
  const React = require("react");
  const icon = (name: string) => (props: Record<string, unknown>) =>
    React.createElement("mock-icon", { ...props, name });
  return new Proxy(
    {},
    {
      get: (_target, key: string) => (key === "__esModule" ? true : icon(key)),
    },
  );
});
jest.mock("@mingla/offering-rendering", () => {
  const React = require("react");
  const { View } = require("react-native");
  const lifecycle = jest.requireActual(
    "../../offering-rendering/eventAcquisitionLifecycle",
  );
  const theme = {
    color: "#f60",
    foregroundColor: "#fff",
    font: "inter",
    fontFamilyValue: "Inter",
    animation: "none",
  };
  const palette = {
    page: "#fff",
    card: "#fff",
    panel: "#fff",
    panelStrong: "#fff",
    panelBorder: "#ddd",
    accent: "#f60",
    accentWash: "#fee",
    accentText: "#fff",
    primaryText: "#111",
    secondaryText: "#333",
    tertiaryText: "#666",
  };
  return {
    ...lifecycle,
    MINGLA_DEFAULT_THEME: theme,
    resolveTheme: () => theme,
    createThemePalette: () => palette,
    offeringSurfaceStyles: () => ({
      card: {},
      cardStrong: {},
      primaryText: {},
      secondaryText: {},
    }),
    useResponsiveLayout: () => ({ isDesktop: mockIsDesktop }),
    EventCoverMedia: () => React.createElement(View),
    FollowerCountLine: () => null,
    ParallaxCoverShell: ({
      children,
      stickyPanel,
    }: {
      children: React.ReactNode;
      stickyPanel?: React.ReactNode;
    }) => React.createElement(View, null, children, stickyPanel ?? null),
  };
});

import React from "react";
import type { ThemePalette, ResolvedTheme } from "@mingla/offering-rendering";
import type { PublicBrandPageProps, PublicBrandUpcoming } from "../types";
import { PublicBrandPage } from "../PublicBrandPage";
import {
  BrandPageFoot,
  type BrandPageFootLoop,
  type StayInLoopRequest,
} from "../enquiry/BrandPageFoot";

type Node = {
  type: unknown;
  props: Record<string, unknown>;
  children?: Array<Node | string>;
};
type Renderer = {
  root: { findAll: (fn: (node: Node) => boolean) => Node[] };
  toJSON: () => unknown;
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

jest.setTimeout(120000);

const PALETTE = {
  page: "#fff",
  card: "#fff",
  panel: "#fff",
  panelStrong: "#fff",
  panelBorder: "#ddd",
  cutoutBorder: "#ddd",
  glass: "#fff",
  glassTint: "light",
  accent: "#f60",
  accentWash: "#fee",
  accentText: "#fff",
  primaryText: "#111",
  secondaryText: "#333",
  tertiaryText: "#666",
} as ThemePalette;
const THEME = {
  color: "#f60",
  foregroundColor: "#fff",
  font: "inter",
  fontFamilyValue: "Inter",
  animation: "none",
} as ResolvedTheme;

const SECRET_EMAIL = "bookings@lanternroom.example";
const SECRET_PHONE = "+1 201 555 0147";

const upcoming: PublicBrandUpcoming = {
  offeringId: "e1",
  brandId: "brand-1",
  brandSlug: "lantern-room",
  brandName: "Lantern Room",
  offeringType: "event",
  offeringSlug: "vinyl-night",
  name: "Vinyl Night",
  bio: null,
  coverMediaUrl: null,
  coverMediaType: null,
  theme: null,
  startsAt: "2030-11-08T20:00:00Z",
  endsAt: null,
  priceFromMinorUnits: 2500,
  currency: "GBP",
  isFree: false,
  publishedAt: "2026-08-01T00:00:00Z",
};

const idleLoop = (onSubmit: (r: StayInLoopRequest) => void = () => undefined): BrandPageFootLoop => ({
  state: "idle",
  sentTo: null,
  sentSms: false,
  errorMessage: null,
  onSubmit,
  onReset: () => undefined,
});

const pageProps = (
  foot: React.ReactNode,
  callbacks: Partial<PublicBrandPageProps["callbacks"]> = {},
  overrides: Partial<PublicBrandPageProps> = {},
): PublicBrandPageProps => ({
  brand: {
    id: "brand-1",
    slug: "lantern-room",
    displayName: "Lantern Room",
    address: null,
    coverHue: 25,
    bio: "A 200-seat listening room and kitchen.",
    contact: { email: SECRET_EMAIL, phone: SECRET_PHONE },
  },
  events: [],
  trips: [],
  foot,
  ...overrides,
  callbacks: {
    onClose: () => undefined,
    onShare: () => undefined,
    onOpenEvent: () => undefined,
    onOpenTrip: () => undefined,
    ...callbacks,
  },
});

const mount = async (element: React.ReactElement): Promise<Renderer> => {
  let tree!: Renderer;
  try {
    await act(async () => {
      tree = TestRenderer.create(element);
    });
  } catch (e) {
    const errs = (e as { errors?: unknown[] }).errors ?? [e];
    throw new Error(errs.map((x) => String((x as Error).stack ?? x)).join("\n----\n"));
  }
  return tree;
};

const textOf = (node: Node | string): string =>
  typeof node === "string" ? node : (node.children ?? []).map((child) => textOf(child)).join("");

const allText = (tree: Renderer): string =>
  tree.root
    .findAll((node) => typeof node.type === "string" || node.type === "Text")
    .map((node) => textOf(node))
    .join("\n");

const byTestID = (tree: Renderer, id: string): Node[] =>
  tree.root.findAll((node) => node.props.testID === id);

const foot = (props: Partial<React.ComponentProps<typeof BrandPageFoot>> = {}): React.ReactElement => (
  <BrandPageFoot brandName="Lantern Room" palette={PALETTE} theme={THEME} {...props} />
);

afterEach(() => {
  mockIsDesktop = false;
});

describe("#4111 brand page foot", () => {
  test("F-1 About prints no brand email or phone (D10)", async () => {
    const tree = await mount(<PublicBrandPage {...pageProps(null)} />);
    const text = allText(tree);
    expect(text).toContain("A 200-seat listening room and kitchen.");
    expect(text).not.toContain(SECRET_EMAIL);
    expect(text).not.toContain(SECRET_PHONE);
    expect(
      tree.root.findAll(
        (node) =>
          typeof node.props.accessibilityLabel === "string" &&
          /^(Email|Call) /.test(node.props.accessibilityLabel as string),
      ),
    ).toHaveLength(0);
    tree.unmount();
  });

  test("F-2 signed-out web shows Stay in the loop, then the Message card", async () => {
    const onMessage = jest.fn();
    const tree = await mount(
      <PublicBrandPage
        {...pageProps(foot({ loop: idleLoop(), message: { onPress: onMessage, replyMinutes: null } }))}
      />,
    );
    expect(byTestID(tree, "issue-4111-brand-page-foot-slot").length).toBeGreaterThan(0);
    const text = allText(tree);
    expect(text).toContain("Stay in the loop");
    expect(text).toContain("New dates and offers from Lantern Room.");
    expect(text).toContain("Subscribe");
    expect(text).toContain(
      "By subscribing you agree to get marketing from Lantern Room via Mingla. Unsubscribe any time.",
    );
    expect(text).toContain("Questions?");
    expect(text).toContain("Message Lantern Room");
    // Box comes before the Message card.
    expect(text.indexOf("Stay in the loop")).toBeLessThan(text.indexOf("Questions?"));
    expect(text).not.toContain("Usually replies");
    const button = byTestID(tree, "brand-page-foot-message-button").find(
      (node) => typeof node.props.onPress === "function",
    );
    await act(async () => {
      (button?.props.onPress as () => void)();
    });
    expect(onMessage).toHaveBeenCalledTimes(1);
    tree.unmount();
  });

  test("F-3 signed in shows no box, only the Message card", async () => {
    const tree = await mount(
      <PublicBrandPage {...pageProps(foot({ message: { onPress: () => undefined, replyMinutes: null } }))} />,
    );
    const text = allText(tree);
    expect(text).not.toContain("Stay in the loop");
    expect(byTestID(tree, "brand-page-foot-loop")).toHaveLength(0);
    expect(text).toContain("Message Lantern Room");
    tree.unmount();
  });

  test("F-4 the reply-time line shows only with a server value; no card when enquiries are off", async () => {
    const withTime = await mount(foot({ message: { onPress: () => undefined, replyMinutes: 300 } }));
    expect(allText(withTime)).toContain("Usually replies within 5 hours");
    withTime.unmount();
    const off = await mount(foot({}));
    expect(off.toJSON()).toBeNull();
    off.unmount();
  });

  test("F-5 the foot renders under every tab", async () => {
    const tree = await mount(
      <PublicBrandPage
        {...pageProps(foot({ message: { onPress: () => undefined, replyMinutes: null } }), {}, { upcoming: [upcoming] })}
      />,
    );
    const upcomingTab = tree.root.findAll(
      (node) =>
        typeof node.props.accessibilityLabel === "string" &&
        (node.props.accessibilityLabel as string).startsWith("Upcoming") &&
        typeof node.props.onPress === "function",
    )[0];
    expect(upcomingTab).toBeDefined();
    await act(async () => {
      (upcomingTab?.props.onPress as () => void)();
    });
    expect(allText(tree)).toContain("Vinyl Night");
    expect(allText(tree)).toContain("Message Lantern Room");
    tree.unmount();
  });

  test("F-6 desktop: Message joins the Share row only when the brand takes enquiries", async () => {
    mockIsDesktop = true;
    const onMessage = jest.fn();
    const withMessage = await mount(<PublicBrandPage {...pageProps(null, { onMessage })} />);
    const desk = byTestID(withMessage, "issue-4111-desk-message").find(
      (node) => typeof node.props.onPress === "function",
    );
    expect(desk?.props.accessibilityLabel).toBe("Message Lantern Room");
    await act(async () => {
      (desk?.props.onPress as () => void)();
    });
    expect(onMessage).toHaveBeenCalledTimes(1);
    withMessage.unmount();
    const without = await mount(<PublicBrandPage {...pageProps(null)} />);
    expect(byTestID(without, "issue-4111-desk-message")).toHaveLength(0);
    expect(
      without.root.findAll((node) => node.props.accessibilityLabel === "Share this brand").length,
    ).toBeGreaterThan(0);
    without.unmount();
  });

  test("F-7 Subscribe sends the email; sent state offers Use a different email", async () => {
    const onSubmit = jest.fn();
    const tree = await mount(foot({ loop: idleLoop(onSubmit) }));
    const email = byTestID(tree, "brand-page-foot-loop-email").find(
      (node) => typeof node.props.onChangeText === "function",
    );
    await act(async () => {
      (email?.props.onChangeText as (v: string) => void)("ada@example.com");
    });
    const submit = byTestID(tree, "brand-page-foot-loop-submit").find(
      (node) => typeof node.props.onPress === "function",
    );
    await act(async () => {
      (submit?.props.onPress as () => void)();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ email: "ada@example.com", wantsSms: false, hp: "" });
    tree.unmount();

    const sent = await mount(
      foot({ loop: { ...idleLoop(), state: "sent", sentTo: "ada@example.com" } }),
    );
    const text = allText(sent);
    expect(text).toContain("Check your email");
    expect(text).toContain("We sent a link to ada@example.com.");
    expect(text).toContain("Use a different email");
    sent.unmount();
  });
});
