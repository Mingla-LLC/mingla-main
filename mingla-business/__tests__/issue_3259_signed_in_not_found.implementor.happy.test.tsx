/**
 * #3259 [a wrong account reads as a crash] — implementor happy-path suite.
 *
 * THE BUG. Seth was signed into Mingla Host on the web as one account, was
 * returned from Stripe onboarding to `host.usemingla.com/lanternroom`, and got
 * `app/+not-found.tsx`: "Hmm, that's not a real page." / "Maybe a typo? Or it
 * moved?". His words: it "should have notified me about a lack of permission or
 * signed into a wrong account not a crash".
 *
 * THE FINDING THAT REFRAMES IT. On web, `+not-found` is a SIGNED-IN-ONLY
 * screen: a signed-out visitor is intercepted upstream in `app/_layout.tsx` by
 * `shouldRedirectToSignInFromRoute` and redirected to `/`. So the generic 404
 * greeted the one population whose identity it could have named, and sent them
 * hunting for a typo instead. Being signed in made the product LESS helpful.
 *
 * WHAT IS ASSERTED — and what is deliberately NOT.
 * `+not-found` is a pure routing outcome: no props, no error, no status. It can
 * never be an authorisation failure, so these tests pin that the signed-in copy
 * still says the page does not exist. They do NOT assert any 403/404
 * discrimination, because the client cannot make one.
 *
 * HOW IT MEASURES. `testEnvironment: "node"` with `^react-native$` mapped to a
 * manual mock, so this walks the REAL element tree the screen returns (the
 * style of the sibling `issue_2180_not_found_structure` suite) rather than
 * rendering. `expand()` additionally INVOKES pure props-only function
 * components it meets, so `SignedInNotFoundNotice`'s own output is real tree,
 * not a source-text pin — these fail on a true deletion of the fix.
 */

import React from "react";

// The auth state this suite drives the screen through. `mock`-prefixed so
// jest's hoisted factory below is allowed to close over it.
const mockAuthState: {
  user: { email?: string | null } | null;
  isAuthReady: boolean;
  signOut: () => Promise<void>;
} = {
  user: null,
  isAuthReady: true,
  signOut: async () => undefined,
};

const mockRouterReplace = jest.fn();

jest.mock("../src/context/AuthContext", () => ({
  useAuth: () => mockAuthState,
}));

jest.mock("expo-router", () => ({
  Stack: { Screen: "Stack.Screen" },
  useRouter: () => ({
    replace: mockRouterReplace,
    push: jest.fn(),
    back: jest.fn(),
  }),
}));

jest.mock("@mingla/brand-assets", () => ({
  MINGLA_WORDMARK: 1,
  MINGLA_BUSINESS_LOGO: 2,
  MINGLA_APP_ICON: 3,
}));

jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));

jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));

// The Button primitive drags in reanimated / svg / haptics, all ESM and none of
// them needed: every prop asserted here (`accessibilityLabel`, `onPress`) is
// authored at the call site.
jest.mock("../src/components/ui/Button", () => ({ Button: "Button" }));

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: {
    Success: "success",
    Warning: "warning",
    Error: "error",
  },
}));

import NotFoundScreen, {
  SIGNED_IN_HEADING,
  SIGNED_OUT_HEADING,
  SIGNED_OUT_SUBTEXT,
} from "../app/+not-found";
import {
  SIGNED_IN_NOT_FOUND_COPY,
  SWITCH_ACCOUNT_LABEL,
} from "../src/components/auth/SignedInNotFoundNotice";

const SIGNED_IN_EMAIL = "business@usemingla.com";

type El = React.ReactElement<Record<string, unknown>>;

const isElement = (v: unknown): v is El =>
  typeof v === "object" && v !== null && "type" in (v as object);

/**
 * Walk the element tree, INVOKING any function component it meets so the
 * assertions see what the user sees rather than an unexpanded placeholder.
 *
 * Safe because every component reached this way is props-only and hook-free
 * (`SignedInNotFoundNotice` is deliberately so — see its header). The screen
 * itself is invoked by the caller, not here.
 */
function expand(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const child of node) expand(child, out);
    return out;
  }
  if (!isElement(node)) return out;
  out.push(node);
  if (typeof node.type === "function") {
    const rendered = (node.type as (p: unknown) => unknown)(node.props);
    expand(rendered, out);
  }
  expand((node.props as { children?: unknown }).children, out);
  return out;
}

/** Every string rendered anywhere in the expanded tree. */
function strings(nodes: El[]): string[] {
  const found: string[] = [];
  const collect = (v: unknown): void => {
    if (typeof v === "string") {
      found.push(v);
      return;
    }
    if (Array.isArray(v)) for (const item of v) collect(item);
  };
  for (const n of nodes) collect((n.props as { children?: unknown }).children);
  return found;
}

const textOf = (nodes: El[]): string => strings(nodes).join(" ");

const byLabel = (nodes: El[], label: string): El[] =>
  nodes.filter(
    (n) =>
      (n.props as { accessibilityLabel?: string }).accessibilityLabel === label,
  );

function renderTree(): El[] {
  return expand((NotFoundScreen as unknown as () => El)());
}

function signIn(email: string): void {
  mockAuthState.user = { email };
  mockAuthState.isAuthReady = true;
}

beforeEach(() => {
  mockRouterReplace.mockReset();
  mockAuthState.user = null;
  mockAuthState.isAuthReady = true;
  mockAuthState.signOut = async () => undefined;
});

describe("#3259 — signed in, the 404 names the account", () => {
  it("renders the signed-in email verbatim", () => {
    signIn(SIGNED_IN_EMAIL);
    // THE REPORTED DEFECT. The screen knew exactly who this was and said
    // nothing about it.
    expect(textOf(renderTree())).toContain(SIGNED_IN_EMAIL);
  });

  it("stops telling a signed-in user to go hunting for a typo", () => {
    signIn(SIGNED_IN_EMAIL);
    const copy = textOf(renderTree());
    expect(copy).not.toContain(SIGNED_OUT_SUBTEXT);
    expect(copy).not.toContain(SIGNED_OUT_HEADING);
  });

  it("still says the page does not exist — it never claims a permission denial", () => {
    signIn(SIGNED_IN_EMAIL);
    const copy = textOf(renderTree());
    // `+not-found` receives no status and no error, so it must not pretend to
    // know that access was denied.
    expect(copy).toContain(SIGNED_IN_HEADING);
    expect(copy.toLowerCase()).not.toContain("permission");
    expect(copy.toLowerCase()).not.toContain("access denied");
  });

  it("offers the switch-account escape AND keeps Go home", () => {
    signIn(SIGNED_IN_EMAIL);
    const nodes = renderTree();
    expect(byLabel(nodes, SWITCH_ACCOUNT_LABEL).length).toBeGreaterThanOrEqual(
      1,
    );
    // #2180's pinned exit is not traded away for the new one.
    expect(byLabel(nodes, "Go home").length).toBeGreaterThanOrEqual(1);
  });

  it("names both the possibility and the fix without asserting which", () => {
    signIn(SIGNED_IN_EMAIL);
    expect(textOf(renderTree())).toContain(SIGNED_IN_NOT_FOUND_COPY.missing);
  });
});

describe("#3259 — signed out sees exactly what it saw before", () => {
  it("keeps today's heading and subtext byte for byte", () => {
    const copy = textOf(renderTree());
    expect(copy).toContain(SIGNED_OUT_HEADING);
    expect(copy).toContain(SIGNED_OUT_SUBTEXT);
  });

  it("renders no identity block at all", () => {
    const nodes = renderTree();
    expect(textOf(nodes)).not.toContain("signed in as");
    expect(byLabel(nodes, SWITCH_ACCOUNT_LABEL)).toHaveLength(0);
    expect(
      nodes.some(
        (n) =>
          (n.props as { testID?: string }).testID ===
          "not-found-signed-in-notice",
      ) &&
        nodes.some((n) =>
          strings([n]).some((s) => s.includes("signed in as")),
        ),
    ).toBe(false);
  });

  it("renders no identity block for a signed-in user with no email on the record", () => {
    mockAuthState.user = { email: null };
    const nodes = renderTree();
    expect(byLabel(nodes, SWITCH_ACCOUNT_LABEL)).toHaveLength(0);
    expect(textOf(nodes)).toContain(SIGNED_OUT_SUBTEXT);
  });
});

describe("#3259 — a half-resolved session never flashes an identity", () => {
  it("shows no identity block while auth is still resolving", () => {
    // The user IS signed in; auth just has not said so yet. Reading the email
    // anyway would paint a block that vanishes a frame later.
    mockAuthState.user = { email: SIGNED_IN_EMAIL };
    mockAuthState.isAuthReady = false;
    const nodes = renderTree();
    expect(textOf(nodes)).not.toContain(SIGNED_IN_EMAIL);
    expect(byLabel(nodes, SWITCH_ACCOUNT_LABEL)).toHaveLength(0);
    expect(textOf(nodes)).toContain(SIGNED_OUT_HEADING);
  });
});

describe("#3259 — the sign-out COMPLETES before the navigation", () => {
  it("does not navigate to /auth until signOut has resolved", async () => {
    // WHY THIS ORDERING IS THE FIX AND NOT A DETAIL: `/auth` resumes whenever
    // `!loading && user`, so navigating there while still signed in bounces
    // straight back and re-fails as the SAME account — the infinite loop
    // `app/accept-brand-invitation.tsx` documents. Asserting only "both were
    // called" would pass on the looping implementation.
    signIn(SIGNED_IN_EMAIL);

    let releaseSignOut: () => void = () => undefined;
    const signOutGate = new Promise<void>((resolve) => {
      releaseSignOut = resolve;
    });
    const signOut = jest.fn(() => signOutGate);
    mockAuthState.signOut = signOut;

    const control = byLabel(renderTree(), SWITCH_ACCOUNT_LABEL)[0];
    expect(control).toBeDefined();

    const pending = (
      control.props as { onPress: () => void | Promise<void> }
    ).onPress();

    expect(signOut).toHaveBeenCalledTimes(1);
    // The load-bearing assertion: sign-out is in flight and navigation has NOT
    // happened. Drop the `await` and this line fails.
    expect(mockRouterReplace).not.toHaveBeenCalled();

    releaseSignOut();
    await pending;

    expect(mockRouterReplace).toHaveBeenCalledTimes(1);
    expect(mockRouterReplace).toHaveBeenCalledWith("/auth");
  });

  it("targets /auth plainly — no ?next= resume is invented", async () => {
    signIn(SIGNED_IN_EMAIL);
    const control = byLabel(renderTree(), SWITCH_ACCOUNT_LABEL)[0];
    await (control.props as { onPress: () => Promise<void> }).onPress();
    // `sanitizeNextRoute` allowlists none of this, and a route MISS has no
    // destination worth resuming. I-PROPOSED-1404 says: no new redirector.
    expect(mockRouterReplace).toHaveBeenCalledWith("/auth");
  });
});
