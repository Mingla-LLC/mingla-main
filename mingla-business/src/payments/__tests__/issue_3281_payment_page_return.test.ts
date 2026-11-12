/**
 * issue #3281 (bundle 6c) — `waitForPaymentPageClosed`, shared by both apps
 * from `packages/payments-native/paymentPageReturn.ts`. Kept here because the
 * mingla-business jest suite is what CI runs; tests under `packages/**` are
 * not collected.
 *
 * On Android `openBrowserAsync` resolves `opened` while the buyer is still on
 * the payment page, so the caller must wait for the app to be covered and then
 * come back before asking the server whether they paid.
 */
import {
  PAYMENT_PAGE_COVER_WAIT_MS,
  waitForPaymentPageClosed,
  type AppStateLike,
} from "@mingla/payments-native/paymentPageReturn";

const fakeAppState = (initial: string | null = "active") => {
  const listeners = new Set<(state: string) => void>();
  const appState: AppStateLike & {
    emit: (state: string) => void;
    listeners: Set<(state: string) => void>;
  } = {
    currentState: initial,
    addEventListener: (_type, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    emit: (state: string) => {
      appState.currentState = state;
      for (const listener of [...listeners]) listener(state);
    },
    listeners,
  };
  return appState;
};

/** Settle without advancing timers; resolves to the value if it has settled. */
const settled = async <T>(promise: Promise<T>): Promise<T | "pending"> => {
  let value: T | "pending" = "pending";
  void promise.then((v) => {
    value = v;
  });
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  return value;
};

afterEach(() => {
  jest.useRealTimers();
});

describe("#3281 6c — waiting for the buyer to come back from the payment page", () => {
  it.each([
    ["cancel", { type: "cancel" }],
    ["dismiss", { type: "dismiss" }],
    ["locked", { type: "locked" }],
    ["no result", null],
    ["undefined", undefined],
  ])(
    "a browser result of %s means the page already closed: no wait, no listener",
    async (_label, result) => {
      const appState = fakeAppState();
      expect(await waitForPaymentPageClosed(result, { appState })).toBe(
        "closed",
      );
      expect(appState.listeners.size).toBe(0);
    },
  );

  it("`opened` waits for the app to be covered and to come back", async () => {
    const appState = fakeAppState();
    const wait = waitForPaymentPageClosed({ type: "opened" }, { appState });
    expect(await settled(wait)).toBe("pending");
    appState.emit("background");
    expect(await settled(wait)).toBe("pending");
    appState.emit("active");
    expect(await wait).toBe("returned");
    expect(appState.listeners.size).toBe(0);
  });

  it("an `active` before the app was ever covered is not a return", async () => {
    jest.useFakeTimers();
    const appState = fakeAppState();
    const wait = waitForPaymentPageClosed({ type: "opened" }, { appState });
    appState.emit("active");
    expect(await settled(wait)).toBe("pending");
    appState.emit("background");
    await jest.advanceTimersByTimeAsync(PAYMENT_PAGE_COVER_WAIT_MS * 3);
    expect(await settled(wait)).toBe("pending");
    appState.emit("active");
    expect(await wait).toBe("returned");
  });

  it("`inactive` counts as covered too", async () => {
    const appState = fakeAppState();
    const wait = waitForPaymentPageClosed({ type: "opened" }, { appState });
    appState.emit("inactive");
    appState.emit("active");
    expect(await wait).toBe("returned");
  });

  it("an app already in the background when it is called waits only for the return", async () => {
    jest.useFakeTimers();
    const appState = fakeAppState("background");
    const wait = waitForPaymentPageClosed({ type: "opened" }, { appState });
    await jest.advanceTimersByTimeAsync(PAYMENT_PAGE_COVER_WAIT_MS * 2);
    expect(await settled(wait)).toBe("pending");
    appState.emit("active");
    expect(await wait).toBe("returned");
  });

  it("a page that never covers the app ends the wait after the cover window, unconfirmed", async () => {
    jest.useFakeTimers();
    const appState = fakeAppState();
    const wait = waitForPaymentPageClosed({ type: "opened" }, { appState });
    await jest.advanceTimersByTimeAsync(PAYMENT_PAGE_COVER_WAIT_MS - 1);
    expect(await settled(wait)).toBe("pending");
    await jest.advanceTimersByTimeAsync(1);
    expect(await wait).toBe("unconfirmed");
    expect(appState.listeners.size).toBe(0);
  });

  it.each([null, "unknown", "extension"])(
    "a start state of %s never hangs the wait: the cover window still bounds it",
    async (initial) => {
      jest.useFakeTimers();
      const appState = fakeAppState(initial);
      const wait = waitForPaymentPageClosed({ type: "opened" }, { appState });
      appState.emit("unknown");
      await jest.advanceTimersByTimeAsync(PAYMENT_PAGE_COVER_WAIT_MS);
      expect(await wait).toBe("unconfirmed");
    },
  );

  it("a listener that fires synchronously while subscribing settles cleanly", async () => {
    let removed = 0;
    const appState: AppStateLike = {
      currentState: "background",
      addEventListener: (_type, listener) => {
        listener("active");
        return {
          remove: () => {
            removed += 1;
          },
        };
      },
    };
    expect(
      await waitForPaymentPageClosed({ type: "opened" }, { appState }),
    ).toBe("returned");
    expect(removed).toBe(1);
  });

  it("being covered cancels the cover window: the wait lasts as long as the buyer is away", async () => {
    jest.useFakeTimers();
    const appState = fakeAppState();
    const wait = waitForPaymentPageClosed({ type: "opened" }, { appState });
    appState.emit("background");
    await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(await settled(wait)).toBe("pending");
    appState.emit("active");
    expect(await wait).toBe("returned");
  });
});

describe("#3281 6c — no AppState to watch", () => {
  it("without react-native's AppState the page may still be open: unconfirmed", async () => {
    let result: string | undefined;
    await jest.isolateModulesAsync(async () => {
      jest.doMock("react-native", () => ({}));
      const isolated =
        await import("@mingla/payments-native/paymentPageReturn");
      result = await isolated.waitForPaymentPageClosed({ type: "opened" });
    });
    expect(result).toBe("unconfirmed");
  });
});
