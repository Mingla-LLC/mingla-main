/**
 * ORCH-1404 [accept-invite-web-error-recovery] — F-1 fails-on-revert contract.
 *
 * PROVES the wrong-account screen is recoverable, not a "Back to Mingla" dead end:
 *   1. `<WrongAccountRecovery>` exposes a "Sign in with a different email" action
 *      wired to `onSwitchAccount`, plus a "Back to Mingla" secondary.
 *   2. `buildSwitchAccountResume(token)` routes ONLY through the ONE validator
 *      (`sanitizeNextRoute`) to `/auth?next=<encoded /accept-brand-invitation?token=…>`.
 *   3. `sanitizeNextRoute` accepts the resume target and REJECTS an off-origin
 *      (`//evil.com`) and a `..` traversal (`/accept-brand-invitation/../…`),
 *      proving the recovery cannot be turned into an open redirect.
 *
 * FAILS ON REVERT: the pre-1404 route renders only "Back to Mingla" for a
 * mismatch (no WrongAccountRecovery, no buildSwitchAccountResume). Deleting the
 * switch button makes the label lookup return undefined → T-6/T-7 FAIL; neutering
 * buildSwitchAccountResume (e.g. always returning "/auth") makes the decoded-next
 * assertion FAIL. Append-only; never modified.
 * (I-PROPOSED-1404-WRONG-ACCOUNT-RECOVERABLE — the mismatch screen must never be
 * Back-only.)
 *
 * Runs under the DEFAULT node/ts-jest config (no RN render harness): the pure
 * presentational component is invoked as a function and its returned element tree
 * is inspected — react-native + Button are mocked to plain type markers.
 */
import { describe, expect, jest, test } from "@jest/globals";

// ── Mocks (plain type markers — we inspect the element tree, we do not render) ──
jest.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  ActivityIndicator: "ActivityIndicator",
  StyleSheet: { create: (s: unknown) => s },
  Platform: {
    OS: "web",
    select: (o: Record<string, unknown>) => o.web ?? o.default ?? o.ios,
  },
}));

const MockButton = (_props: { label: string; onPress: () => void }): null => null;
jest.mock("../../ui/Button", () => ({ Button: MockButton, default: MockButton }));

// Route dependencies stubbed so the route module imports cleanly under node
// (we only pull the two pure exported helpers out of it — the screen is never rendered).
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ authStatus: "signed_in_ready", user: null, signOut: jest.fn() }),
}));
jest.mock("../../../hooks/useBrandInvitations", () => ({
  useAcceptBrandInvitation: () => ({ mutateAsync: jest.fn() }),
}));
jest.mock("../BusinessAppDownloadCta", () => ({
  BusinessAppDownloadCta: (): null => null,
}));
jest.mock("../../../services/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

// Real modules under test.
import { WrongAccountRecovery } from "../WrongAccountRecovery";
import { sanitizeNextRoute } from "../../../utils/nextRoute";
import {
  buildSwitchAccountResume,
  errorCopyFor,
} from "../../../../app/accept-brand-invitation";

// ── Element-tree inspection helpers (no react renderer) ──
type El = { type: unknown; props: { children?: unknown; [k: string]: unknown } };
const isEl = (n: unknown): n is El =>
  typeof n === "object" && n !== null && "type" in (n as object);

function collect(node: unknown, acc: El[]): void {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (Array.isArray(node)) {
    node.forEach((n) => collect(n, acc));
    return;
  }
  if (isEl(node)) {
    acc.push(node);
    collect(node.props?.children, acc);
    // #2211 moves the actions into InviteScreenShell's pinned footer so they
    // remain reachable at accessibility text sizes. They are intentionally a
    // named prop rather than scrolling children; inspect that public slot too
    // while preserving every original label/wiring assertion below.
    collect(node.props?.actions, acc);
  }
}

function textOf(el: El): string {
  const parts: string[] = [];
  const walk = (c: unknown): void => {
    if (c === null || c === undefined || typeof c === "boolean") return;
    if (Array.isArray(c)) {
      c.forEach(walk);
      return;
    }
    if (isEl(c)) {
      walk(c.props?.children);
      return;
    }
    parts.push(String(c));
  };
  walk(el.props.children);
  return parts.join("");
}

function renderRecovery(signedInEmail: string | null): {
  buttons: El[];
  texts: string[];
} {
  const tree = WrongAccountRecovery({
    signedInEmail,
    onSwitchAccount: () => undefined,
    onGoHome: () => undefined,
  }) as unknown as El;
  const all: El[] = [];
  collect(tree, all);
  return {
    buttons: all.filter((e) => e.type === MockButton),
    texts: all.filter((e) => e.type === "Text").map(textOf),
  };
}

describe("ORCH-1404 — WrongAccountRecovery screen", () => {
  // T-6 — the switch-account action + the secondary are both present.
  test("renders 'Sign in with a different email' primary + 'Back to Mingla' secondary", () => {
    const { buttons } = renderRecovery("a@b.com");
    const labels = buttons.map((b) => b.props.label);
    expect(labels).toContain("Sign in with a different email");
    expect(labels).toContain("Back to Mingla");
  });

  // T-7 — pressing the switch button calls the handler passed by the route.
  test("the switch button is wired to onSwitchAccount", () => {
    const onSwitchAccount = jest.fn(() => {});
    const onGoHome = jest.fn(() => {});
    const tree = WrongAccountRecovery({
      signedInEmail: "a@b.com",
      onSwitchAccount,
      onGoHome,
    }) as unknown as El;
    const all: El[] = [];
    collect(tree, all);
    const buttons = all.filter((e) => e.type === MockButton);
    const primary = buttons.find(
      (b) => b.props.label === "Sign in with a different email",
    );
    const secondary = buttons.find((b) => b.props.label === "Back to Mingla");
    expect(primary).toBeDefined();
    (primary!.props.onPress as () => void)();
    expect(onSwitchAccount).toHaveBeenCalledTimes(1);
    expect(secondary!.props.onPress).toBe(onGoHome);
  });

  // T-6b — the signed-in email context line.
  test("shows the signed-in email when provided", () => {
    const { texts } = renderRecovery("owner@brand.com");
    expect(texts.some((t) => t.includes("You're signed in as owner@brand.com."))).toBe(
      true,
    );
    // The verbatim mismatch body is present too.
    expect(
      texts.some((t) => t.includes("This invitation was sent to a different email")),
    ).toBe(true);
  });

  // T-10 — null email: still renders, no "signed in as null" line, no crash.
  test("renders with a null email and shows no 'signed in as' line", () => {
    const { buttons, texts } = renderRecovery(null);
    expect(buttons.map((b) => b.props.label)).toContain(
      "Sign in with a different email",
    );
    expect(texts.some((t) => t.toLowerCase().includes("signed in as"))).toBe(false);
  });
});

describe("ORCH-1404 — buildSwitchAccountResume (routing through the ONE validator)", () => {
  // T-8 — the resume target is /auth?next=<encoded accept URL with the token>.
  test("routes to /auth?next= whose decoded next is the accept URL with the token", () => {
    const target = buildSwitchAccountResume("abc123");
    expect(target.startsWith("/auth?next=")).toBe(true);
    const next = decodeURIComponent(target.slice("/auth?next=".length));
    expect(next).toBe("/accept-brand-invitation?token=abc123");
  });

  test("never emits an off-origin or /auth-less target", () => {
    const target = buildSwitchAccountResume("tok_xyz");
    expect(target.startsWith("/auth")).toBe(true);
    expect(target).not.toMatch(/^https?:/i);
    expect(target).not.toMatch(/^\/\//);
  });
});

describe("ORCH-1404 — sanitizeNextRoute reuse (open-redirect safety)", () => {
  // T-9 — the recovery reuses the safe validator: accepts the target, rejects attacks.
  test("accepts the accept-invite resume target", () => {
    expect(sanitizeNextRoute("/accept-brand-invitation?token=abc")).not.toBeNull();
  });

  test("rejects a protocol-relative off-origin target (//evil.com)", () => {
    expect(sanitizeNextRoute("//evil.com")).toBeNull();
  });

  test("rejects a `..` traversal that resolves off the allowlist", () => {
    expect(
      sanitizeNextRoute("/accept-brand-invitation/../brand/1/payments"),
    ).toBeNull();
    expect(
      sanitizeNextRoute("/accept-brand-invitation/%2e%2e/brand/1/payments"),
    ).toBeNull();
  });
});

describe("ORCH-1404 — errorCopyFor enumeration completeness", () => {
  // SC-3 — the newly-added 401 copy (was falling through to default).
  test("unauthenticated (401) has its own 'Sign in to continue' copy", () => {
    expect(errorCopyFor("unauthenticated").title).toBe("Sign in to continue");
  });

  // SC-2 — the mismatch code still maps to the wrong-account title.
  test("invite_email_mismatch maps to 'Wrong account'", () => {
    expect(errorCopyFor("invite_email_mismatch").title).toBe("Wrong account");
  });

  // OQ-3 — the generic default no longer leaks a raw status number to users.
  test("the generic default copy contains no raw status number", () => {
    const { title, body } = errorCopyFor("some_unknown_code");
    expect(title).toBe("Something went wrong");
    expect(body).not.toMatch(/status/i);
    expect(body).not.toMatch(/\b\d{3}\b/);
  });
});
