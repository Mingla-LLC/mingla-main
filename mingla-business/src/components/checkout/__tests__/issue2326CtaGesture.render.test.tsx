/**
 * issue #2326 — tapping "Open in Mingla" on the confirmation screen did nothing.
 *
 * ─── WHAT WAS ACTUALLY MEASURED, NOT INFERRED ───────────────────────────────
 *
 * Instrumented on the DEPLOYED page (host.usemingla.com) holding a completed
 * FREE order, on desktop Chrome and on a real Samsung Galaxy A72 / Chrome 151:
 *
 *   • the handler DOES fire. Stack, verbatim from the device:
 *       onClick → onPress → Object.openURL → window.open
 *   • `claimAppUrl` was NULL (the card read "Preparing your Mingla link…"), so
 *     the SYNCHRONOUS branch ran — the dynamic-`import()` branch never
 *     executed. The gesture-chain hypothesis in the issue is REFUTED for the
 *     failure as it was reported.
 *   • react-native-web turns `Linking.openURL(url)` into
 *       window.open(url, '_blank', 'noopener')
 *     — the exact null-returning feature string ORCH-1381/1382 banned from
 *     this repository, re-entering through a library rather than a call site,
 *     and with NO popup-blocked fallback, so a blocked open is a silent dead
 *     tap with nothing for the buyer to act on.
 *   • gesture survival measured per-variant on the device (one open per tap;
 *     `window.open` CONSUMES transient activation, so testing several in one
 *     tap measures only the first): sync, microtask, 236 ms dynamic `import()`
 *     and a 1200 ms timer ALL returned a live window on Chrome. Chrome's
 *     transient activation is a 5 s timer. WebKit is not Chrome, and a
 *     navigation that waits on a network round-trip is a navigation that can
 *     be refused — which is why the handler is now synchronous regardless.
 *
 * There is also a REAL LATENT BUG the #2323 fix would otherwise have ARMED:
 * once a free order mints its claim link, `claimAppUrl` stops being null and
 * `open()` starts taking the async branch for the first time in production.
 *
 * ─── FAILS-ON-REVERT ────────────────────────────────────────────────────────
 *
 * F-1  Put `await` / `import()` back in front of the navigation
 *      → "the navigation happens in the same tick as the tap" fails: the
 *        assertion runs immediately after `onPress()` returns and before any
 *        microtask, so anything that yields loses.
 * F-2  Go back to `Linking.openURL`
 *      → "no feature string ever reaches window.open" fails (react-native-web
 *        appends 'noopener'), and so does "a blocked popup still navigates".
 * F-3  Open the app scheme in a new tab
 *      → "the app scheme is assigned to THIS tab" fails. A new tab keeps this
 *        page visible, so `openAttendanceClaimWithFallback`'s visibility
 *        detector never fires and the store fallback bounces a buyer whose app
 *        just opened.
 * F-4  Delete the popup-blocked fallback
 *      → "a blocked popup still navigates" fails — that is the dead tap.
 * F-5  Restore "Preparing your Mingla link…" to the `idle` phase
 *      → "an idle card does not promise a link that is not coming" fails.
 */
import React from "react";
import { Platform } from "react-native";

/**
 * `react-test-renderer` ships no type declarations and `@types/react-test-renderer`
 * is not installed; package manifests are do-not-touch on this issue. A plain
 * `import` would add TS7016 to the repo-wide baseline the #1403 delta ratchet
 * watches. Same `require`-with-a-local-interface shape
 * `composerBandContract.issue2262.render.test.tsx` uses, for the same reason.
 */
interface RenderNode {
  type: unknown;
  props: Record<string, unknown> & { testID?: string; onPress?: () => void; children?: unknown };
  children: unknown[];
  findAll: (
    predicate: (node: RenderNode) => boolean,
    options?: { deep: boolean },
  ) => RenderNode[];
}
interface RenderTree {
  root: RenderNode;
  update: (element: React.ReactElement) => void;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => void | Promise<void>) => void;
};
const act = TestRenderer.act as (cb: () => void | Promise<void>) => void;


jest.mock("../../ui/Icon", () => ({
  __esModule: true,
  Icon: () => null,
}));

import { DownloadMinglaCta } from "../DownloadMinglaCta";
import { APP_STORE_URL, DOWNLOAD_PAGE_URL } from "../../../constants/storeLinks";

// BUYER-WEB is the surface this card is served on, and the ONLY one #2326
// reproduces on. Under the react-native jest preset `Platform.OS` is "ios",
// which would silently route every assertion below through the native
// `Linking.openURL` arm and prove nothing about the browser.
Object.defineProperty(Platform, "OS", { value: "web", configurable: true });

// `openAttendanceClaimWithFallback` schedules its store fallback 1200 ms after
// the deep-link attempt. Real timers would fire it after the environment is
// torn down; fake timers also let the fallback itself be asserted.
let activeRestore: (() => void) | null = null;
beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  // Drain the fallback timer WHILE the fake window is still installed, then
  // tear down. Restoring first would make the fallback throw on a real
  // `window` that does not exist in this environment.
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  activeRestore?.();
  activeRestore = null;
});

const CLAIM_APP_URL =
  "com.mingla.app.v2://attendance-claim#v=1&kind=order&event=2b05b5df-b8a0-4192-beb6-bc16111a2d85";

type OpenCall = { url: string; args: number; features: unknown };

const installFakeWindow = (opts: { popupBlocked?: boolean } = {}): {
  opens: OpenCall[];
  assigns: string[];
  hrefs: string[];
  listeners: string[];
  restore: () => void;
} => {
  const opens: OpenCall[] = [];
  const assigns: string[] = [];
  const hrefs: string[] = [];
  const listeners: string[] = [];
  const fakeWin = { opener: {} as unknown };
  const location = {
    assign: (u: string) => {
      assigns.push(String(u));
    },
    set href(u: string) {
      hrefs.push(String(u));
    },
    get href(): string {
      return "https://host.usemingla.com/checkout/x/confirm";
    },
  };
  const w = {
    open: (...args: unknown[]): unknown => {
      opens.push({ url: String(args[0]), args: args.length, features: args[2] });
      return opts.popupBlocked === true ? null : fakeWin;
    },
    location,
  };
  const g = globalThis as unknown as Record<string, unknown>;
  const priorWindow = g.window;
  const priorDocument = g.document;
  g.window = w;
  g.document = {
    visibilityState: "visible",
    addEventListener: (t: string) => {
      listeners.push(t);
    },
    removeEventListener: () => undefined,
  };
  const handle = {
    opens,
    assigns,
    hrefs,
    listeners,
    restore: () => {
      g.window = priorWindow;
      g.document = priorDocument;
    },
  };
  activeRestore = handle.restore;
  return handle;
};

/**
 * `detectClientPlatform` reads `navigator`; the card resolves its destination
 * from the BROWSER, not from `Platform.OS` (#2217). Default to a UA no rule
 * matches so the store target is the desktop download page.
 */
const setUserAgent = (ua: string, platformName = "", maxTouchPoints = 0): void => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: ua, platform: platformName, maxTouchPoints },
  });
};

const mountCta = (props: {
  claimPhase: "idle" | "loading" | "ready" | "error" | "terminal" | "rate";
  claimAppUrl: string | null;
}): { press: () => void; text: string; unmount: () => void } => {
  let renderer: RenderTree | null = null;
  act(() => {
    renderer = TestRenderer.create(
      <DownloadMinglaCta
        eventName="We Go Again — Two Day Free"
        eventType="event"
        brandSlug="minglanigeria"
        entitySlug="we-go-again-two-day-free"
        claimPhase={props.claimPhase}
        claimAppUrl={props.claimAppUrl}
        onRetryClaim={() => undefined}
      />,
    );
  });
  const r = renderer as unknown as RenderTree;
  const primary = r.root.findAll(
    (n: RenderNode) => n.props != null && n.props.testID === "confirm-app-cta-primary",
  )[0] as RenderNode;
  const collect = (node: RenderNode): string =>
    node.findAll(() => true, { deep: true })
      .map((n: RenderNode) => (typeof n.props?.children === "string" ? n.props.children : ""))
      .join(" ");
  return {
    // Called BARE — no act(), no await. The whole point is that the navigation
    // must already have happened by the time this returns.
    press: () => {
      (primary.props.onPress as () => void)();
    },
    text: collect(r.root),
    unmount: () => {
      act(() => {
        r.unmount();
      });
    },
  };
};

describe("#2326 — the tap reaches a destination, in the same tick", () => {
  test("with no claim link, the store opens synchronously with the gesture", () => {
    const fake = installFakeWindow();
    {
      const cta = mountCta({ claimPhase: "idle", claimAppUrl: null });
      cta.press();
      // Asserted BEFORE any microtask can run.
      expect(fake.opens).toHaveLength(1);
      expect(fake.opens[0]?.url).toBe(DOWNLOAD_PAGE_URL);
      cta.unmount();
    }
  });

  test("no feature string ever reaches window.open (the ORCH-1381 null-return trap)", () => {
    const fake = installFakeWindow();
    {
      const cta = mountCta({ claimPhase: "idle", claimAppUrl: null });
      cta.press();
      expect(fake.opens[0]?.args).toBe(2);
      expect(fake.opens[0]?.features).toBeUndefined();
      cta.unmount();
    }
  });

  test("a blocked popup still navigates — a tap is never a dead end", () => {
    const fake = installFakeWindow({ popupBlocked: true });
    {
      const cta = mountCta({ claimPhase: "idle", claimAppUrl: null });
      cta.press();
      expect(fake.assigns).toEqual([DOWNLOAD_PAGE_URL]);
      cta.unmount();
    }
  });

  test("with a claim link, the app scheme is reached in the same tick as the tap", () => {
    const fake = installFakeWindow();
    {
      const cta = mountCta({ claimPhase: "ready", claimAppUrl: CLAIM_APP_URL });
      cta.press();
      // THE #2326 PROOF. `openAttendanceClaimWithFallback` is async, but its
      // deep-link open sits before its first `await`. Reintroducing an `await`
      // or a dynamic `import()` in front of it empties this array.
      expect(fake.assigns).toEqual([CLAIM_APP_URL]);
      cta.unmount();
    }
  });

  test("the app scheme is assigned to THIS tab, never handed to a new one", () => {
    const fake = installFakeWindow();
    {
      const cta = mountCta({ claimPhase: "ready", claimAppUrl: CLAIM_APP_URL });
      cta.press();
      // POSITIVE first, so this can never pass by the scheme going nowhere at
      // all (which is what a revert to `Linking.openURL` looks like here).
      expect(fake.assigns).toContain(CLAIM_APP_URL);
      expect(fake.opens.map((o) => o.url)).not.toContain(CLAIM_APP_URL);
      // …and the visibility detector the fallback depends on is armed.
      expect(fake.listeners).toContain("visibilitychange");
      cta.unmount();
    }
  });

  test("when the app does not take the navigation, the SAME tap lands on the store", async () => {
    const fake = installFakeWindow();
    {
      const cta = mountCta({ claimPhase: "ready", claimAppUrl: CLAIM_APP_URL });
      cta.press();
      expect(fake.assigns).toEqual([CLAIM_APP_URL]);
      // The fallback is ARMED one microtask after the deep-link attempt — the
      // attempt itself is what must be synchronous, not the timer behind it.
      await Promise.resolve();
      await Promise.resolve();
      // Nothing backgrounded this page, so the app did not take it.
      jest.advanceTimersByTime(1200);
      expect(fake.opens.map((o) => o.url)).toEqual([DOWNLOAD_PAGE_URL]);
      cta.unmount();
    }
  });

  test("nothing is deferred: a microtask scheduled at tap time has not run yet", async () => {
    const fake = installFakeWindow();
    {
      const cta = mountCta({ claimPhase: "ready", claimAppUrl: CLAIM_APP_URL });
      let microtaskRan = false;
      void Promise.resolve().then(() => {
        microtaskRan = true;
      });
      cta.press();
      expect(microtaskRan).toBe(false);
      expect(fake.assigns).toEqual([CLAIM_APP_URL]);
      cta.unmount();
    }
  });
});

describe("#2326 — iOS-web never navigates to an unhandled custom scheme", () => {
  // MEASURED on iOS 26.5 Safari with a real tap: assigning an unhandled custom
  // scheme raises "Safari cannot open the page because the address is invalid."
  // Chrome on a real Galaxy A72 silently ignores it and the 1200 ms fallback
  // carries the same tap to the store, so the deep link is attempted there.
  test("an iPhone goes straight to the App Store even when a claim link exists", () => {
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15", "iPhone", 5);
    const fake = installFakeWindow();
    {
      const cta = mountCta({ claimPhase: "ready", claimAppUrl: CLAIM_APP_URL });
      cta.press();
      expect(fake.assigns).not.toContain(CLAIM_APP_URL);
      expect(fake.opens.map((o) => o.url)).toEqual([APP_STORE_URL]);
      cta.unmount();
    }
    setUserAgent("");
  });

  test("an Android phone still gets the deep link first", () => {
    setUserAgent("Mozilla/5.0 (Linux; Android 14; SM-A725F) AppleWebKit/537.36 Chrome/151.0.0.0 Mobile", "Linux armv8l", 5);
    const fake = installFakeWindow();
    {
      const cta = mountCta({ claimPhase: "ready", claimAppUrl: CLAIM_APP_URL });
      cta.press();
      expect(fake.assigns).toEqual([CLAIM_APP_URL]);
      cta.unmount();
    }
    setUserAgent("");
  });
});

describe("#2326 — the card does not promise a link that is not coming", () => {
  test("an idle card says nothing about preparing a link", () => {
    const cta = mountCta({ claimPhase: "idle", claimAppUrl: null });
    expect(cta.text).not.toContain("Preparing your Mingla link");
    cta.unmount();
  });

  test("a loading card does say it is preparing one", () => {
    const cta = mountCta({ claimPhase: "loading", claimAppUrl: null });
    expect(cta.text).toContain("Preparing your Mingla link");
    cta.unmount();
  });

  test("the button is present in every phase — the claim is never a gate", () => {
    for (const phase of ["idle", "loading", "ready", "error", "terminal", "rate"] as const) {
      const cta = mountCta({ claimPhase: phase, claimAppUrl: null });
      expect(cta.text).toContain("Open in Mingla");
      cta.unmount();
    }
  });
});
