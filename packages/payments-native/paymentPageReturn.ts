/**
 * issue #3281 (bundle 6c) — wait until the buyer is back from a payment page
 * opened with `expo-web-browser`'s `openBrowserAsync`, before asking the
 * server whether they paid.
 *
 * On iOS `openBrowserAsync` resolves only when the in-app browser closes
 * (`cancel` / `dismiss`). On Android it resolves `{ type: "opened" }` as soon
 * as the Custom Tab opens, while the buyer is still on the page. Both apps
 * poll right after it resolves, and Paystack reports a transaction as
 * `abandoned` from initialize onward, so an Android buyer still paying could
 * be told they closed the page (I-PROPOSED-PAYSTACK-ABANDONED-ONLY-AFTER-
 * BROWSER-CLOSES). On `opened` this waits for the app to go to the background
 * (the Custom Tab covering it) and then to come back.
 *
 * Pure apart from the injected AppState, so it is shared by both apps and
 * tested without a device.
 */

export type AppStateStatusLike =
  "active" | "background" | "inactive" | "unknown" | "extension" | string;

export interface AppStateLike {
  currentState: AppStateStatusLike | null | undefined;
  addEventListener(
    type: "change",
    listener: (state: AppStateStatusLike) => void,
  ): { remove(): void };
}

/**
 * If the app never leaves the foreground within this long after `opened`, the
 * page is not covering the app (split screen, a browser that failed to show,
 * or a test double): stop waiting and let the server decide.
 */
export const PAYMENT_PAGE_COVER_WAIT_MS = 5000;

export interface WaitForPaymentPageClosedOptions {
  appState?: AppStateLike;
  coverWaitMs?: number;
}

const loadAppState = (): AppStateLike | null => {
  try {
    // Loaded lazily so this module stays importable in plain-node tests.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = require("react-native") as { AppState?: AppStateLike };
    return rn.AppState ?? null;
  } catch {
    return null;
  }
};

/**
 * How the wait ended.
 * - `closed`: the browser call itself said the page closed (iOS).
 * - `returned`: the page covered the app and the buyer came back (Android).
 * - `unconfirmed`: the page may STILL be open (the app never left the
 *   foreground, e.g. Android split screen, or no AppState). The caller may ask
 *   the server, but must not read Paystack's `abandoned` as the buyer leaving:
 *   Paystack reports it from initialize onward.
 */
export type PaymentPageReturn = "closed" | "returned" | "unconfirmed";

/**
 * Resolves once the buyer is back from the payment page, or once it is clear
 * the page is not covering the app.
 */
export async function waitForPaymentPageClosed(
  result: { type?: string } | null | undefined,
  options: WaitForPaymentPageClosedOptions = {},
): Promise<PaymentPageReturn> {
  if (result?.type !== "opened") return "closed";
  const appState = options.appState ?? loadAppState();
  if (appState === null) return "unconfirmed";
  const coverWaitMs = options.coverWaitMs ?? PAYMENT_PAGE_COVER_WAIT_MS;

  // Only these mean the page is covering the app. `unknown`, `extension` or a
  // missing state never count, so a strange state cannot hang the wait: it
  // falls to the bounded cover timer instead.
  const covering = (state: AppStateStatusLike | null | undefined) =>
    state === "background" || state === "inactive";

  return await new Promise<PaymentPageReturn>((resolve) => {
    // Already backgrounded before we subscribed (the page opened fast): skip
    // straight to waiting for the return.
    let left = covering(appState.currentState);
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Assigned below; null while `addEventListener` runs, in case a listener
    // fires synchronously from inside it.
    let subscription: { remove(): void } | null = null;
    const finish = (how: PaymentPageReturn) => {
      if (done) return;
      done = true;
      if (timer !== null) clearTimeout(timer);
      subscription?.remove();
      resolve(how);
    };
    const added = appState.addEventListener("change", (state) => {
      if (state === "active") {
        if (left) finish("returned");
        return;
      }
      if (!covering(state)) return;
      // background / inactive: the page is covering the app.
      left = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    });
    // Settled synchronously inside addEventListener: release it now.
    if (done) added.remove();
    else subscription = added;
    if (!left && !done) {
      timer = setTimeout(() => {
        timer = null;
        if (!left) finish("unconfirmed");
      }, coverWaitMs);
    }
  });
}
