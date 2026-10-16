/**
 * #3720 — cold push tap must survive the boot index → Home redirect.
 *
 * INVARIANT(issue-3720-push-startup-settle): an authenticated Community
 * roadmap push held while pathname is `/` is flushed exactly once after
 * navigation leaves the boot index, landing on
 * `/account/support?tab=community&section=roadmap`.
 */

import {
  __resetBusinessPushLaunchIntentForTests,
  consumeBusinessPushLaunchTarget,
  holdBusinessPushLaunchTarget,
  isBusinessBootIndexPath,
  isBusinessNavigationStartupSettled,
  peekBusinessPushLaunchTarget,
} from "../businessPushLaunchIntent";
import {
  processBusinessNotification,
  resolveBusinessNavTarget,
} from "../businessNotificationRouting";

jest.mock("../supabase", () => ({
  supabase: {
    from: () => ({
      update: () => ({
        eq: () => ({
          select: () => Promise.resolve({ data: [{ id: "n-cold" }], error: null }),
        }),
      }),
    }),
  },
}));

jest.mock("../mixpanelService", () => ({
  mixpanelService: { track: jest.fn() },
}));

jest.mock("../../store/currentBrandStore", () => ({
  useCurrentBrandStore: {
    getState: () => ({ currentBrandId: "brand-123" }),
  },
}));

const ROADMAP_TARGET = "/account/support?tab=community&section=roadmap";

describe("#3720 cold push through boot index → Home", () => {
  beforeEach(() => {
    __resetBusinessPushLaunchIntentForTests();
  });

  test("boot index path is unsettled until Home replaces `/`", () => {
    expect(isBusinessBootIndexPath("/")).toBe(true);
    expect(isBusinessBootIndexPath("")).toBe(true);
    expect(isBusinessBootIndexPath("/(tabs)/home")).toBe(false);
    expect(
      isBusinessNavigationStartupSettled({
        loading: false,
        userId: "user-1",
        pathname: "/",
      }),
    ).toBe(false);
    expect(
      isBusinessNavigationStartupSettled({
        loading: false,
        userId: "user-1",
        pathname: "/(tabs)/home",
      }),
    ).toBe(true);
  });

  test("roadmap deep link resolves to Community → Roadmap", () => {
    expect(
      resolveBusinessNavTarget({
        type: "business.community_roadmap_updated",
        deepLink: "mingla-business://community/roadmap",
      }),
    ).toBe(ROADMAP_TARGET);
  });

  test("cold click held on `/` flushes once after Home settles", () => {
    const push = jest.fn();
    const holdLaunchTarget = (target: string): void => {
      holdBusinessPushLaunchTarget(target);
    };

    // Simulate OneSignal replay while still on boot index (Home redirect pending).
    processBusinessNotification(
      {
        type: "business.community_roadmap_updated",
        notificationId: "n-cold",
        deepLink: "mingla-business://community/roadmap",
      },
      {
        router: { push },
        isAuthenticated: true,
        navigationStartupSettled: false,
        holdLaunchTarget,
        stashDeferred: jest.fn(),
      },
    );

    expect(push).not.toHaveBeenCalled();
    expect(peekBusinessPushLaunchTarget()).toBe(ROADMAP_TARGET);

    // index.tsx Redirect to Home completes — flush exactly once.
    expect(
      isBusinessNavigationStartupSettled({
        loading: false,
        userId: "user-1",
        pathname: "/(tabs)/home",
      }),
    ).toBe(true);
    const flushed = consumeBusinessPushLaunchTarget();
    expect(flushed).toBe(ROADMAP_TARGET);
    push(flushed);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(ROADMAP_TARGET);
    expect(consumeBusinessPushLaunchTarget()).toBeNull();
  });

  test("fails closed if an unsettled authenticated tap pushes immediately", () => {
    const push = jest.fn();
    processBusinessNotification(
      {
        type: "business.community_roadmap_updated",
        deepLink: "mingla-business://community/roadmap",
      },
      {
        router: { push },
        isAuthenticated: true,
        navigationStartupSettled: false,
        holdLaunchTarget: holdBusinessPushLaunchTarget,
        stashDeferred: jest.fn(),
      },
    );
    // Regression: the production smoke failed because push ran before Home.
    expect(push).not.toHaveBeenCalled();
  });
});
