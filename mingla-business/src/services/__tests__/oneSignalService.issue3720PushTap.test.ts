/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #3720 — a native push click must survive cold startup before React/auth is
 * ready. This executes the real oneSignalService against a mocked OneSignal
 * boundary and fails if pre-init registration becomes a no-op, if a buffered
 * click replays more than once, or if foreground registration is init-gated.
 *
 * INVARIANT(issue-3720-push-click): Host owns one app-lifetime native click
 * capture; a click buffered before the root subscriber mounts is consumed at
 * most once by the first ready subscriber.
 */

process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID =
  process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ?? "388b3efc-test-app-id";
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));

type NativeHandler = (event: unknown) => void;
const nativeHandlers = new Map<string, NativeHandler>();
const addEventListener = jest.fn((event: string, handler: NativeHandler) => {
  nativeHandlers.set(event, handler);
});
const removeEventListener = jest.fn();
const initialize = jest.fn();

jest.mock("react-native-onesignal", () => ({
  LogLevel: { Verbose: 0, Warn: 4 },
  OneSignal: {
    Debug: { setLogLevel: jest.fn() },
    initialize,
    login: jest.fn(),
    logout: jest.fn(),
    User: {
      addTag: jest.fn(),
      pushSubscription: { optIn: jest.fn(async () => {}) },
    },
    Notifications: {
      getPermissionAsync: jest.fn(async () => true),
      canRequestPermission: jest.fn(async () => true),
      requestPermission: jest.fn(async () => true),
      clearAll: jest.fn(),
      addEventListener,
      removeEventListener,
    },
  },
}));

const service =
  require("../oneSignalService") as typeof import("../oneSignalService");

const clickEvent = (data: Record<string, unknown>): unknown => ({
  notification: { additionalData: data },
});

describe("#3720 cold push click capture", () => {
  test("buffers a pre-init click and replays it exactly once", () => {
    expect(initialize).not.toHaveBeenCalled();
    const nativeClick = nativeHandlers.get("click");
    expect(nativeClick).toBeDefined();

    const firstData = {
      type: "business.community_roadmap_updated",
      notificationId: "notification-1",
      deepLink: "mingla-business://community/roadmap",
    };
    nativeClick?.(clickEvent(firstData));

    const first = jest.fn();
    const removeFirst = service.onNotificationClicked(first);
    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenLastCalledWith(firstData);

    const second = jest.fn();
    const removeSecond = service.onNotificationClicked(second);
    expect(second).not.toHaveBeenCalled();

    const nextData = {
      type: "business.community_roadmap_updated",
      notificationId: "notification-2",
      deepLink: "mingla-business://community/roadmap",
    };
    nativeClick?.(clickEvent(nextData));
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenLastCalledWith(nextData);

    removeFirst();
    nativeClick?.(
      clickEvent({ ...nextData, notificationId: "notification-3" }),
    );
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);
    removeSecond();
  });

  test("foreground listener can register before initialize", () => {
    const display = jest.fn();
    const preventDefault = jest.fn();
    const callback = jest.fn();
    const remove = service.onForegroundNotification(callback);
    const nativeForeground = nativeHandlers.get("foregroundWillDisplay");
    expect(nativeForeground).toBeDefined();

    nativeForeground?.({
      getNotification: () => ({
        additionalData: { type: "business.community_roadmap_updated" },
        display,
      }),
      preventDefault,
    });
    expect(callback).toHaveBeenCalledTimes(1);
    const [, prevent, show] = callback.mock.calls[0] as unknown as [
      Record<string, unknown>,
      () => void,
      () => void,
    ];
    prevent();
    show();
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(display).toHaveBeenCalledTimes(1);

    remove();
    expect(removeEventListener).toHaveBeenCalledWith(
      "foregroundWillDisplay",
      expect.any(Function),
    );
  });
});
