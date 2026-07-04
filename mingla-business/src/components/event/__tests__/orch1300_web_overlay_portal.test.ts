/**
 * ORCH-1300 [rsvp-phone-picker-mobile-portal] — implementor happy-path regression.
 *
 * ORCH-1299 un-froze the RSVP guest phone country-picker on DESKTOP web but it
 * STAYED broken on real MOBILE web: the `position:'fixed'` overlay is rendered
 * INLINE inside PhoneInput's tree, which on the RSVP page sits under `Animated`
 * transform ancestors. On mobile WebKit `fixed` resolves against the nearest
 * TRANSFORMED ancestor (not the viewport) → the picker mounts but lands
 * off-screen (measured y=-683 on iPhone-13 WebKit against live) → invisible.
 *
 * The fix: WebOverlayPortal.web.tsx portals the overlay to `document.body` (via
 * react-dom `createPortal`) so it has ZERO transformed ancestors and `fixed` is
 * truly viewport-relative on every engine. The NATIVE build (WebOverlayPortal.tsx)
 * stays a react-dom-free passthrough.
 *
 * This asserts the WEB portal contract directly. It FAILS ON REVERT: revert
 * WebOverlayPortal.web.tsx to render children inline (drop the createPortal call)
 * and T-1 regresses (the result is a plain element, not a portal to document.body).
 *
 * Runs in CI (default node/ts-jest config, react + react-dom present). It does
 * NOT run in an un-installed worktree (no react/react-dom); the portal contract
 * was also validated locally via a plain-node simulation + the strict-grep gate
 * (see IMPLEMENTATION_ORCH-1300 §Regression).
 */

// react-dom is web-only and not needed for real DOM work here — stub createPortal
// so we can assert WHAT it was asked to portal into (document.body) in node env.
jest.mock("react-dom", () => ({
  createPortal: (children: unknown, container: unknown) => ({
    __isPortal: true as const,
    children,
    container,
  }),
}));

// eslint-disable-next-line import/first
import { WebOverlayPortal } from "../../../../../packages/phone-input/WebOverlayPortal.web";

type PortalResult = { __isPortal?: true; children?: unknown; container?: unknown };

describe("ORCH-1300 WebOverlayPortal (web)", () => {
  const MARKER = { marker: "overlay-children" };

  afterEach(() => {
    // Clean up the stubbed global between cases.
    delete (globalThis as { document?: unknown }).document;
  });

  test("T-1 — portals the overlay to document.body when a DOM exists (the mobile fix)", () => {
    const body = { tag: "BODY" };
    (globalThis as { document?: unknown }).document = { body };

    const result = WebOverlayPortal({ children: MARKER }) as unknown as PortalResult;

    // The overlay is detached to document.body (NOT rendered inline), so its
    // position:'fixed' escapes the RSVP page's transformed ancestors.
    expect(result.__isPortal).toBe(true);
    expect(result.container).toBe(body);
    expect(result.children).toBe(MARKER);
  });

  test("T-2 — SSR/no-DOM guard renders inline (never portals when document is absent)", () => {
    // no globalThis.document
    const result = WebOverlayPortal({ children: MARKER }) as unknown as PortalResult;
    // A React fragment element — NOT our portal sentinel.
    expect(result.__isPortal).toBeUndefined();
  });
});
