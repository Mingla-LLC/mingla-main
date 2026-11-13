/**
 * #3872 round 2 follow-ups — pure lifecycle rules for Host program screens,
 * kept free of React Native so they are testable without mounting a screen.
 *
 * Live screens (gig page, contract, Creators home, Blast Overview) refetch
 * when the screen regains focus and when the app returns to the foreground.
 * The first focus is skipped (the screen's own mount effect already loads),
 * a refetch already in flight is never doubled, and a backgrounded screen
 * that is not focused does nothing.
 */
export type FocusRefresher = {
  focus: () => void;
  blur: () => void;
  appState: (next: string) => void;
};

export function createFocusRefresher(
  refresh: () => unknown,
  initialAppState: string = "active",
): FocusRefresher {
  let focused = false;
  let focusedOnce = false;
  let appState = initialAppState;
  let inFlight = false;
  const fire = () => {
    if (inFlight) return;
    inFlight = true;
    let result: unknown;
    try {
      result = refresh();
    } catch {
      inFlight = false;
      return;
    }
    if (result && typeof (result as Promise<unknown>).then === "function") {
      (result as Promise<unknown>).then(
        () => {
          inFlight = false;
        },
        () => {
          inFlight = false;
        },
      );
    } else {
      inFlight = false;
    }
  };
  return {
    focus() {
      focused = true;
      if (focusedOnce) fire();
      focusedOnce = true;
    },
    blur() {
      focused = false;
    },
    appState(next: string) {
      const previous = appState;
      appState = next;
      if (focused && next === "active" && previous !== "active") fire();
    },
  };
}

/**
 * A success notice belongs to the contract state it was shown for. Once the
 * contract moves on (either side acted, or a refetch shows a new state) the
 * notice goes away instead of riding into later steps.
 */
export type ContractNotice = { text: string; state: string };

export function visibleNotice(
  notice: ContractNotice | null,
  currentState: string,
): string | null {
  if (!notice) return null;
  return notice.state === currentState ? notice.text : null;
}

/**
 * Words for a delivery the host tried to play: still processing vs ready but
 * not playable right now. `null` when there is a URL to play.
 */
export function playbackNotice(
  status: string | null | undefined,
  url: string | null | undefined,
): string | null {
  if (url) return null;
  if (status === "ready") return "We can't play this video right now. Try again soon.";
  return "The video is still processing. Try again in a minute.";
}

/**
 * #4402 (item 8) — while a contract screen is focused and waiting on the
 * creator, refetch every 20 s so their action shows without a touch. Acting
 * states (the host's own move) do not poll.
 */
export const HOST_POLL_MS = 20_000;
const HOST_WAITING_STATES: ReadonlySet<string> = new Set([
  "offered",
  "accepted",
  "script_drafting",
  "script_locked",
  "fix_requested",
  "approved",
  "posting",
  "posts_failed",
  "posts_submitted",
  "disputed",
]);

export function hostPollMs(state: string | null | undefined): number | false {
  return typeof state === "string" && HOST_WAITING_STATES.has(state)
    ? HOST_POLL_MS
    : false;
}
